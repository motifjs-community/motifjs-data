import { compareTemporal, formatDate, toTemporal } from './dates';
import { Day } from './day';

/** The kinds of the values an expression works with, as `typeOf` names them. */
export type ValueKind = 'null' | 'number' | 'text' | 'boolean' | 'date' | 'datetime' | 'list' | 'object';

/** Whether a value is an object of fields: not a list, a day or a moment. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Day) && !(value instanceof Date);
}

export function kindOf(value: unknown): ValueKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Day) return 'date';
  if (value instanceof Date) return 'datetime';
  if (Array.isArray(value)) return 'list';
  return 'object';
}

/** A field of an object: its own, never one it inherits (`constructor`, say); `null` when it has none. */
export function own(value: Record<string, unknown>, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, name) ? (value[name] ?? null) : null;
}

/** A value as text: `null` is empty, a day `YYYY-MM-DD`, a moment `YYYY-MM-DD HH:MM:SS` in the time zone, a list or an object JSON. */
export function toText(value: unknown, timeZone: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Day) return value.toString();
  if (value instanceof Date) return formatDate(value, 'yyyy-MM-dd HH:mm:ss', undefined, timeZone);
  return JSON.stringify(value);
}

/** A day or a moment, of a value that is one or a text that reads as one; else `undefined`. */
function temporal(value: unknown, timeZone: string): Day | Date | undefined {
  if (value instanceof Day || value instanceof Date) return value;
  if (typeof value !== 'string') return undefined;
  return toTemporal(value, timeZone) ?? undefined;
}

/**
 * Whether two values are the same: by value, lists and objects by their items and fields; a day or a moment also
 * equals a text that reads as it.
 */
export function equal(a: unknown, b: unknown, timeZone: string): boolean {
  a ??= null;
  b ??= null;
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a instanceof Day || a instanceof Date || b instanceof Day || b instanceof Date) {
    const x = temporal(a, timeZone);
    const y = temporal(b, timeZone);
    return x !== undefined && y !== undefined && compareTemporal(x, y, timeZone) === 0;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, k) => equal(item, b[k], timeZone));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key], timeZone));
  }
  return false;
}

/**
 * How two values sort: below zero when `a` comes first. Numbers by size, texts by their characters (the same in every
 * culture), days and moments by time (a text that reads as one too). `null` when either is `null`; `undefined` for two
 * that do not compare.
 */
export function compare(a: unknown, b: unknown, timeZone: string): number | null | undefined {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Day || a instanceof Date || b instanceof Day || b instanceof Date) {
    const x = temporal(a, timeZone);
    const y = temporal(b, timeZone);
    return x !== undefined && y !== undefined ? compareTemporal(x, y, timeZone) : undefined;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}
