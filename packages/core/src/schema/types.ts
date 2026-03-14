// schema/types.ts
// General-purpose JSON Schema — not owned by any specific module

/** JSON Schema representation for tool parameters and validation */
export interface JsonSchema {
  readonly type: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
  readonly [key: string]: unknown;
}
