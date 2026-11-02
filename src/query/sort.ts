import { Query } from '@motifx/core';
import type { EvaluateContext } from './evaluate-context';
import type { SortItem } from './sort-item';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty } from './values';

/**
 * Row positions in sort order, stable. Values are turned into numbers first (text ranked with the
 * locale's collation, or by the context's `compare`), so `Query.orderBy` can sort them; empty values
 * go last both ways.
 */
export function sortedIndexes<T>(rows: readonly T[], sort: readonly SortItem[], ctx: EvaluateContext = {}): number[] {
  const indexes = rows.map((_, i) => i);
  if (sort.length === 0 || rows.length < 2) return indexes;

  const keys = sort.map((item) => sortKeys(rows, item.field, ctx));
  let order = Query.from(indexes);
  // orderBy is stable: sorting by the last field first gives the multi-field order.
  for (let k = sort.length - 1; k >= 0; k--) {
    const key = keys[k];
    const desc = sort[k].dir === 'desc';
    order = order.orderBy((i) => (key[i] === null ? Number.POSITIVE_INFINITY : desc ? -key[i]! : key[i]!));
  }
  return order.toArray();
}

export function sortRows<T>(rows: readonly T[], sort: readonly SortItem[], ctx: EvaluateContext = {}): T[] {
  return sortedIndexes(rows, sort, ctx).map((i) => rows[i]);
}

function sortKeys<T>(rows: readonly T[], field: string, ctx: EvaluateContext): (number | null)[] {
  const read = ctx.sortValue?.(field);
  const raw = rows.map((row) => (read ? read(row) : getField(row, field)));
  const compare = ctx.compare?.(field);
  if (compare) return ranks(raw, compare);
  const sample = raw.find((v) => v !== null && v !== undefined && v !== '');
  const cmp = new ValueComparer(ctx.fields?.[field] ?? fieldTypeOf(sample), ctx.locale);
  const values = raw.map((v) => cmp.toComparable(v));
  if (!values.some((v) => typeof v === 'string')) return values.map((v) => (v === null ? null : Number(v)));

  const distinct = [...new Set(values.filter((v): v is string => typeof v === 'string'))].sort((a, b) => cmp.compare(a, b));
  const rank = new Map(distinct.map((v, i) => [v, i]));
  return values.map((v) => (v === null ? null : rank.get(v as string)!));
}

// Equal values share a rank; empty values get none.
function ranks(values: readonly unknown[], compare: (a: unknown, b: unknown) => number): (number | null)[] {
  const order = values.map((_, i) => i).filter((i) => !isEmpty(values[i]));
  order.sort((a, b) => compare(values[a], values[b]));
  const out = new Array<number | null>(values.length).fill(null);
  let rank = 0;
  order.forEach((i, k) => {
    if (k > 0 && compare(values[order[k - 1]], values[i]) !== 0) rank++;
    out[i] = rank;
  });
  return out;
}
