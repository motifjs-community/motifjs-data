import type { FieldType } from './field-type';

export function getField(row: unknown, path: string): unknown {
  if (row === null || row === undefined) return undefined;
  if (!path.includes('.')) return (row as Record<string, unknown>)[path];
  let value: unknown = row;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function setField(row: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let target = row;
  for (const part of parts.slice(0, -1)) {
    if (target[part] === null || typeof target[part] !== 'object') target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `yyyy-mm-dd` string is read as local midnight, the way a date picker means it. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const day = ISO_DAY.exec(v);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  }
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** The day as `yyyymmdd`, so days compare as numbers. */
export function dayNumber(v: unknown): number | null {
  const d = toDate(v);
  return d ? d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() : null;
}

export function fieldTypeOf(v: unknown): FieldType {
  if (v instanceof Date) return 'datetime';
  if (typeof v === 'number' || typeof v === 'bigint') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}
