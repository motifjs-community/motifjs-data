import type { EvaluateContext } from './evaluate-context';
import type { FieldType } from './field-type';
import { allEmpty, keeper, mayBeEmpty, measureRule, PivotAxis, pivotGroups, readKey, readValue } from './pivot';
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
 * The members `loadPivotMembers` asks for, over rows in memory: every child of each slice's parent is found and ordered
 * as `queryPivot` orders them (or by `sortBySummary`), without those `nonEmpty` leaves out, then the slice's part is
 * taken.
 */
export function pivotMembers<T>(rows: readonly T[], options: PivotMembersOptions<T>, ctx: EvaluateContext = {}): PivotMembersResult {
  const depth = options.slices[0]?.parent.length ?? 0;
  const find = options.find ?? [];
  // The number of a member's children is what stands on the first level below it.
  const below = levelsBelow(options.levels, depth, Math.max(options.descendants ?? 0, options.childCounts ? 1 : 0));
  const ordered = inOrder(rows, options, [...options.slices.map((slice) => slice.parent), ...find.map((path) => path.slice(0, depth))], below, ctx);
  const out: PivotMembersResult = {
    slices: options.slices.map((slice) => {
      const children = ordered.childrenOf(slice.parent);
      const skip = Math.max(0, slice.skip ?? 0);
      const part = slice.take === undefined ? children.slice(skip) : children.slice(skip, skip + Math.max(0, slice.take));
      return {
        parent: slice.parent,
        total: children.length,
        members: part.map((m) => {
          const one: PivotSliceMember = { key: m.key, path: [...slice.parent, m.key], count: m.count, values: ordered.values(m) };
          const numbers = below ? ordered.descendants(m) : [];
          if (options.childCounts) one.childCount = numbers[0] ?? 0;
          if (options.descendants) one.descendants = padded(numbers, options.descendants);
          return one;
        }),
      };
    }),
  };
  if (find.length) out.found = find.map((path) => ordered.placeOf(path));
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
        const sums = new Array<number>(options.depth + 1).fill(0);
        for (let i = from; i < Math.min(children.length, from + size); i++) {
          sums[0]++;
          if (below) ordered.descendants(children[i]).forEach((n, j) => (sums[j + 1] += n));
        }
        counts.push(sums);
      }
      return { parent, total: children.length, counts };
    }),
  };
}

/** The members under one while rows are read: by the comparable values of their keys, and by the values rows had. */
class Under<M> {
  readonly byKey = new Map<unknown, M>();
  private byValue: Map<unknown, M> | null = null;

  /** The member a row falls in on a level, made where no row fell in it before. */
  of<T>(axis: PivotAxis<T>, row: T, level: number, make: (level: number, value: unknown) => M): M {
    const value = axis.rowValue(row, level);
    let one = this.byValue?.get(value);
    if (one !== undefined) return one;
    const c = axis.valueComparable(level, value);
    one = this.byKey.get(c);
    if (one === undefined) this.byKey.set(c, (one = make(level, value)));
    if (axis.keepsValue(level, value)) (this.byValue ??= new Map()).set(value, one);
    return one;
  }
}

/** The members below one while they are counted; the last level's are there or not (`null`). */
class Tally extends Under<Tally | null> {}

/** A member while the children of members are found: its rows added up, and the members below it. */
interface Child {
  readonly key: unknown;
  count: number;
  readonly sums: readonly SummaryAccumulator[];
  /** Its rows in the member of the other axis the order reads, added up. */
  at: SummaryAccumulator | null;
  values: readonly unknown[] | null;
  /** The members below it, added up as well: their measures tell which are shown. */
  readonly below: Under<Child> | null;
  /** The members below it, counted alone. */
  readonly tally: Tally | null;
}

/** The levels below a level's members that a count can reach: as many as asked, as many as the axis has. */
function levelsBelow(levels: readonly unknown[], depth: number, asked: number): number {
  return Math.max(0, Math.min(asked, levels.length - depth - 1));
}

/** Numbers filled up with zeros to `length`: levels the axis does not have count no member. */
function padded(numbers: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, j) => numbers[j] ?? 0);
}

const NO_SUMS: readonly SummaryAccumulator[] = [];

/**
 * The children of members of one level, ordered as `loadPivotMembers` orders them (the level's `dir`, or
 * `sortBySummary`), without those `nonEmpty` leaves out, and the members below each, `below` levels down: in one pass
 * over the rows, each read once, for nothing but the children asked for.
 */
function inOrder<T>(
  rows: readonly T[],
  options: Pick<PivotMembersOptions<T>, 'filter' | 'keep' | 'levels' | 'measures' | 'sortBySummary' | 'nonEmpty'>,
  parents: readonly (readonly unknown[])[],
  below: number,
  ctx: EvaluateContext,
) {
  const depth = parents[0]?.length ?? 0;
  const known = depth < options.levels.length;
  const axis = new PivotAxis<T>(options.levels.slice(0, depth + 1 + below), ctx);
  const { root, ids } = trieOf(parents, axis);
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const measures = options.measures ?? [];
  const rules = measures.map((measure) => measureRule(measure, ctx));
  const nonEmpty = !!options.nonEmpty && mayBeEmpty(measures);
  // The member of the other axis the order reads.
  const sort = options.sortBySummary;
  const path = sort?.path ?? [];
  const columns = (sort?.levels ?? []).slice(0, path.length);
  const across = path.length ? new PivotAxis<T>(columns, ctx) : null;
  const column = columns.map((_, i) => across!.keyComparable(i, path[i]));
  // No row is in a member deeper than the levels given.
  const within = (row: T) => columns.length === path.length && column.every((c, i) => across!.comparableOf(row, i) === c);
  // The members below are added up only where their measures tell which are shown; else their number is enough.
  const summed = nonEmpty ? depth + below : depth;
  const deepest = depth + below;
  const child = (level: number, value: unknown): Child => ({
    key: axis.valueKey(level, value),
    count: 0,
    sums: rules.length ? rules.map((rule) => rule.start()) : NO_SUMS,
    at: null,
    values: null,
    below: level < summed ? new Under<Child>() : null,
    tally: level === summed && deepest > summed ? new Tally() : null,
  });
  const counted = (level: number): Tally | null => (level < deepest ? new Tally() : null);
  const groups = ids.map(() => new Under<Child>());
  const slots: number[] = [];
  const values: unknown[] = new Array(rules.length);
  if (known) {
    for (const row of rows) {
      if (hits(row, axis, root, slots) === 0) continue;
      if (pass && !pass(row)) continue;
      if (keepers.length && !keepers.every((kept) => kept(row))) continue;
      // Each measure reads the row once for all the members it is added to.
      for (let k = 0; k < rules.length; k++) values[k] = rules[k].value(row);
      let under: Under<Child> | null = groups[slots[0]];
      let tally: Tally | null = null;
      for (let level = depth; under; level++) {
        const one: Child = under.of(axis, row, level, child);
        one.count++;
        for (let k = 0; k < rules.length; k++) one.sums[k].add(values[k], row);
        if (across && level === depth && rules[sort!.measure] && within(row)) (one.at ??= rules[sort!.measure].start()).add(values[sort!.measure], row);
        under = one.below;
        tally = one.tally;
      }
      for (let level = summed + 1; tally; level++) tally = tally.of(axis, row, level, counted);
    }
  }
  const valuesOf = (child: Child) => (child.values ??= child.sums.map((sum) => sum.result()));
  const shown = (child: Child) => !nonEmpty || !allEmpty(valuesOf(child));
  const slotOf = (parent: readonly unknown[]) => {
    let node: Trie | undefined = root;
    for (let i = 0; i < depth && node; i++) node = node.children?.get(axis.keyComparable(i, parent[i]));
    return node?.slot ?? -1;
  };
  const lists = new Map<number, readonly Child[]>();
  const childrenAt = (slot: number): readonly Child[] => {
    let children = lists.get(slot);
    if (!children) {
      children = slot < 0 ? [] : axis.sorted(depth, [...groups[slot].byKey.values()].filter(shown));
      // At the total its measures are there already; in a member of the other axis only the rows in it count.
      if (sort) children = bySummary(children, (child) => (across ? child.at?.result() : valuesOf(child)[sort.measure]), options.levels[depth]?.dir);
      lists.set(slot, children);
    }
    return children;
  };
  const places = new Map<number, Map<Child, number>>();
  return {
    values: valuesOf,
    childrenOf: (parent: readonly unknown[]) => childrenAt(slotOf(parent)),
    /** The place of a member among its parent's children; -1 where it is not one of them. */
    placeOf(member: readonly unknown[]): number {
      const slot = slotOf(member);
      const found = slot < 0 || !known ? undefined : groups[slot].byKey.get(axis.keyComparable(depth, member[depth]));
      if (!found) return -1;
      let place = places.get(slot);
      if (!place) places.set(slot, (place = new Map(childrenAt(slot).map((one, i) => [one, i]))));
      return place.get(found) ?? -1;
    },
    /** The members shown below one, on each level down to `below`: its children first. */
    descendants(member: Child): number[] {
      const out = new Array<number>(below).fill(0);
      if (member.tally) addTally(member.tally, 0, out);
      else if (member.below) {
        let line: readonly Child[] = [member];
        for (let j = 0; j < below; j++) {
          line = line.flatMap((one) => (one.below ? [...one.below.byKey.values()].filter(shown) : []));
          out[j] = line.length;
        }
      }
      return out;
    },
  };
}

/** The members counted below one, on each level, added to `out`. */
function addTally(tally: Tally, at: number, out: number[]) {
  out[at] += tally.byKey.size;
  if (at + 1 < out.length) for (const one of tally.byKey.values()) if (one) addTally(one, at + 1, out);
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
  const ranked = members.map((member) => ({ member, rank: rank(member) }));
  ranked.sort(({ rank: x }, { rank: y }) => {
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return sign * (x - y);
  });
  return ranked.map((r) => r.member);
}

/** Members of one level in the order of their keys, as `loadPivot` orders them: by the level's `dir`, the empty one last. */
export function inLevelOrder<T, M extends { key: unknown }>(members: readonly M[], levels: readonly PivotLevel<T>[], ctx: EvaluateContext = {}): M[] {
  const axis = new PivotAxis<T>(levels, ctx);
  const level = levels.length - 1;
  return [...members].sort((a, b) => axis.compare(level, a.key, b.key));
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
