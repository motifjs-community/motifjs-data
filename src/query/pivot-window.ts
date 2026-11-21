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
  const levels = options.levels.slice(0, Math.min(depth + 1, options.levels.length));
  const upper = new PivotAxis<T>(options.levels.slice(0, depth), ctx);
  const find = options.find ?? [];
  const parents = trieOf([...options.slices.map((slice) => slice.parent), ...find.map((path) => path.slice(0, depth))], upper);
  const sort = options.sortBySummary;
  const path = sort?.path ?? [];
  const columns = (sort?.levels ?? []).slice(0, path.length);
  const ids: string[] = [];
  const under = depth ? rows.filter((row) => hits(row, upper, parents, ids) > 0) : rows;
  const query = { filter: options.filter, keep: options.keep, rows: levels, columns, measures: options.measures, expandedRows: true as const, expandedColumns: prefixes([path]) };
  const result = pivotResult(pivotGroups(under, query, ctx), query, ctx);
  // The children of the members are counted, not grouped: only their number is asked for.
  const below = options.childCounts && depth + 1 < options.levels.length ? found(under, options.levels.slice(0, depth + 2), true, options, ctx) : null;
  const axis = new PivotAxis<T>(levels, ctx);
  const total = result.columns;
  const at = memberAt(result.columns, path, new PivotAxis<T>(columns, ctx));
  const dir = options.levels[depth]?.dir;
  const measures = options.measures ?? [];
  const known = new Map<string, readonly PivotMember[]>();
  const childrenOf = (path: readonly unknown[]) => {
    const id = upper.idOf(path);
    let children = known.get(id);
    if (!children) {
      children = memberAt(result.rows, path, axis)?.children ?? [];
      if (sort) children = bySummary(children, (m) => (at ? result.values(m, at)?.[sort.measure] : undefined), dir);
      known.set(id, children);
    }
    return children;
  };
  const out: PivotMembersResult = {
    slices: options.slices.map((slice) => {
      const children = childrenOf(slice.parent);
      const skip = Math.max(0, slice.skip ?? 0);
      const part = slice.take === undefined ? children.slice(skip) : children.slice(skip, skip + Math.max(0, slice.take));
      return {
        parent: slice.parent,
        total: children.length,
        members: part.map((m) => {
          const one: PivotSliceMember = { key: m.key, path: [...slice.parent, m.key], count: m.count, values: result.values(m, total) ?? measures.map(() => null) };
          if (options.childCounts) one.childCount = below?.childCount(one.path) ?? 0;
          return one;
        }),
      };
    }),
  };
  if (find.length) {
    out.found = find.map((path) => {
      const id = axis.idOf(path);
      return childrenOf(path.slice(0, depth)).findIndex((child) => axis.idOf(child.path) === id);
    });
  }
  return out;
}

/** The numbers `loadPivotCounts` asks for, over rows in memory. */
export function pivotCounts<T>(rows: readonly T[], options: PivotCountsOptions<T>, ctx: EvaluateContext = {}): PivotCountsResult {
  const deepest = options.paths.reduce((most, path) => Math.max(most, path.length), 0);
  const levels = options.levels.slice(0, Math.min(deepest + 1, options.levels.length));
  const axis = found(rows, levels, prefixes(options.paths, true), options, ctx);
  return { childCount: (path) => axis.childCount(path) };
}

/** An axis that found the members of the rows `filter` passes and `keep` keeps: its members shown open know their children. */
function found<T>(rows: readonly T[], levels: readonly PivotLevel<T>[], expanded: true | readonly (readonly unknown[])[], options: Pick<PivotCountsOptions<T>, 'filter' | 'keep'>, ctx: EvaluateContext): PivotAxis<T> {
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const axis = new PivotAxis<T>(levels, ctx, expanded);
  for (const row of rows) {
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    axis.add(row);
  }
  return axis;
}

/** The crossings `loadPivotCells` asks for, over rows in memory: one pass, each row counted in the crossings asked for that it falls in. */
export function pivotCells<T>(rows: readonly T[], options: PivotCellsOptions<T>, ctx: EvaluateContext = {}): PivotCellsResult {
  const rowAxis = new PivotAxis<T>(options.rows, ctx);
  const columnAxis = new PivotAxis<T>(options.columns, ctx);
  const rowTrie = trieOf(options.rowPaths, rowAxis);
  const columnTrie = trieOf(options.columnPaths, columnAxis);
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const rules = options.measures.map((measure) => measureRule(measure, ctx));
  const cells = new Map<string, { count: number; sums: SummaryAccumulator[] }>();
  const rowHits: string[] = [];
  const columnHits: string[] = [];
  const values: unknown[] = new Array(rules.length);
  for (const row of rows) {
    // The members asked for that the row falls in, found down the tree of their paths: a row under none leaves early.
    const rowCount = hits(row, rowAxis, rowTrie, rowHits);
    if (!rowCount) continue;
    const columnCount = hits(row, columnAxis, columnTrie, columnHits);
    if (!columnCount) continue;
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    // Each measure reads the row once for all its crossings.
    for (let k = 0; k < rules.length; k++) values[k] = rules[k].value(row);
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < columnCount; c++) {
        const id = `${rowHits[r]}\u0002${columnHits[c]}`;
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
    ...foundOf(body, options),
  };
}

/** The places of the members `find` named, as an answer gives them (`found`, one per member). */
function foundOf<T>(body: unknown, options: PivotMembersOptions<T>): { found?: number[] } {
  if (!options.find?.length) return {};
  const found = (body as { found?: unknown } | null)?.found;
  if (!Array.isArray(found) || found.length !== options.find.length) throw new TypeError('a pivot members answer has "found", a place per member asked for');
  return { found: found.map((at) => Number(at ?? -1)) };
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

/** The paths asked for as a tree of their keys' comparable values; a node a path ends on has the path's id. */
interface Trie {
  id: string | null;
  children: Map<unknown, Trie> | null;
}

function trieOf<T>(paths: readonly (readonly unknown[])[], axis: PivotAxis<T>): Trie {
  const root: Trie = { id: null, children: null };
  for (const path of paths) {
    let node = root;
    path.forEach((key, level) => {
      const c = axis.keyComparable(level, key);
      let next = (node.children ??= new Map()).get(c);
      if (!next) node.children.set(c, (next = { id: null, children: null }));
      node = next;
    });
    node.id = axis.idOf(path);
  }
  return root;
}

/** The ids of the paths asked for that a row falls in, written into `out`; returns their number. */
function hits<T>(row: T, axis: PivotAxis<T>, trie: Trie, out: string[]): number {
  let n = 0;
  let node: Trie | undefined = trie;
  for (let level = 0; node; level++) {
    if (node.id !== null) out[n++] = node.id;
    if (!node.children) break;
    node = node.children.get(axis.comparableOf(row, level));
  }
  return n;
}
