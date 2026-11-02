import { Query } from '@motifx/core';
import type { EvaluateContext } from './evaluate-context';
import type { GroupItem } from './group-item';
import type { RowGroup } from './row-group';
import type { SortItem } from './sort-item';
import { summarize } from './summaries';
import type { SummaryItem } from './summary-item';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty } from './values';

/** The sort order grouping needs: the group fields first, then `sort`. */
export function groupOrder(group: readonly GroupItem[] | undefined, sort: readonly SortItem[] | undefined): SortItem[] {
  return [...(group ?? []).map((g): SortItem => ({ field: g.field, dir: g.dir ?? 'asc' })), ...(sort ?? [])];
}

/**
 * The context rows are put in group order with. With a `groupValue` in the context, a group field is
 * read by it (the field itself when it gives none), not by `sortValue`; a value of its own has its own
 * type and no `compare`. A `groupCompare` orders a field's groups in every case.
 */
export function groupContext(group: readonly GroupItem[] | undefined, ctx: EvaluateContext): EvaluateContext {
  const groupValue = ctx.groupValue;
  if ((!groupValue && !ctx.groupCompare) || !group?.length) return ctx;
  const grouped = new Set(group.map((g) => g.field));
  const own = new Set([...grouped].filter((f) => groupValue?.(f)));
  const order = (field: string) => (grouped.has(field) ? ctx.groupCompare?.(field) : undefined);
  if (!groupValue) return { ...ctx, compare: (field) => order(field) ?? ctx.compare?.(field) };
  const fields = { ...(ctx.fields ?? {}) };
  for (const f of own) delete fields[f];
  return {
    ...ctx,
    fields,
    sortValue: (field) => (grouped.has(field) ? (groupValue(field) ?? ((row: unknown) => getField(row, field))) : ctx.sortValue?.(field)),
    compare: (field) => order(field) ?? (own.has(field) ? undefined : ctx.compare?.(field)),
  };
}

/**
 * Groups rows already in `groupOrder`. Values group the way filters compare them: text without case
 * in the locale, declared dates by day; empty values form one group with the key `null`. With
 * `withItems` false the groups hold no rows, only their counts.
 */
export function groupRows<T>(
  rows: readonly T[],
  group: readonly GroupItem[],
  summary: readonly SummaryItem[] | undefined,
  ctx: EvaluateContext = {},
  withItems = true,
): RowGroup<T>[] {
  const [level, ...below] = group;
  const own = ctx.groupValue?.(level.field);
  const read = own ?? ((row: T) => getField(row, level.field));
  const sample = rows.map((row) => read(row)).find((value) => !isEmpty(value));
  const cmp = new ValueComparer((own ? undefined : ctx.fields?.[level.field]) ?? fieldTypeOf(sample), ctx.locale);
  return Query.from(rows)
    .groupBy((row) => cmp.toComparable(read(row)))
    .select(({ items }) => {
      const first = read(items[0]);
      const result: RowGroup<T> = { field: level.field, key: isEmpty(first) ? null : first, count: items.length };
      if (below.length) result.groups = groupRows(items, below, summary, ctx, withItems);
      else if (withItems) result.items = items;
      if (summary?.length) result.summary = summarize(items, summary, ctx);
      return result;
    })
    .toArray();
}

/** The rows of the last level, in group order. */
export function rowsOfGroups<T>(groups: readonly RowGroup<T>[]): T[] {
  return groups.flatMap((g) => (g.groups ? rowsOfGroups(g.groups) : (g.items ?? [])));
}
