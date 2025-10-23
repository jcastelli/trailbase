FROM rust:1.90-slim-bookworm AS chef

# Install additional build dependencies. Note that `git` is needed to bake version metadata.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git make pkg-config clang-19 libclang-19-dev protobuf-compiler libprotobuf-dev libssl-dev libsqlite3-dev musl-tools

# Install Rust MUSL targets and chef.
RUN rustup target add x86_64-unknown-linux-musl
RUN rustup target add aarch64-unknown-linux-musl
RUN cargo install cargo-chef

# Install Node.js
ENV PATH=/usr/local/node/bin:$PATH
ARG NODE_VERSION=22.13.1

RUN curl -sL https://github.com/nodenv/node-build/archive/master.tar.gz | tar xz -C /tmp/ && \
    /tmp/node-build-master/bin/node-build "${NODE_VERSION}" /usr/local/node && \
    rm -rf /tmp/node-build-master

RUN npm install -g pnpm
RUN pnpm --version

WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --bin trail --recipe-path recipe.json


FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --target=x86_64-unknown-linux-musl --features=vendor-ssl --release --bin trail --recipe-path recipe.json

COPY . .

# First install all JS deps. This is to avoid collisions due to parallel
# installs later-on while building `crates/assets` (auth, admin, client) and
# `crates/js-runtime` (runtime).
RUN pnpm -r install --frozen-lockfile

ARG TARGETPLATFORM

RUN case ${TARGETPLATFORM} in \
         "linux/arm64")  RUST_TARGET="aarch64-unknown-linux-musl"  ;; \
         *)              RUST_TARGET="x86_64-unknown-linux-musl"   ;; \
    esac && \
    PNPM_OFFLINE="TRUE" cargo build --target ${RUST_TARGET} --features=vendor-ssl --release --bin trail && \
    mv target/${RUST_TARGET}/release/trail /app/trail.exe

FROM alpine:3.22 AS runtime
RUN apk add --no-cache tini curl

COPY --from=builder /app/trail.exe /app/trail

# When `docker run` is executed, launch the binary as unprivileged user.
RUN adduser -D trailbase

RUN mkdir -p /app/traildepot
RUN chown trailbase /app/traildepot
USER trailbase

WORKDIR /app

EXPOSE 4000
ENTRYPOINT ["tini", "--"]

CMD ["/app/trail", "--data-dir", "/app/traildepot", "run", "--address", "0.0.0.0:4000"]

HEALTHCHECK CMD curl --fail http://localhost:4000/api/healthcheck || exit 1
