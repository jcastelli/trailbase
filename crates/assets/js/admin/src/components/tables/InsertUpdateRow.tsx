import { children, createSignal, For, Show, JSX } from "solid-js";
import { createForm } from "@tanstack/solid-form";
import { urlSafeBase64Decode } from "trailbase";

import { SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

import type { Column } from "@bindings/Column";
import type { Table } from "@bindings/Table";
import type { ColumnDataType } from "@bindings/ColumnDataType";

import { Checkbox } from "@/components/ui/checkbox";
import { gapStyle, GridFieldInfo } from "@/components/FormFields";
import type { FieldApiT } from "@/components/FormFields";
import { getDefaultValue, isNotNull, isPrimaryKeyColumn } from "@/lib/schema";
import { SheetContainer } from "@/components/SafeSheet";
import { showToast } from "@/components/ui/toast";
import {
  TextField,
  TextFieldLabel,
  TextFieldInput,
} from "@/components/ui/text-field";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  buildDefaultRow,
  literalDefault,
  // preProcessInsertValue,
  // preProcessUpdateValue,
} from "@/lib/convert";
import { updateRow, insertRow } from "@/lib/row";
import { sqlValueToString } from "@/lib/value";
import type {
  SqlNullValue,
  SqlRealValue,
  SqlIntegerValue,
  SqlTextValue,
  SqlBlobValue,
  SqlValue,
} from "@/lib/value";
import { tryParseFloat, tryParseBigInt } from "@/lib/utils";
import { isNullableColumn } from "@/lib/schema";

/// A record, i.e. row of SQL values (including "Null") or undefined (don't submit), keyed by column name.
/// We use a map-like structure to allow for absence and avoid schema complexities and skew.
type Record = { [key: string]: SqlValue | undefined };

export function InsertUpdateRowForm(props: {
  close: () => void;
  markDirty: () => void;
  rowsRefetch: () => void;
  schema: Table;
  row?: Record;
}) {
  const isUpdate = () => props.row !== undefined;

  const form = createForm(() => {
    console.debug("create form");
    const defaultValues: Record = props.row
      ? { ...props.row }
      : buildDefaultRow(props.schema);

    return {
      defaultValues,
      onSubmit: async ({ value }: { value: Record }) => {
        console.debug(`Submitting ${isUpdate() ? "update" : "insert"}:`, value);
        try {
          if (isUpdate()) {
            // NOTE: updateRow mutates the value - it deletes the pk, thus
            // shallow copy.
            await updateRow(props.schema, { ...value });
          } else {
            await insertRow(props.schema, { ...value });
          }

          props.rowsRefetch();
          props.close();
        } catch (err) {
          showToast({
            description: `${err}`,
            variant: "error",
          });
        }
      },
    };
  });

  form.useStore((state) => {
    if (state.isDirty && !state.isSubmitted) {
      props.markDirty();
    }
  });

  form.createField(() => ({
    name: "row.test",
  }));

  return (
    <SheetContainer>
      <SheetHeader>
        <SheetTitle>{isUpdate() ? "Edit Row" : "Insert New Row"}</SheetTitle>
      </SheetHeader>

      <form
        method="dialog"
        onSubmit={(e: SubmitEvent) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <div class="flex flex-col items-start gap-4 py-4">
          <For each={props.schema.columns}>
            {(col: Column) => {
              const isPk = isPrimaryKeyColumn(col);
              const notNull = isNotNull(col.options);
              const defaultValue = getDefaultValue(col.options);

              // TODO: For foreign keys we'd ideally render a auto-complete search bar.
              return (
                <form.Field
                  name={col.name}
                  validators={{
                    onChange: ({ value }: { value: SqlValue | undefined }) => {
                      if (value === undefined || value === "Null") {
                        return undefined;
                      }

                      if ("Blob" in value) {
                        const blob = value.Blob;
                        if ("Base64UrlSafe" in blob) {
                          try {
                            urlSafeBase64Decode(blob.Base64UrlSafe);
                          } catch {
                            return "Not valid url-safe b64";
                          }
                          return undefined;
                        }
                        throw Error("Expected Base64UrlSafe");
                      }

                      try {
                        // FIXME: Needs to be removed or updated for SqlValue (previously: null | string | number).
                        // if (isUpdate()) {
                        //   preProcessUpdateValue(col, value);
                        // } else {
                        //   preProcessInsertValue(col, value);
                        // }
                      } catch (e) {
                        return `Invalid value for ${col.name}: ${e}`;
                      }
                      return undefined;
                    },
                  }}
                >
                  {buildDBCellField({
                    name: col.name,
                    type: col.data_type,
                    notNull: notNull,
                    isPk,
                    isUpdate: isUpdate(),
                    defaultValue,
                  })}
                </form.Field>
              );
            }}
          </For>
        </div>

        <SheetFooter>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
            children={(state) => {
              return (
                <Button
                  type="submit"
                  disabled={!state().canSubmit}
                  variant="default"
                >
                  {state().isSubmitting
                    ? "..."
                    : isUpdate()
                      ? "Update"
                      : "Insert"}
                </Button>
              );
            }}
          />
        </SheetFooter>
      </form>
    </SheetContainer>
  );
}

// Form options will be different for:
//
// * Insert/Update: using default values, i.e. undefined, is only an option on insert.
// * Nullable fields.

// TODO:
// * Re-introduce validation. Numbers covered. What about b64 unsafe url.
// * For ANY fields, use string field and use affinity like parsing to Real, Int, Blob... .
// * Do we need to do pre-processing, e.g. strip unchanged values from update?
//   Strip undefined when default values should be used...? ... Probaly not.

function FormRow<
  T extends
    | SqlRealValue
    | SqlIntegerValue
    | SqlTextValue
    | SqlBlobValue
    | SqlNullValue
    | undefined,
>(props: { children: JSX.Element; field: () => FieldApiT<T> }) {
  const c = children(() => props.children);

  return (
    <div
      class={`grid items-center ${gapStyle}`}
      style={{ "grid-template-columns": "auto 1fr 16px" }}
    >
      {c()}

      <div class="col-start-0">
        <GridFieldInfo field={props.field()} />
      </div>
    </div>
  );
}

type SqlFormFieldOptions = {
  label: () => JSX.Element;
  disabled: boolean;
  placeholder: string | undefined;
  nullable: boolean;
};

function getReal(value: SqlValue | undefined): number | undefined {
  if (value !== undefined && value !== "Null" && "Real" in value) {
    return value.Real;
  }
}

function getInteger(value: SqlValue | undefined): bigint | undefined {
  if (value !== undefined && value !== "Null" && "Integer" in value) {
    return value.Integer;
  }
}

function getText(value: SqlValue | undefined): string | undefined {
  if (value !== undefined && value !== "Null" && "Text" in value) {
    return value.Text;
  }
}

function getBlob(value: SqlValue | undefined): string | undefined {
  if (value !== undefined && value !== "Null" && "Blob" in value) {
    const blob = value.Blob;
    if ("Base64UrlSafe" in blob) {
      return blob.Base64UrlSafe;
    }
    throw Error("Expected Base64UrlSafe");
  }
}

function buildSqlRealFormField(opts: SqlFormFieldOptions) {
  const externDisable = opts.disabled;

  return function builder(field: () => FieldApiT<SqlValue | undefined>) {
    const initialValue: SqlValue | undefined = field().state.value;
    const initialChecked: boolean =
      initialValue !== undefined && initialValue !== "Null";
    const [disabled, setDisabled] = createSignal<boolean>(
      opts.nullable && !initialChecked,
    );

    const placeholder = (): string | undefined => {
      if (disabled()) {
        return "NULL";
      }
      const value = field().state.value;
      return getReal(value)?.toString() ?? opts.placeholder;
    };

    const value = (): number | undefined =>
      disabled() ? undefined : getReal(field().state.value);

    return (
      <TextField class="w-full">
        <FormRow field={field}>
          <TextFieldLabel>{opts.label()}</TextFieldLabel>

          <TextFieldInput
            disabled={disabled()}
            type={"text"}
            pattern="[ ]*[0-9]+[.,]?[0-9]*[ ]*"
            value={value() ?? ""}
            placeholder={placeholder() ?? ""}
            autocomplete={false}
            onBlur={field().handleBlur}
            onInput={(e: Event) => {
              const parsed = tryParseFloat(
                (e.target as HTMLInputElement).value,
              );
              if (parsed !== undefined) {
                field().handleChange({ Real: parsed });
              }
            }}
          />

          {opts.nullable && (
            <Checkbox
              disabled={externDisable}
              defaultChecked={initialChecked}
              onChange={(enabled: boolean) => {
                setDisabled(!enabled);
                // NOTE: null is critical here to actively unset a cell, undefined
                // would merely take it out of the patch set.
                const value = enabled ? (initialValue ?? "Null") : "Null";
                field().handleChange(value);
              }}
              data-testid="toggle"
            />
          )}
        </FormRow>
      </TextField>
    );
  };
}

function buildSqlIntegerFormField(opts: SqlFormFieldOptions) {
  const externDisable = opts.disabled;

  return function builder(field: () => FieldApiT<SqlValue | undefined>) {
    const initialValue: SqlValue | undefined = field().state.value;
    const initialChecked: boolean =
      initialValue !== undefined && initialValue !== "Null";
    const [disabled, setDisabled] = createSignal<boolean>(
      opts.nullable && !initialChecked,
    );

    const placeholder = (): string | undefined => {
      if (disabled()) {
        return "NULL";
      }
      const value = field().state.value;
      return getInteger(value)?.toString() ?? opts.placeholder;
    };

    const value = (): bigint | undefined =>
      disabled() ? undefined : getInteger(field().state.value);

    return (
      <TextField class="w-full">
        <FormRow field={field}>
          <TextFieldLabel>{opts.label()}</TextFieldLabel>

          <TextFieldInput
            disabled={disabled()}
            type={disabled() ? "number" : "text"}
            step={1}
            pattern={"[ ]*[0-9]+[ ]*"}
            value={value() ?? ""}
            placeholder={placeholder() ?? ""}
            onBlur={field().handleBlur}
            onInput={(e: Event) => {
              const parsed = tryParseBigInt(
                (e.target as HTMLInputElement).value,
              );
              if (parsed !== undefined) {
                field().handleChange({ Integer: parsed });
              }
            }}
          />

          {opts.nullable && (
            <Checkbox
              disabled={externDisable}
              defaultChecked={initialChecked}
              onChange={(enabled: boolean) => {
                setDisabled(!enabled);

                // NOTE: null is critical here to actively unset a cell, undefined
                // would merely take it out of the patch set.
                const value = enabled ? (initialValue ?? "Null") : "Null";
                field().handleChange(value);
              }}
              data-testid="toggle"
            />
          )}
        </FormRow>
      </TextField>
    );
  };
}

function buildSqlTextFormField(opts: SqlFormFieldOptions) {
  const externDisable = opts.disabled;

  return function (field: () => FieldApiT<SqlValue | undefined>) {
    const initialValue: SqlValue | undefined = field().state.value;
    const initialChecked: boolean =
      initialValue !== undefined && initialValue !== "Null";
    const [disabled, setDisabled] = createSignal<boolean>(
      opts.nullable && !initialChecked,
    );

    const placeholder = (): string | undefined => {
      if (disabled()) {
        return "NULL";
      }
      const value = field().state.value;
      return getText(value)?.toString() ?? opts.placeholder;
    };

    const value = (): string | undefined =>
      disabled() ? undefined : getText(field().state.value);

    console.log(field().name, field().state.value, disabled());

    return (
      <TextField class="w-full">
        <FormRow field={field}>
          <TextFieldLabel>{opts.label()}</TextFieldLabel>

          <TextFieldInput
            disabled={disabled()}
            type={"text"}
            value={value() ?? ""}
            placeholder={placeholder()}
            onBlur={field().handleBlur}
            onInput={(e: Event) => {
              const value: string | undefined = (e.target as HTMLInputElement)
                .value;
              if (value !== undefined) {
                field().handleChange({ Text: value });
              }
            }}
            data-testid="input"
          />

          {opts.nullable && (
            <Checkbox
              disabled={externDisable}
              defaultChecked={initialChecked}
              onChange={(enabled: boolean) => {
                setDisabled(!enabled);
                // NOTE: null is critical here to actively unset a cell, undefined
                // would merely take it out of the patch set.
                const value = enabled ? (initialValue ?? "Null") : "Null";
                field().handleChange(value);
              }}
              data-testid="toggle"
            />
          )}
        </FormRow>
      </TextField>
    );
  };
}

function buildSqlBlobFormField(opts: SqlFormFieldOptions) {
  const externDisable = opts.disabled;

  return function (field: () => FieldApiT<SqlValue | undefined>) {
    const initialValue: SqlValue | undefined = field().state.value;
    const initialChecked: boolean =
      initialValue !== undefined && initialValue !== "Null";
    const [disabled, setDisabled] = createSignal<boolean>(
      opts.nullable && !initialChecked,
    );

    const placeholder = (): string | undefined => {
      if (disabled()) {
        return "NULL";
      }
      const value = field().state.value;
      return getBlob(value)?.toString() ?? opts.placeholder;
    };

    const value = (): string | undefined =>
      disabled() ? undefined : getBlob(field().state.value);

    return (
      <TextField class="w-full">
        <FormRow field={field}>
          <TextFieldLabel>{opts.label()}</TextFieldLabel>

          <TextFieldInput
            disabled={disabled()}
            type={"text"}
            value={value() ?? ""}
            placeholder={placeholder()}
            onBlur={field().handleBlur}
            onInput={(e: Event) => {
              // FIXME: Missing input validation.
              const value: string | undefined = (e.target as HTMLInputElement)
                .value;
              if (value !== undefined) {
                field().handleChange({ Blob: { Base64UrlSafe: value } });
              }
            }}
            data-testid="input"
          />

          {opts.nullable && (
            <Checkbox
              disabled={externDisable}
              defaultChecked={initialChecked}
              onChange={(enabled: boolean) => {
                setDisabled(!enabled);
                // NOTE: null is critical here to actively unset a cell, undefined
                // would merely take it out of the patch set.
                const value = enabled ? (initialValue ?? "Null") : "Null";
                field().handleChange(value);
              }}
              data-testid="toggle"
            />
          )}
        </FormRow>
      </TextField>
    );
  };
}

function buildSqlAnyFormField(opts: SqlFormFieldOptions) {
  const externDisable = opts.disabled;

  return function (field: () => FieldApiT<SqlValue | undefined>) {
    const initialValue: SqlValue | undefined = field().state.value;
    const initialChecked: boolean =
      initialValue !== undefined && initialValue !== "Null";
    const [disabled, setDisabled] = createSignal<boolean>(
      opts.nullable && !initialChecked,
    );

    const placeholder = (): string | undefined => {
      if (disabled()) {
        return "NULL";
      }
      const value = field().state.value;
      return value !== undefined ? sqlValueToString(value) : undefined;
    };

    const value = (): string | undefined => {
      const v = field().state.value;
      if (!disabled() && v !== undefined) {
        return sqlValueToString(v);
      }
    };

    return (
      <TextField class="w-full">
        <FormRow field={field}>
          <TextFieldLabel>{opts.label()}</TextFieldLabel>

          <TextFieldInput
            disabled={disabled()}
            type={"text"}
            value={value() ?? ""}
            placeholder={placeholder()}
            onBlur={field().handleBlur}
            onInput={(e: Event) => {
              const value: string | undefined = (e.target as HTMLInputElement)
                .value;
              if (value !== undefined) {
                // FIXME: Implement affinity-type parsing
                field().handleChange({ Text: value });
              }
            }}
            data-testid="input"
          />

          {opts.nullable && (
            <Checkbox
              disabled={externDisable}
              defaultChecked={initialChecked}
              onChange={(enabled: boolean) => {
                setDisabled(!enabled);
                // NOTE: null is critical here to actively unset a cell, undefined
                // would merely take it out of the patch set.
                const value = enabled ? (initialValue ?? "Null") : "Null";
                field().handleChange(value);
              }}
              data-testid="toggle"
            />
          )}
        </FormRow>
      </TextField>
    );
  };
}

// NOTE: this is not a component but a builder:
//   "(field: () => FieldApiT<T>) => Component"
//
// The unused extra arg only exists to make this clear to eslint.
function buildDBCellField(opts: {
  name: string;
  type: ColumnDataType;
  notNull: boolean;
  isPk: boolean;
  isUpdate: boolean;
  defaultValue: string | undefined;
}): (field: () => FieldApiT<SqlValue | undefined>) => JSX.Element {
  const type = opts.type;
  const notNull = opts.notNull;

  const disabled = opts.isUpdate && opts.isPk;
  const nullable = isNullableColumn({
    type,
    notNull: notNull,
    isPk: opts.isPk,
  });

  const typeLabel = `[${type}${notNull ? "" : "?"}]`;
  const label = () => (
    <div class="flex w-[100px] flex-wrap items-center gap-1 overflow-hidden">
      <span>{opts.name} </span>

      <Show when={type === "Blob"} fallback={typeLabel}>
        <Tooltip>
          <TooltipTrigger as="div">
            <span class="text-primary">{typeLabel}</span>
          </TooltipTrigger>

          <TooltipContent>
            Binary blobs can be entered encoded as url-safe Base64.
          </TooltipContent>
        </Tooltip>
      </Show>
    </div>
  );

  function placeholder(): string | undefined {
    // Placeholders indicate default values. However, default values only apply
    // on first insert.
    if (opts.isUpdate) {
      return undefined;
    }
    const value = opts.defaultValue;
    if (value === undefined) {
      return undefined;
    }

    if (value.startsWith("(")) {
      return value;
    } else {
      const literal = literalDefault(type, value);
      if (literal === undefined || literal === null) {
        return undefined;
      }

      if (type === "Blob" && typeof literal === "string") {
        return `${literal} (decoded: ${urlSafeBase64Decode(literal)})`;
      }
      return literal.toString();
    }
  }

  switch (type) {
    case "Integer":
      return buildSqlIntegerFormField({
        label,
        disabled,
        nullable,
        placeholder: placeholder(),
      });
    case "Real":
      return buildSqlRealFormField({
        label,
        disabled,
        nullable,
        placeholder: placeholder(),
      });
    case "Text":
      return buildSqlTextFormField({
        label,
        disabled,
        nullable,
        placeholder: placeholder(),
      });
    case "Blob":
      return buildSqlBlobFormField({
        label,
        disabled,
        nullable,
        placeholder: placeholder(),
      });
    case "Any":
      return buildSqlAnyFormField({
        label,
        disabled,
        nullable,
        placeholder: placeholder(),
      });
  }
}
