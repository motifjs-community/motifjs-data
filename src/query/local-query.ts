import { Query } from '@motifx/core';
import type { EvaluateContext } from './evaluate-context';
import { groupContext, groupOrder, groupRows, rowsOfGroups } from './grouping';
import type { LoadOptions } from './load-options';
import type { LoadResult } from './load-result';
import type { RowGroup } from './row-group';
import { createRowFilter } from './row-filter';
import { sortedIndexes } from './sort';
import { summarize } from './summaries';
import { getField, setField } from './values';

/**
 * Runs load options on rows in memory: filter, sort, group, count, page, select, summaries. Without
 * `select` the rows in the result are the same objects. A group field is read by the context's
 * `groupValue` when it gives one.
 */
export function queryArray<T>(rows: readonly T[], options: LoadOptions = {}, ctx: EvaluateContext = {}): LoadResult<T> {
  let query = Query.from(rows);
  if (options.filter) query = query.where(createRowFilter<T>(options.filter, ctx));
  const order = groupOrder(options.group, options.sort);
  if (order.length) {
    const filtered = query.toArray();
    query = Query.from(sortedIndexes(filtered, order, groupContext(options.group, ctx))).select((i) => filtered[i]);
  }
  const matched = query.toArray();
  const skip = Math.max(0, Math.floor(options.skip ?? 0));
  const end = options.take === undefined ? undefined : skip + Math.max(0, Math.floor(options.take));
  const paged = skip > 0 || end !== undefined;
  const pick = options.select?.length ? (row: T) => pickFields(row, options.select!) : null;
  const result: LoadResult<T> = { rows: [] };

  if (options.group?.length) {
    const all = groupRows(matched, options.group, options.groupSummary, ctx, !options.groupsOnly);
    const groups = paged ? all.slice(skip, end) : all;
    result.groups = pick && !options.groupsOnly ? pickInGroups(groups, pick) : groups;
    result.rows = options.groupsOnly ? [] : rowsOfGroups(result.groups);
    if (options.count) result.groupCount = all.length;
  } else {
    const page = paged ? matched.slice(skip, end) : matched;
    result.rows = pick ? page.map(pick) : page;
  }
  if (options.count) result.total = matched.length;
  if (options.summary?.length) result.summary = summarize(matched, options.summary, ctx);
  return result;
}

export function pickFields<T>(row: T, fields: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const f of fields) setField(out, f, getField(row, f));
  return out as T;
}

function pickInGroups<T>(groups: readonly RowGroup<T>[], pick: (row: T) => T): RowGroup<T>[] {
  return groups.map((g) => (g.groups ? { ...g, groups: pickInGroups(g.groups, pick) } : { ...g, items: g.items?.map(pick) }));
}
