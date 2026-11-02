import type { FieldType } from '../query/field-type';
import { toDate } from '../query/values';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A value as an OData v4 literal: `'O''Brien'`, `12.5`, `true`, `2024-03-05`, `2024-03-05T10:00:00.000Z`,
 * a GUID without quotes. Throws a `TypeError` for a value the type cannot hold.
 */
export function odataLiteral(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return 'null';
  switch (type) {
    case 'number':
      return numberLiteral(value);
    case 'boolean':
      return String(typeof value === 'string' ? value.toLowerCase() === 'true' : !!value);
    case 'guid':
      if (!GUID.test(String(value))) throw new TypeError(`"${String(value)}" is not a GUID`);
      return String(value);
    case 'date':
    case 'datetime': {
      const date = toDate(value);
      if (!date) throw new TypeError(`"${String(value)}" is not a date`);
      return type === 'date' ? dayText(date) : date.toISOString();
    }
    default:
      return `'${(value instanceof Date ? value.toISOString() : String(value)).replace(/'/g, "''")}'`;
  }
}

/** `customer.name` → `customer/name`. */
export function odataPath(field: string): string {
  return field.replace(/\./g, '/');
}

/** `['customer', 'items.product']` → `customer,items($expand=product)`. A path with `(` is used as written. */
export function odataExpand(paths: readonly string[]): string {
  const tree = new Map<string, string[]>();
  for (const path of paths) {
    const dot = path.includes('(') ? -1 : path.indexOf('.');
    const name = dot < 0 ? path : path.slice(0, dot);
    const children = tree.get(name) ?? [];
    if (dot >= 0) children.push(path.slice(dot + 1));
    tree.set(name, children);
  }
  return [...tree].map(([name, children]) => (children.length ? `${name}($expand=${odataExpand(children)})` : name)).join(',');
}

/** The local day as `yyyy-mm-dd`, the way `date` fields are compared in memory. */
export function dayText(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function numberLiteral(value: unknown): string {
  if (typeof value === 'bigint') return String(value);
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (Number.isNaN(n)) throw new TypeError(`"${String(value)}" is not a number`);
  return n === Infinity ? 'INF' : n === -Infinity ? '-INF' : String(n);
}
