import type { EvaluateContext } from './evaluate-context';
import type { FieldType } from './field-type';
import { keeper, measureRule, PivotAxis, pivotGroups, pivotResult, readKey, readValue } from './pivot';
import type { PivotCellsOptions } from './pivot-cells-options';
import type { PivotCellsResult } from './pivot-cells-result';
import type { PivotCountsOptions } from './pivot-counts-options';
import type { PivotCountsResult } from './pivot-counts-result';
import type { PivotGroup } from './pivot-group';
import type { PivotLevel } from './pivot-level';
import type { PivotMember } from './pivot-member';
import type { PivotMembersOptions } from './pivot-members-options';
import type { PivotMembersResult } from './pivot-members-result';
import type { PivotSliceMember } from './pivot-slice-member';
import type { SummaryAccumulator } from './summaries';
import { createRowFilter } from './row-filter';

/**
 * The members `loadPivotMembers` asks for, over rows in memory: every child of each slice's parent is grouped and
 * ordered as `queryPivot` orders them (or by `sortBySummary`), then the slice's part is taken.
 */
export function pivotMembers<T>(rows: readonly T[], options: PivotMembersOptions<T>, ctx: EvaluateContext = {}): PivotMembersResult {
  const depth = options.slices[0]?.parent.length ?? 0;
  const levels = options.levels.slice(0, Math.min(depth + (options.childCounts ? 2 : 1), options.levels.length));
  const upper = new PivotAxis<T>(options.levels.slice(0, depth), ctx);
  const parents = new Set(options.slices.map((slice) => upper.idOf(slice.parent)));
  const sort = options.sortBySummary;
  const path = sort?.path ?? [];
  const columns = (sort?.levels ?? []).slice(0, path.length);
  const under = depth ? rows.filter((row) => upper.holds(row, parents)) : rows;
  const query = { filter: options.filter, keep: options.keep, rows: levels, columns, measures: options.measures, expandedRows: true as const, expandedColumns: prefixes([path]) };
  const result = pivotResult(pivotGroups(under, query, ctx), query, ctx);
  const axis = new PivotAxis<T>(levels, ctx);
  const total = result.columns;
  const at = memberAt(result.columns, path, new PivotAxis<T>(columns, ctx));
  const dir = options.levels[depth]?.dir;
  const measures = options.measures ?? [];
  return {
    slices: options.slices.map((slice) => {
      const parent = memberAt(result.rows, slice.parent, axis);
      let children = parent?.children ?? [];
      if (sort) children = bySummary(children, (m) => (at ? result.values(m, at)?.[sort.measure] : undefined), dir);
      const skip = Math.max(0, slice.skip ?? 0);
      const part = slice.take === undefined ? children.slice(skip) : children.slice(skip, skip + Math.max(0, slice.take));
      return {
        parent: slice.parent,
        total: children.length,
        members: part.map((m) => {
          const out: PivotSliceMember = { key: m.key, path: [...slice.parent, m.key], count: m.count, values: result.values(m, total) ?? measures.map(() => null) };
          if (options.childCounts) out.childCount = m.children?.length ?? 0;
          return out;
        }),
      };
    }),
  };
}

/** The numbers `loadPivotCounts` asks for, over rows in memory. */
export function pivotCounts<T>(rows: readonly T[], options: PivotCountsOptions<T>, ctx: EvaluateContext = {}): PivotCountsResult {
  const deepest = options.paths.reduce((most, path) => Math.max(most, path.length), 0);
  const levels = options.levels.slice(0, Math.min(deepest + 1, options.levels.length));
  const query = { filter: options.filter, keep: options.keep, rows: levels, columns: [], measures: [], expandedRows: prefixes(options.paths, true) };
  const result = pivotResult(pivotGroups(rows, query, ctx), query, ctx);
  const axis = new PivotAxis<T>(levels, ctx);
  return { childCount: (path) => memberAt(result.rows, path, axis)?.children?.length ?? 0 };
}

/** The crossings `loadPivotCells` asks for, over rows in memory: one pass, each row counted in the crossings asked for that it falls in. */
export function pivotCells<T>(rows: readonly T[], options: PivotCellsOptions<T>, ctx: EvaluateContext = {}): PivotCellsResult {
  const rowAxis = new PivotAxis<T>(options.rows, ctx);
  const columnAxis = new PivotAxis<T>(options.columns, ctx);
  const rowWanted = byDepth(options.rowPaths, rowAxis);
  const columnWanted = byDepth(options.columnPaths, columnAxis);
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const rules = options.measures.map((measure) => measureRule(measure, ctx));
  const cells = new Map<string, { count: number; sums: SummaryAccumulator[] }>();
  const rowIds: string[] = [];
  const columnIds: string[] = [];
  const values: unknown[] = new Array(rules.length);
  for (const row of rows) {
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    rowAxis.ids(row, rowIds);
    columnAxis.ids(row, columnIds);
    let read = false;
    for (const [rowDepth, rowSet] of rowWanted) {
      const rowId = rowDepth ? rowIds[rowDepth - 1] : '';
      if (!rowSet.has(rowId)) continue;
      for (const [columnDepth, columnSet] of columnWanted) {
        const columnId = columnDepth ? columnIds[columnDepth - 1] : '';
        if (!columnSet.has(columnId)) continue;
        // Each measure reads the row once for all its crossings.
        if (!read) {
          for (let k = 0; k < rules.length; k++) values[k] = rules[k].value(row);
          read = true;
        }
        const id = `${rowId}\u0002${columnId}`;
        let cell = cells.get(id);
        if (!cell) cells.set(id, (cell = { count: 0, sums: rules.map((rule) => rule.start()) }));
        cell.count++;
        for (let k = 0; k < rules.length; k++) cell.sums[k].add(values[k], row);
      }
    }
  }
  const done = new Map<string, { count: number; values: readonly unknown[] }>();
  for (const [id, cell] of cells) done.set(id, { count: cell.count, values: cell.sums.map((sum) => sum.result()) });
  const find = (rowPath: readonly unknown[], columnPath: readonly unknown[]) => done.get(`${rowAxis.idOf(rowPath)}\u0002${columnAxis.idOf(columnPath)}`);
  return { values: (rowPath, columnPath) => find(rowPath, columnPath)?.values, count: (rowPath, columnPath) => find(rowPath, columnPath)?.count ?? 0 };
}

/** The crossings of groups a backend computed (see `PivotGroup`), found by the paths a request names them by. */
export function pivotCellsResult<T>(groups: readonly PivotGroup[], options: PivotCellsOptions<T>, ctx: EvaluateContext = {}): PivotCellsResult {
  const rowAxis = new PivotAxis<T>(options.rows, ctx);
  const columnAxis = new PivotAxis<T>(options.columns, ctx);
  const byId = new Map<string, PivotGroup>();
  for (const group of groups) byId.set(`${rowAxis.idOf(group.rows)}\u0002${columnAxis.idOf(group.columns)}`, group);
  const find = (rowPath: readonly unknown[], columnPath: readonly unknown[]) => byId.get(`${rowAxis.idOf(rowPath)}\u0002${columnAxis.idOf(columnPath)}`);
  return { values: (rowPath, columnPath) => find(rowPath, columnPath)?.values, count: (rowPath, columnPath) => find(rowPath, columnPath)?.count ?? 0 };
}

/**
 * The members of a backend's answer (`{ slices: [{ total, members: [{ key, count, values, childCount }] }] }`, a slice per
 * slice asked), read the way memory gives them. Throws a `TypeError` for what is no such answer.
 */
export function readPivotMembers<T>(body: unknown, options: PivotMembersOptions<T>, fields: Readonly<Record<string, FieldType>> = {}): PivotMembersResult {
  const slices = (body as { slices?: unknown } | null)?.slices;
  if (!Array.isArray(slices) || slices.length !== options.slices.length) throw new TypeError('a pivot members answer is { slices: [{ total, members }] }, one per slice asked');
  const depth = options.slices[0]?.parent.length ?? 0;
  const level = options.levels[depth];
  const measures = options.measures ?? [];
  return {
    slices: slices.map((given, i) => {
      const slice = given as { total?: unknown; members?: unknown } | null;
      if (!slice || !Array.isArray(slice.members)) throw new TypeError('a slice of the answer is { total, members }');
      const parent = options.slices[i].parent;
      const members = slice.members.map((given): PivotSliceMember => {
        const m = given as { key?: unknown; count?: unknown; values?: unknown; childCount?: unknown } | null;
        if (!m || typeof m !== 'object') throw new TypeError('a member of the answer is { key, count, values }');
        const key = readKey(m.key ?? null, level, fields);
        const values = Array.isArray(m.values) ? m.values : [];
        const out: PivotSliceMember = { key, path: [...parent, key], count: Number(m.count ?? 0), values: measures.map((measure, k) => readValue(values[k] ?? null, measure)) };
        if (m.childCount !== undefined && m.childCount !== null) out.childCount = Number(m.childCount);
        return out;
      });
      return { parent, total: Number(slice.total ?? members.length), members };
    }),
  };
}

/** The numbers of a backend's answer (`{ counts: [{ path, count }] }`), found by the paths the request names members by. */
export function readPivotCounts<T>(body: unknown, options: PivotCountsOptions<T>, fields: Readonly<Record<string, FieldType>> = {}, ctx: EvaluateContext = {}): PivotCountsResult {
  const counts = (body as { counts?: unknown } | null)?.counts;
  if (!Array.isArray(counts)) throw new TypeError('a pivot counts answer is { counts: [{ path, count }] }');
  const axis = new PivotAxis<T>(options.levels, ctx);
  const byId = new Map<string, number>();
  for (const given of counts) {
    const c = given as { path?: unknown; count?: unknown } | null;
    if (!c || !Array.isArray(c.path)) throw new TypeError('a count of the answer is { path, count }');
    byId.set(axis.idOf(c.path.map((key, k) => readKey(key, options.levels[k], fields))), Number(c.count ?? 0));
  }
  return { childCount: (path) => byId.get(axis.idOf(path)) ?? 0 };
}

/**
 * Members ordered by a value of theirs, as `PivotSummarySort` says: by it (the level's `dir` turning it around), those
 * without one last; members of the same value keep their order.
 */
export function bySummary<M>(members: readonly M[], valueOf: (member: M) => unknown, dir: PivotLevel['dir']): M[] {
  const sign = dir === 'desc' ? -1 : 1;
  const rank = (m: M) => {
    const v = valueOf(m);
    return typeof v === 'number' ? v : v instanceof Date ? v.getTime() : null;
  };
  return [...members].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return sign * (x - y);
  });
}

/** Members of one level in the order of their keys, as `loadPivot` orders them: by the level's `dir`, the empty one last. */
export function inLevelOrder<T, M extends { key: unknown }>(members: readonly M[], levels: readonly PivotLevel<T>[], ctx: EvaluateContext = {}): M[] {
  const axis = new PivotAxis<T>(levels, ctx);
  const level = levels.length - 1;
  return [...members].sort((a, b) => axis.compare(level, a.key, b.key));
}

/** The member of a path in a member tree, its keys matched the way the axis tells members apart. */
function memberAt<T>(root: PivotMember, path: readonly unknown[], axis: PivotAxis<T>): PivotMember | undefined {
  let node: PivotMember | undefined = root;
  for (let i = 0; i < path.length && node; i++) {
    const id = axis.idOf(path.slice(0, i + 1));
    node = node.children?.find((child) => axis.idOf(child.path) === id);
  }
  return node;
}

/** The members whose children a load computes so that these paths are shown: every member above each (and each itself, with `self`). */
function prefixes(paths: readonly (readonly unknown[])[], self = false): (readonly unknown[])[] {
  const out: (readonly unknown[])[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    for (let n = 1; n <= path.length - (self ? 0 : 1); n++) {
      const prefix = path.slice(0, n);
      const id = JSON.stringify(prefix);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(prefix);
    }
  }
  return out;
}

/** Paths by their depth, as ids; the total (`[]`) at depth 0. */
function byDepth<T>(paths: readonly (readonly unknown[])[], axis: PivotAxis<T>): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const path of paths) {
    let set = out.get(path.length);
    if (!set) out.set(path.length, (set = new Set()));
    set.add(axis.idOf(path));
  }
  return out;
}
