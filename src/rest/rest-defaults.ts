import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { PivotLevel } from '../query/pivot-level';
import type { PivotLoadOptions } from '../query/pivot-load-options';

export function defaultLoadQuery(options: LoadOptions): Record<string, string | number | boolean | undefined> {
  return {
    skip: options.skip,
    take: options.take,
    count: options.count || undefined,
    sort: options.sort?.length ? options.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',') : undefined,
    filter: options.filter ? JSON.stringify(options.filter) : undefined,
    select: options.select?.length ? options.select.join(',') : undefined,
    expand: options.expand?.length ? options.expand.join(',') : undefined,
  };
}

export function defaultReadRows<T>(body: unknown, options: LoadOptions): LoadResult<T> {
  if (Array.isArray(body)) {
    // A plain array is the whole result only when no page was asked for.
    const whole = options.skip === undefined && options.take === undefined;
    return options.count && whole ? { rows: body, total: body.length } : { rows: body };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const rows = [b.rows, b.items, b.data, b.value].find(Array.isArray) as T[] | undefined;
  const total = [b.total, b.totalCount, b.count, b['@odata.count']].find((v) => typeof v === 'number') as number | undefined;
  return total === undefined ? { rows: rows ?? [] } : { rows: rows ?? [], total };
}

/**
 * The body a pivot sends: `{ filter, keep, rows, columns, measures, expandedRows, expandedColumns }`, the levels as
 * `{ field, interval, dir }`, the measures as `{ type, field, skipEmpty }` and the members kept as
 * `{ field, intervals, paths, type, filter }`, missing ones left out; the filter is `null` without one, the expanded
 * members `true` for all.
 */
export function defaultPivotBody(options: PivotLoadOptions<any>): Record<string, unknown> {
  const level = ({ field, interval, dir }: PivotLevel<any>) => ({ field, interval, dir });
  return {
    filter: options.filter ?? null,
    keep: (options.keep ?? []).map(({ field, intervals, paths, type, filter }) => ({ field, intervals: intervals ?? [], paths, type: type ?? 'include', filter })),
    rows: (options.rows ?? []).map(level),
    columns: (options.columns ?? []).map(level),
    measures: (options.measures ?? []).map((m) => ({ type: m.type, field: m.field, skipEmpty: m.type === 'custom' ? undefined : m.skipEmpty })),
    expandedRows: options.expandedRows ?? true,
    expandedColumns: options.expandedColumns ?? true,
  };
}

/** The groups of a pivot's answer: the body when it is an array, or its `groups`. */
export function defaultReadPivot(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) throw new TypeError('no "groups" array');
  return groups;
}

export function defaultReadSaved<T>(body: unknown): Partial<T> | void {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Partial<T>) : undefined;
}
