import type { JsonSchema, SchemaFormat, SchemaTypeName } from './json-schema';
import { schemaProblem, type SchemaProblem } from './schema-problem';

export type { JsonSchema, SchemaFormat, SchemaTypeName } from './json-schema';
export { SCHEMA_PROBLEM_TEXTS, schemaProblemText } from './schema-problem';
export type { SchemaProblem, SchemaProblemCode } from './schema-problem';

/** What validating a value gives: whether it fits, and each problem where it is. */
export interface ValidateResult {
  valid: boolean;
  problems: SchemaProblem[];
}

const TYPES: readonly SchemaTypeName[] = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const FORMATS: readonly SchemaFormat[] = ['date', 'date-time', 'email', 'uri'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isDay(year: string, month: string, day: string): boolean {
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(Number(year), m, 0)).getUTCDate();
}

/** Whether a text is in a format: a real day, a moment with its offset, an email address, an absolute address. */
export function matchesFormat(format: SchemaFormat, text: string): boolean {
  switch (format) {
    case 'date': {
      const m = DAY.exec(text);
      return !!m && isDay(m[1], m[2], m[3]);
    }
    case 'date-time': {
      const m = MOMENT.exec(text);
      return !!m && isDay(m[1], m[2], m[3]) && Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6]) <= 60 && (m[9] === undefined || (Number(m[9]) <= 23 && Number(m[10]) <= 59));
    }
    case 'email':
      return EMAIL.test(text);
    case 'uri':
      return URI.test(text);
  }
}

/** The type of a value as a schema names it; `nothing` for a value that is not there. */
export function typeOfValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'not a number';
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
  return isRecord(value) ? 'object' : typeof value;
}

function isOfType(type: SchemaTypeName, value: unknown): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return typeof value === type;
  }
}

/** Whether two values are the same as JSON: lists item by item, objects field by field. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b) || (a === 0 && b === 0)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, k) => sameValue(item, b[k]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => own(b, key) && sameValue(a[key], b[key]));
  }
  return false;
}

const typesOf = (schema: JsonSchema): readonly SchemaTypeName[] | null =>
  schema.type === undefined ? null : typeof schema.type === 'string' ? [schema.type] : schema.type;

const written = (value: unknown) => (typeof value === 'string' ? `'${value}'` : JSON.stringify(value));

function visit(schema: JsonSchema, value: unknown, path: (string | number)[], out: SchemaProblem[]): void {
  const types = typesOf(schema);
  if (types && !types.some((type) => isOfType(type, value))) {
    out.push(schemaProblem('type', path, { expected: types.join(' or '), found: typeOfValue(value) }));
    return;
  }
  if (schema.const !== undefined && !sameValue(value, schema.const)) out.push(schemaProblem('const', path, { value: written(schema.const) }));
  if (schema.enum && !schema.enum.some((one) => sameValue(one, value))) out.push(schemaProblem('enum', path, { values: schema.enum.map(written).join(', ') }));
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.push(schemaProblem('minimum', path, { limit: schema.minimum }));
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.push(schemaProblem('maximum', path, { limit: schema.maximum }));
  }
  if (typeof value === 'string') {
    // A text's length is its characters, as they are read, not the units it is stored in.
    const length = [...value].length;
    if (isCount(schema.minLength) && length < schema.minLength!) out.push(schemaProblem('minLength', path, { limit: schema.minLength! }));
    if (isCount(schema.maxLength) && length > schema.maxLength!) out.push(schemaProblem('maxLength', path, { limit: schema.maxLength! }));
    if (typeof schema.pattern === 'string' && !patternOf(schema.pattern)?.test(value)) out.push(schemaProblem('pattern', path, { pattern: schema.pattern }));
    if (schema.format && FORMATS.includes(schema.format) && !matchesFormat(schema.format, value)) out.push(schemaProblem('format', path, { format: schema.format }));
  }
  if (isRecord(value)) {
    for (const name of schema.required ?? []) if (!own(value, name) || value[name] === undefined) out.push(schemaProblem('required', [...path, name], { name }));
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
      if (own(value, name) && value[name] !== undefined) visit(field, value[name], [...path, name], out);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, k) => visit(schema.items!, item, [...path, k], out));
}

const patterns = new Map<string, RegExp | null>();

/** A pattern's regular expression, made once; `null` for one that does not read. */
function patternOf(pattern: string): RegExp | null {
  if (!patterns.has(pattern)) {
    let made: RegExp | null = null;
    try {
      made = new RegExp(pattern, 'u');
    } catch {
      made = null;
    }
    patterns.set(pattern, made);
  }
  return patterns.get(pattern)!;
}

/**
 * Validates a value against a schema: every problem, each where it is (`path`: the keys and indexes down to it). A
 * value of the wrong type is not looked into further. The schema is read as it is: what `check` reports is not
 * applied.
 */
export function validate(schema: JsonSchema, value: unknown): ValidateResult {
  const problems: SchemaProblem[] = [];
  visit(schema, value, [], problems);
  return { valid: problems.length === 0, problems };
}

/** The keys of a schema this package reads, and what each one's value should be. */
const KEYWORDS: Record<string, { expected: string; fits: (value: unknown) => boolean }> = {
  type: {
    expected: `one of ${TYPES.join(', ')}, or a list of them`,
    fits: (value) => (typeof value === 'string' ? TYPES.includes(value as SchemaTypeName) : Array.isArray(value) && value.length > 0 && value.every((t) => TYPES.includes(t))),
  },
  title: { expected: 'a text', fits: (value) => typeof value === 'string' },
  description: { expected: 'a text', fits: (value) => typeof value === 'string' },
  default: { expected: 'a value', fits: () => true },
  enum: { expected: 'a list of values', fits: (value) => Array.isArray(value) && value.length > 0 },
  const: { expected: 'a value', fits: () => true },
  minimum: { expected: 'a number', fits: (value) => typeof value === 'number' && Number.isFinite(value) },
  maximum: { expected: 'a number', fits: (value) => typeof value === 'number' && Number.isFinite(value) },
  minLength: { expected: 'a whole number, 0 or more', fits: isCount },
  maxLength: { expected: 'a whole number, 0 or more', fits: isCount },
  pattern: { expected: 'a regular expression', fits: (value) => typeof value === 'string' && patternOf(value) !== null },
  format: { expected: `one of ${FORMATS.join(', ')}`, fits: (value) => FORMATS.includes(value as SchemaFormat) },
  required: { expected: 'a list of field names', fits: (value) => Array.isArray(value) && value.every((name) => typeof name === 'string') },
  properties: { expected: 'an object of schemas', fits: (value) => isRecord(value) && Object.values(value).every(isRecord) },
  items: { expected: 'a schema', fits: isRecord },
  $schema: { expected: 'a text', fits: (value) => typeof value === 'string' },
  $id: { expected: 'a text', fits: (value) => typeof value === 'string' },
  $comment: { expected: 'a text', fits: (value) => typeof value === 'string' },
  examples: { expected: 'a list of values', fits: Array.isArray },
};

function checkAt(schema: unknown, path: (string | number)[], out: SchemaProblem[]): void {
  if (!isRecord(schema)) {
    out.push(schemaProblem('badKeyword', path, { keyword: String(path[path.length - 1] ?? 'schema'), expected: 'a schema' }));
    return;
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith('x-')) continue;
    const known = KEYWORDS[key];
    if (!known) out.push(schemaProblem('unsupportedKeyword', [...path, key], { keyword: key }));
    else if (!known.fits(value)) out.push(schemaProblem('badKeyword', [...path, key], { keyword: key, expected: known.expected }));
  }
  if (isRecord(schema.properties)) for (const [name, field] of Object.entries(schema.properties)) if (isRecord(field)) checkAt(field, [...path, 'properties', name], out);
  if (isRecord(schema.items)) checkAt(schema.items, [...path, 'items'], out);
}

/**
 * The problems of a schema itself: a key this package does not read (`unsupportedKeyword`), whose rule would be
 * left out silently, and a key whose value is not what it should be (`badKeyword`), each where it is.
 */
export function check(schema: JsonSchema): SchemaProblem[] {
  const out: SchemaProblem[] = [];
  checkAt(schema, [], out);
  return out;
}

const copy = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * The value a schema starts with: its `const` or its `default`, and for an object the fields that have one (an
 * object field when any of its own fields has one). `undefined` when it has none.
 */
export function defaults(schema: JsonSchema): unknown {
  return startOf(schema, true);
}

function startOf(schema: JsonSchema, root: boolean): unknown {
  if (schema.const !== undefined) return copy(schema.const);
  if (schema.default !== undefined) return copy(schema.default);
  if (!schema.properties) return undefined;
  const made: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = startOf(field, false);
    if (value !== undefined) made[name] = value;
  }
  return root || Object.keys(made).length ? made : undefined;
}
