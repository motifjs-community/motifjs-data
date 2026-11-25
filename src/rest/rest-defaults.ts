import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { PivotBlocksOptions } from '../query/pivot-blocks-options';
import type { PivotCellsOptions } from '../query/pivot-cells-options';
import type { PivotCountsOptions } from '../query/pivot-counts-options';
import type { PivotLevel } from '../query/pivot-level';
import type { PivotLoadOptions } from '../query/pivot-load-options';
import type { PivotMeasure } from '../query/pivot-measure';
import type { PivotMembersOptions } from '../query/pivot-members-options';
import type { PivotSummarySort } from '../query/pivot-summary-sort';
import type { RestPivotPart, RestPivotPartOptions } from './rest-pivot-part';

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

/**
 * The body of a part of a pivot, `kind` first, the levels, measures and members kept as `defaultPivotBody` writes them:
 * `{ kind: 'members', filter, keep, levels, slices: [{ parent, skip, take }], measures, sortBySummary, childCounts, find,
 * nonEmpty }` (with `descendants`, a number of levels, where it is asked for), `{ kind: 'counts', filter, keep, levels,
 * paths, measures, nonEmpty }`, `{ kind: 'cells', filter, keep, rows, columns, measures, rowPaths, columnPaths }`, with
 * `running: [{ measure, axis, orders }]` where running totals are asked for, or `{ kind: 'blocks', filter, keep, levels,
 * parents, size, depth, measures, sortBySummary, nonEmpty }` (`size` is `null` for one block per parent).
 */
export function defaultPivotPartBody(kind: RestPivotPart, options: RestPivotPartOptions<any>): Record<string, unknown> {
  const level = ({ field, interval, dir }: PivotLevel<any>) => ({ field, interval, dir });
  const measure = (m: PivotMeasure<any>) => ({ type: m.type, field: m.field, skipEmpty: m.type === 'custom' ? undefined : m.skipEmpty });
  const sortOf = (sort: PivotSummarySort<any> | null | undefined) => (sort ? { measure: sort.measure, levels: (sort.levels ?? []).map(level), path: sort.path ?? [] } : null);
  const keep = (options.keep ?? []).map(({ field, intervals, paths, type, filter }) => ({ field, intervals: intervals ?? [], paths, type: type ?? 'include', filter }));
  const base = { kind, filter: options.filter ?? null, keep };
  if (kind === 'members') {
    const o = options as PivotMembersOptions<any>;
    const body: Record<string, unknown> = {
      ...base,
      levels: o.levels.map(level),
      slices: o.slices.map(({ parent, skip, take }) => ({ parent, skip: skip ?? 0, take })),
      measures: (o.measures ?? []).map(measure),
      sortBySummary: sortOf(o.sortBySummary),
      childCounts: !!o.childCounts,
      find: o.find ?? [],
      nonEmpty: !!o.nonEmpty,
    };
    if (o.descendants) body.descendants = o.descendants;
    return body;
  }
  if (kind === 'blocks') {
    const o = options as PivotBlocksOptions<any>;
    return {
      ...base,
      levels: o.levels.map(level),
      parents: o.parents,
      size: o.size ?? null,
      depth: o.depth,
      measures: (o.measures ?? []).map(measure),
      sortBySummary: sortOf(o.sortBySummary),
      nonEmpty: !!o.nonEmpty,
    };
  }
  if (kind === 'counts') {
    const o = options as PivotCountsOptions<any>;
    return { ...base, levels: o.levels.map(level), paths: o.paths, measures: (o.measures ?? []).map(measure), nonEmpty: !!o.nonEmpty };
  }
  const o = options as PivotCellsOptions<any>;
  const cells: Record<string, unknown> = { ...base, rows: o.rows.map(level), columns: o.columns.map(level), measures: o.measures.map(measure), rowPaths: o.rowPaths, columnPaths: o.columnPaths };
  if (o.running?.length) {
    cells.running = o.running.map((r) => ({ measure: r.measure, axis: r.axis, orders: (r.orders ?? []).map(sortOf) }));
  }
  return cells;
}

/** A part's answer: the body for members (`{ slices }`), counts (`{ counts }`) and blocks (`{ blocks }`); for cells the body when it is an array, or its `groups`. */
export function defaultReadPivotPart(kind: RestPivotPart, body: unknown): unknown {
  return kind === 'cells' ? defaultReadPivot(body) : body;
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
