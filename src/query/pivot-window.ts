import type { EvaluateContext } from './evaluate-context';
import type { FieldType } from './field-type';
import { allEmpty, keeper, mayBeEmpty, measureRule, PivotAxis, pivotGroups, pivotResult, readKey, readValue } from './pivot';
import type { PivotBlocksOptions } from './pivot-blocks-options';
import type { PivotBlocksResult } from './pivot-blocks-result';
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
import { runningAsks, runningTotals } from './pivot-running';

/**
 * The members `loadPivotMembers` asks for, over rows in memory: every child of each slice's parent is grouped and
 * ordered as `queryPivot` orders them (or by `sortBySummary`), without those `nonEmpty` leaves out, then the slice's
 * part is taken.
 */
export function pivotMembers<T>(rows: readonly T[], options: PivotMembersOptions<T>, ctx: EvaluateContext = {}): PivotMembersResult {
  const depth = options.slices[0]?.parent.length ?? 0;
  const find = options.find ?? [];
  const below = levelsBelow(options.levels, depth, options.descendants ?? 0);
  const ordered = inOrder(rows, options, [...options.slices.map((slice) => slice.parent), ...find.map((path) => path.slice(0, depth))], below, ctx);
  const counts = options.childCounts && depth + 1 < options.levels.length ? counted(ordered.under, options.levels.slice(0, depth + 2), true, options, ctx) : null;
  const measures = options.measures ?? [];
  const out: PivotMembersResult = {
    slices: options.slices.map((slice) => {
      const children = ordered.childrenOf(slice.parent);
      const skip = Math.max(0, slice.skip ?? 0);
      const part = slice.take === undefined ? children.slice(skip) : children.slice(skip, skip + Math.max(0, slice.take));
      return {
        parent: slice.parent,
        total: children.length,
        members: part.map((m) => {
          const one: PivotSliceMember = { key: m.key, path: [...slice.parent, m.key], count: m.count, values: ordered.values(m) ?? measures.map(() => null) };
          if (options.childCounts) one.childCount = counts?.childCount(one.path) ?? 0;
          if (options.descendants) one.descendants = padded(ordered.descendants(m), options.descendants);
          return one;
        }),
      };
    }),
  };
  if (find.length) {
    out.found = find.map((path) => ordered.placeOf(path));
  }
  return out;
}

/**
 * The blocks `loadPivotBlocks` asks for, over rows in memory: each parent's children in the order `pivotMembers` gives
 * them, taken `size` at a time, each block with the number of its children and of the members below them on each level.
 */
export function pivotBlocks<T>(rows: readonly T[], options: PivotBlocksOptions<T>, ctx: EvaluateContext = {}): PivotBlocksResult {
  const depth = options.parents[0]?.length ?? 0;
  const below = levelsBelow(options.levels, depth, options.depth);
  // The measures are there for the order and for the members left out; without these they are not worked out.
  const measures = options.sortBySummary || options.nonEmpty ? options.measures : undefined;
  const ordered = inOrder(rows, { ...options, measures }, options.parents, below, ctx);
  return {
    blocks: options.parents.map((parent) => {
      const children = ordered.childrenOf(parent);
      const size = options.size ?? Math.max(1, children.length);
      const counts: number[][] = [];
      for (let from = 0; from < children.length; from += size) {
        const block = children.slice(from, from + size);
        const sums = new Array<number>(options.depth + 1).fill(0);
        sums[0] = block.length;
        for (const child of block) ordered.descendants(child).forEach((n, j) => (sums[j + 1] += n));
        counts.push(sums);
      }
      return { parent, total: children.length, counts };
    }),
  };
}

/** A member while members are counted: its children, by the comparable values of their keys; the last level's alone. */
interface Tally {
  children: Map<unknown, Tally>;
  last: Set<unknown> | null;
}

/**
 * The members of the rows `filter` passes and `keep` keeps, counted on every level and not grouped: how many stand below
 * a member of a path, on each of `below` levels, its children first.
 */
function tallied<T>(rows: readonly T[], levels: readonly PivotLevel<T>[], options: Pick<PivotMembersOptions<T>, 'filter' | 'keep'>, ctx: EvaluateContext): (path: readonly unknown[], below: number) => number[] {
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const axis = new PivotAxis<T>(levels, ctx);
  const last = levels.length - 1;
  const make = (): Tally => ({ children: new Map(), last: null });
  const root = make();
  for (const row of rows) {
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    let node = root;
    for (let i = 0; i < last; i++) {
      const c = axis.comparableOf(row, i);
      let next = node.children.get(c);
      if (!next) node.children.set(c, (next = make()));
      node = next;
    }
    (node.last ??= new Set()).add(axis.comparableOf(row, last));
  }
  return (path, below) => {
    const out = new Array<number>(below).fill(0);
    let node: Tally | undefined = root;
    for (let i = 0; i < path.length && node; i++) node = node.children.get(axis.keyComparable(i, path[i]));
    const add = (at: Tally, j: number) => {
      out[j] += at.last ? at.last.size : at.children.size;
      if (j + 1 < below) for (const child of at.children.values()) add(child, j + 1);
    };
    if (node && below) add(node, 0);
    return out;
  };
}

/** The levels below a level's members that a count can reach: as many as asked, as many as the axis has. */
function levelsBelow(levels: readonly unknown[], depth: number, asked: number): number {
  return Math.max(0, Math.min(asked, levels.length - depth - 1));
}

/** Numbers filled up with zeros to `length`: levels the axis does not have count no member. */
function padded(numbers: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, j) => numbers[j] ?? 0);
}

/**
 * The children of members of one level, ordered as `loadPivotMembers` orders them (the level's `dir`, or
 * `sortBySummary`), without those `nonEmpty` leaves out, and the members below each, `below` levels down.
 */
function inOrder<T>(
  rows: readonly T[],
  options: Pick<PivotMembersOptions<T>, 'filter' | 'keep' | 'levels' | 'measures' | 'sortBySummary' | 'nonEmpty'>,
  parents: readonly (readonly unknown[])[],
  below: number,
  ctx: EvaluateContext,
) {
  const depth = parents[0]?.length ?? 0;
  const levels = options.levels.slice(0, Math.min(depth + 1, options.levels.length));
  const upper = new PivotAxis<T>(options.levels.slice(0, depth), ctx);
  const tree = trieOf(parents, upper).root;
  const sort = options.sortBySummary;
  const path = sort?.path ?? [];
  const columns = (sort?.levels ?? []).slice(0, path.length);
  const slots: number[] = [];
  const under = depth ? rows.filter((row) => hits(row, upper, tree, slots) > 0) : rows;
  const nonEmpty = !!options.nonEmpty && mayBeEmpty(options.measures ?? []);
  // The members below are grouped only where their measures tell which are shown; else their number is enough.
  const deeper = options.levels.slice(0, Math.min(depth + 1 + below, options.levels.length));
  const tally = below && !nonEmpty ? tallied(under, deeper, options, ctx) : null;
  const grouped = tally ? levels : deeper;
  const query = { filter: options.filter, keep: options.keep, rows: grouped, columns, measures: options.measures, expandedRows: true as const, expandedColumns: prefixes([path]) };
  const result = pivotResult(pivotGroups(under, query, ctx), query, ctx);
  const axis = new PivotAxis<T>(levels, ctx);
  const total = result.columns;
  const at = memberAt(result.columns, path, new PivotAxis<T>(columns, ctx));
  const dir = options.levels[depth]?.dir;
  const shown = (m: PivotMember) => !nonEmpty || !allEmpty(result.values(m, total) ?? []);
  const known = new Map<string, readonly PivotMember[]>();
  const places = new Map<string, Map<string, number>>();
  // The members of the parents' level, by their ids: a request may ask for the children of thousands.
  const above = new Map<string, PivotMember>();
  const collect = (member: PivotMember) => {
    if (member.path.length === depth) above.set(upper.idOf(member.path), member);
    else member.children?.forEach(collect);
  };
  collect(result.rows);
  const childrenOf = (parent: readonly unknown[]): readonly PivotMember[] => {
    const id = upper.idOf(parent);
    let children = known.get(id);
    if (!children) {
      children = (above.get(id)?.children ?? []).filter(shown);
      if (sort) children = bySummary(children, (m) => (at ? result.values(m, at)?.[sort.measure] : undefined), dir);
      known.set(id, children);
    }
    return children;
  };
  return {
    under,
    values: (m: PivotMember) => result.values(m, total),
    childrenOf,
    /** The place of a member among its parent's children; -1 where it is not one of them. */
    placeOf(member: readonly unknown[]): number {
      const parent = member.slice(0, depth);
      const id = upper.idOf(parent);
      let place = places.get(id);
      if (!place) places.set(id, (place = new Map(childrenOf(parent).map((child, i) => [axis.idOf(child.path), i]))));
      return place.get(axis.idOf(member)) ?? -1;
    },
    /** The members shown below one, on each level down to `below`: its children first. */
    descendants(member: PivotMember): number[] {
      if (tally) return tally(member.path, below);
      const out = new Array<number>(below).fill(0);
      let line = member.children ?? [];
      for (let j = 0; j < below && line.length; j++) {
        line = line.filter(shown);
        out[j] = line.length;
        line = line.flatMap((m) => m.children ?? []);
      }
      return out;
    },
  };
}

/** The numbers `loadPivotCounts` asks for, over rows in memory. */
export function pivotCounts<T>(rows: readonly T[], options: PivotCountsOptions<T>, ctx: EvaluateContext = {}): PivotCountsResult {
  const deepest = options.paths.reduce((most, path) => Math.max(most, path.length), 0);
  const levels = options.levels.slice(0, Math.min(deepest + 1, options.levels.length));
  return counted(rows, levels, prefixes(options.paths, true), options, ctx);
}

/**
 * The number of children of members shown open, of the rows `filter` passes and `keep` keeps: counted, not grouped, as
 * only their number is asked for. With `nonEmpty` (and measures that can all be empty) the children are grouped for
 * their measures, and those whose measures are all empty are not counted.
 */
function counted<T>(
  rows: readonly T[],
  levels: readonly PivotLevel<T>[],
  expanded: true | readonly (readonly unknown[])[],
  options: Pick<PivotCountsOptions<T>, 'filter' | 'keep' | 'measures' | 'nonEmpty'>,
  ctx: EvaluateContext,
): PivotCountsResult {
  const measures = options.measures ?? [];
  if (!options.nonEmpty || !mayBeEmpty(measures)) {
    const axis = found(rows, levels, expanded, options, ctx);
    return { childCount: (path) => axis.childCount(path) };
  }
  const axis = new PivotAxis<T>(levels, ctx);
  const counts = new Map<string, number>();
  // Without columns, a group per member shown: counted under its parent.
  for (const group of pivotGroups(rows, { filter: options.filter, keep: options.keep, rows: levels, measures, expandedRows: expanded }, ctx)) {
    if (!group.rows.length || allEmpty(group.values)) continue;
    const id = axis.idOf(group.rows.slice(0, -1));
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { childCount: (path) => counts.get(axis.idOf(path)) ?? 0 };
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
  // By the number of the row path times the paths across, plus that of the column path: no text is made per row.
  const width = columnTrie.ids.length;
  const cells: ({ count: number; sums: SummaryAccumulator[] } | undefined)[] = new Array(rowTrie.ids.length * width);
  const rowHits: number[] = [];
  const columnHits: number[] = [];
  const values: unknown[] = new Array(rules.length);
  for (const row of rows) {
    // The members asked for that the row falls in, found down the tree of their paths: a row under none leaves early.
    const rowCount = hits(row, rowAxis, rowTrie.root, rowHits);
    if (!rowCount) continue;
    const columnCount = hits(row, columnAxis, columnTrie.root, columnHits);
    if (!columnCount) continue;
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    // Each measure reads the row once for all its crossings.
    for (let k = 0; k < rules.length; k++) values[k] = rules[k].value(row);
    for (let r = 0; r < rowCount; r++) {
      const line = rowHits[r] * width;
      for (let c = 0; c < columnCount; c++) {
        let cell = cells[line + columnHits[c]];
        if (!cell) cells[line + columnHits[c]] = cell = { count: 0, sums: rules.map((rule) => rule.start()) };
        cell.count++;
        for (let k = 0; k < rules.length; k++) cell.sums[k].add(values[k], row);
      }
    }
  }
  const done = new Map<string, { count: number; values: readonly unknown[] }>();
  cells.forEach((cell, at) => {
    if (cell) done.set(`${rowTrie.ids[Math.floor(at / width)]}\u0002${columnTrie.ids[at % width]}`, { count: cell.count, values: cell.sums.map((sum) => sum.result()) });
  });
  const find = (rowPath: readonly unknown[], columnPath: readonly unknown[]) => done.get(`${rowAxis.idOf(rowPath)}\u0002${columnAxis.idOf(columnPath)}`);
  const own: PivotCellsResult = { values: (rowPath, columnPath) => find(rowPath, columnPath)?.values, count: (rowPath, columnPath) => find(rowPath, columnPath)?.count ?? 0 };
  if (!options.running?.length) return own;
  // Each parent's children in their order, and their values where they cross the others.
  const read = runningAsks(options).map((ask) => {
    const members = pivotMembers(rows, ask.members, ctx);
    return { ask, members, cells: pivotCells(rows, ask.cells(members.slices[0]?.members.map((m) => m.path) ?? []), ctx) };
  });
  return { ...own, running: runningTotals(options, read, own, ctx) };
}

/**
 * The answer a backend gives to `loadPivotCells`, over rows in memory: the groups of the crossings asked for that some
 * row falls in, and with `running` those no row falls in too (`count` 0), each with its running totals (`running`).
 */
export function pivotCellGroups<T>(rows: readonly T[], options: PivotCellsOptions<T>, ctx: EvaluateContext = {}): PivotGroup[] {
  const r = pivotCells(rows, options, ctx);
  const out: PivotGroup[] = [];
  for (const rowPath of options.rowPaths) {
    for (const columnPath of options.columnPaths) {
      const count = r.count(rowPath, columnPath);
      const running = r.running?.(rowPath, columnPath);
      if (!count && !running) continue;
      const group: PivotGroup = { rows: rowPath, columns: columnPath, count, values: r.values(rowPath, columnPath) ?? options.measures.map(() => null) };
      if (running) group.running = running;
      out.push(group);
    }
  }
  return out;
}

/**
 * The crossings of groups a backend computed (see `PivotGroup`), found by the paths a request names them by; with
 * their running totals where the groups have them.
 */
export function pivotCellsResult<T>(groups: readonly PivotGroup[], options: PivotCellsOptions<T>, ctx: EvaluateContext = {}): PivotCellsResult {
  const rowAxis = new PivotAxis<T>(options.rows, ctx);
  const columnAxis = new PivotAxis<T>(options.columns, ctx);
  const byId = new Map<string, PivotGroup>();
  for (const group of groups) byId.set(`${rowAxis.idOf(group.rows)}\u0002${columnAxis.idOf(group.columns)}`, group);
  const find = (rowPath: readonly unknown[], columnPath: readonly unknown[]) => byId.get(`${rowAxis.idOf(rowPath)}\u0002${columnAxis.idOf(columnPath)}`);
  // A group no row falls in is there for its running totals only.
  const out: PivotCellsResult = { values: (rowPath, columnPath) => (find(rowPath, columnPath)?.count ? find(rowPath, columnPath)!.values : undefined), count: (rowPath, columnPath) => find(rowPath, columnPath)?.count ?? 0 };
  if (options.running?.length && groups.some((g) => Array.isArray(g.running))) {
    const none = options.running.map(() => null);
    out.running = (rowPath, columnPath) => find(rowPath, columnPath)?.running ?? none;
  }
  return out;
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
        const m = given as { key?: unknown; count?: unknown; values?: unknown; childCount?: unknown; descendants?: unknown } | null;
        if (!m || typeof m !== 'object') throw new TypeError('a member of the answer is { key, count, values }');
        const key = readKey(m.key ?? null, level, fields);
        const values = Array.isArray(m.values) ? m.values : [];
        const out: PivotSliceMember = { key, path: [...parent, key], count: Number(m.count ?? 0), values: measures.map((measure, k) => readValue(values[k] ?? null, measure)) };
        if (m.childCount !== undefined && m.childCount !== null) out.childCount = Number(m.childCount);
        if (options.descendants) {
          if (!Array.isArray(m.descendants)) throw new TypeError('a member of the answer has "descendants", a number per level asked for');
          out.descendants = padded(m.descendants.map((n) => Number(n ?? 0)), options.descendants);
        }
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
 * The blocks of a backend's answer (`{ blocks: [{ total, counts }] }`, one per parent asked, each block `depth + 1`
 * numbers). Throws a `TypeError` for what is no such answer.
 */
export function readPivotBlocks<T>(body: unknown, options: PivotBlocksOptions<T>): PivotBlocksResult {
  const blocks = (body as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks) || blocks.length !== options.parents.length) throw new TypeError('a pivot blocks answer is { blocks: [{ total, counts }] }, one per parent asked');
  return {
    blocks: blocks.map((given, i) => {
      const b = given as { total?: unknown; counts?: unknown } | null;
      if (!b || !Array.isArray(b.counts) || !b.counts.every(Array.isArray)) throw new TypeError('a parent of the answer is { total, counts: [[number, …], …] }');
      const counts = (b.counts as unknown[][]).map((block) => padded(block.map((n) => Number(n ?? 0)), options.depth + 1));
      return { parent: options.parents[i], total: Number(b.total ?? counts.reduce((sum, block) => sum + block[0], 0)), counts };
    }),
  };
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

/** The paths asked for as a tree of their keys' comparable values; a node a path ends on has the path's number (`slot`). */
interface Trie {
  slot: number;
  children: Map<unknown, Trie> | null;
}

/** The tree of the paths, and the id of each path by its number: a path asked for twice has one number. */
function trieOf<T>(paths: readonly (readonly unknown[])[], axis: PivotAxis<T>): { root: Trie; ids: string[] } {
  const root: Trie = { slot: -1, children: null };
  const ids: string[] = [];
  for (const path of paths) {
    let node = root;
    path.forEach((key, level) => {
      const c = axis.keyComparable(level, key);
      let next = (node.children ??= new Map()).get(c);
      if (!next) node.children.set(c, (next = { slot: -1, children: null }));
      node = next;
    });
    if (node.slot < 0) {
      node.slot = ids.length;
      ids.push(axis.idOf(path));
    }
  }
  return { root, ids };
}

/** The numbers of the paths asked for that a row falls in, written into `out`; returns how many. */
function hits<T>(row: T, axis: PivotAxis<T>, trie: Trie, out: number[]): number {
  let n = 0;
  let node: Trie | undefined = trie;
  for (let level = 0; node; level++) {
    if (node.slot >= 0) out[n++] = node.slot;
    if (!node.children) break;
    node = node.children.get(axis.comparableOf(row, level));
  }
  return n;
}
