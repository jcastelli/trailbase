use base64::prelude::*;
use serde::{Deserialize, Serialize};
use trailbase_sqlite::Value;
use ts_rs::TS;

#[derive(Debug, Clone, thiserror::Error)]
pub enum DecodeError {
  #[error("Base64: {0}")]
  Base64(#[from] base64::DecodeError),
  #[error("Hex")]
  Hex,
}

#[derive(Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub enum Blob {
  Array(Vec<u8>),
  /// NOTE: default for reads, given it has best compression-ratio.
  Base64UrlSafe(String),
  Hex(String),
}

/// Mimic's rusqlite's Value but is JS/JSON serializable and supports multiple blob encodings..
#[derive(Debug, Deserialize, Serialize, TS)]
#[ts(export)]
pub enum SqlValue {
  Null,
  Integer(i64),
  Real(f64),
  Text(String),
  Blob(Blob),
}

impl TryFrom<SqlValue> for Value {
  type Error = DecodeError;

  fn try_from(value: SqlValue) -> Result<Self, Self::Error> {
    return Ok(match value {
      SqlValue::Null => Value::Null,
      SqlValue::Integer(v) => Value::Integer(v),
      SqlValue::Real(v) => Value::Real(v),
      SqlValue::Text(v) => Value::Text(v),
      SqlValue::Blob(b) => match b {
        Blob::Array(v) => Value::Blob(v),
        Blob::Base64UrlSafe(v) => Value::Blob(BASE64_URL_SAFE.decode(v)?),
        Blob::Hex(v) => Value::Blob(decode_hex(&v)?),
      },
    });
  }
}

impl From<Value> for SqlValue {
  fn from(value: Value) -> Self {
    return match value {
      Value::Null => SqlValue::Null,
      Value::Integer(v) => SqlValue::Integer(v),
      Value::Real(v) => SqlValue::Real(v),
      Value::Text(v) => SqlValue::Text(v),
      Value::Blob(v) => SqlValue::Blob(Blob::Base64UrlSafe(BASE64_URL_SAFE.encode(v))),
    };
  }
}

impl From<&Value> for SqlValue {
  fn from(value: &Value) -> Self {
    return match value {
      Value::Null => SqlValue::Null,
      Value::Integer(v) => SqlValue::Integer(*v),
      Value::Real(v) => SqlValue::Real(*v),
      Value::Text(v) => SqlValue::Text(v.clone()),
      Value::Blob(v) => SqlValue::Blob(Blob::Base64UrlSafe(BASE64_URL_SAFE.encode(v))),
    };
  }
}

fn decode_hex(s: &str) -> Result<Vec<u8>, DecodeError> {
  if s.len() % 2 != 0 {
    return Err(DecodeError::Hex);
  }

  return (0..s.len())
    .step_by(2)
    .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| DecodeError::Hex))
    .collect();
}
