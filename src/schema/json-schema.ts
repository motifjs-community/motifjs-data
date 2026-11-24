/** A type of value a schema may ask for: `integer` is a number with no fraction. */
export type SchemaTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** The formats a text may be asked to be in: a day (`2026-01-31`), a moment with its offset, an email address, an absolute address. */
export type SchemaFormat = 'date' | 'date-time' | 'email' | 'uri';

/**
 * A schema of a value, in the subset of JSON Schema this package reads: the type, the words for a reader (`title`,
 * `description`), the value it starts with (`default`), the values it may take (`enum`, `const`), the bounds of a
 * number and of a text, a pattern and a format of a text, the fields of an object and which of them must be there, and
 * the items of a list. A key that starts with `x-` is the application's own: it is kept and not checked. Any other key
 * is not read, and `check` reports it.
 */
export interface JsonSchema {
  type?: SchemaTypeName | readonly SchemaTypeName[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: readonly unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** A regular expression the text matches somewhere; write `^…$` for the whole text. */
  pattern?: string;
  format?: SchemaFormat;
  /** The fields of an object that must be there (a field may still be `null` when its type allows it). */
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
  $schema?: string;
  $id?: string;
  $comment?: string;
  examples?: readonly unknown[];
  [extension: `x-${string}`]: unknown;
}
