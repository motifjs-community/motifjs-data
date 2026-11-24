/** What can be wrong with a value against a schema, or with a schema itself (`unsupportedKeyword`, `badKeyword`). */
export type SchemaProblemCode =
  | 'type'
  | 'required'
  | 'enum'
  | 'const'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'format'
  | 'unsupportedKeyword'
  | 'badKeyword';

/** The text of each problem in English, with its `{params}`; a user interface gives its own, by the code. */
export const SCHEMA_PROBLEM_TEXTS: Record<SchemaProblemCode, string> = {
  type: 'The value is {found}; {expected} is wanted.',
  required: '{name} is required.',
  enum: 'The value is not one of {values}.',
  const: 'The value must be {value}.',
  minimum: 'The value is less than {limit}.',
  maximum: 'The value is more than {limit}.',
  minLength: 'The text is shorter than {limit} characters.',
  maxLength: 'The text is longer than {limit} characters.',
  pattern: 'The text does not match {pattern}.',
  format: 'The text is not in the {format} format.',
  unsupportedKeyword: '{keyword} is not read; the value is not checked against it.',
  badKeyword: '{keyword} should be {expected}.',
};

/**
 * A problem of a value, or of a schema: its code, where it is (the keys and indexes down to the value; for a schema,
 * down to the keyword), the values its text names, and that text in English.
 */
export interface SchemaProblem {
  code: SchemaProblemCode;
  path: (string | number)[];
  params: Record<string, string | number>;
  message: string;
}

export function schemaProblemText(code: SchemaProblemCode, params: Record<string, string | number>): string {
  return SCHEMA_PROBLEM_TEXTS[code].replace(/\{(\w+)\}/g, (part, name: string) => (name in params ? String(params[name]) : part));
}

export function schemaProblem(code: SchemaProblemCode, path: (string | number)[], params: Record<string, string | number> = {}): SchemaProblem {
  return { code, path, params, message: schemaProblemText(code, params) };
}
