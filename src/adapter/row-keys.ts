import { and, where } from '../query/filter-builders';
import type { FilterExpression } from '../query/filter-expression';
import { getField, toDate } from '../query/values';
import type { KeyExpr } from './key-expr';

/** Reads and compares row keys. A composite key is an object of its fields: `{ orderId: 7, line: 2 }`. */
export class RowKeys<T> {
  /** `null` for a function key. */
  readonly fields: readonly string[] | null;
  private readonly fn: ((row: T) => unknown) | null;

  constructor(readonly expr: KeyExpr<T> | undefined) {
    if (typeof expr === 'function') {
      this.fields = null;
      this.fn = expr;
    } else {
      this.fields = expr === undefined ? [] : typeof expr === 'string' ? [expr] : [...expr];
      this.fn = null;
    }
  }

  get isSet(): boolean {
    return this.fn !== null || this.fields!.length > 0;
  }

  get isComposite(): boolean {
    return (this.fields?.length ?? 0) > 1;
  }

  keyOf(row: T | Partial<T>): unknown {
    if (this.fn) return this.fn(row as T);
    const fields = this.fields!;
    if (fields.length === 1) return getField(row, fields[0]);
    const key: Record<string, unknown> = {};
    for (const f of fields) key[f] = getField(row, f);
    return key;
  }

  hasKey(row: T | Partial<T>): boolean {
    if (this.fn) return this.fn(row as T) !== undefined;
    return this.fields!.length > 0 && this.fields!.every((f) => !isEmptyKeyPart(getField(row, f)));
  }

  sameKey(a: unknown, b: unknown): boolean {
    if (!this.isComposite) return sameKeyPart(a, b);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return this.fields!.every((f) => sameKeyPart((a as Record<string, unknown>)[f], (b as Record<string, unknown>)[f]));
  }

  /** Equal strings for equal keys, for use in maps and sets. */
  keyString(key: unknown): string {
    if (this.isComposite && key && typeof key === 'object') {
      return this.fields!.map((f) => keyPartString((key as Record<string, unknown>)[f])).join('|');
    }
    return keyPartString(key);
  }

  /** `null` for a function key, which has no field to filter on. */
  keyFilter(key: unknown): FilterExpression | null {
    const fields = this.fields;
    if (!fields || fields.length === 0) return null;
    if (fields.length === 1) return where(fields[0], '=', key);
    return and(...fields.map((f) => where(f, '=', (key as Record<string, unknown>)?.[f])));
  }
}

function isEmptyKeyPart(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function sameKeyPart(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const time = toDate(a)?.getTime();
    return time !== undefined && time === toDate(b)?.getTime();
  }
  return Object.is(a, b);
}

function keyPartString(v: unknown): string {
  if (v instanceof Date) return `d${v.getTime()}`;
  if (v === null) return 'z';
  switch (typeof v) {
    case 'number':
      return `n${v}`;
    case 'string':
      return `s${v.length}:${v}`;
    case 'boolean':
      return `b${v}`;
    case 'bigint':
      return `i${v}`;
    case 'undefined':
      return 'u';
    default:
      return `j${JSON.stringify(v)}`;
  }
}
