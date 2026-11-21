import type { EvaluateContext } from './evaluate-context';
import type { FieldType } from './field-type';
import type { PivotGroup } from './pivot-group';
import type { PivotInterval } from './pivot-interval';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';
import type { PivotLoadOptions } from './pivot-load-options';
import type { PivotLoadResult } from './pivot-load-result';
import type { PivotMeasure } from './pivot-measure';
import type { PivotMember } from './pivot-member';
import { createRowFilter } from './row-filter';
import { type SummaryAccumulator, SummaryRule } from './summaries';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty, toDate } from './values';

type Comparable = string | number | boolean | null;

/** The depths of an axis a backend computes: 0 is the total of the axis, 1 its top members. */
export interface PivotDepth {
  depth: number;
  /** From depth 2: the members whose children the depth holds, by path; `null` for all of them. */
  parents: readonly (readonly unknown[])[] | null;
}

const DATE_PARTS: readonly unknown[] = ['year', 'quarter', 'month', 'day', 'dayOfWeek', 'date'];

/** The values a level of an axis keeps worked out; past them (a level of values all different) each is worked out per row. */
const KNOWN_VALUES = 262_144;

/** Whether a value is a `PivotInterval` (or `undefined`, no interval). */
export function isPivotInterval(value: unknown): value is PivotInterval | undefined {
  return value === undefined || DATE_PARTS.includes(value) || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/**
 * The groups of a pivot over rows in memory (see `PivotGroup`): the rows `filter` passes and `keep` keeps, each counted
 * in every crossing of the members it is shown in, totals included. Values group the way grouping groups them: text
 * without case in the locale, declared dates by day; a member's key is its value in the first row that has it.
 */
export function pivotGroups<T>(rows: readonly T[], options: PivotLoadOptions<T>, ctx: EvaluateContext = {}): PivotGroup[] {
  const pass = options.filter ? createRowFilter<T>(options.filter, ctx) : null;
  const keepers = (options.keep ?? []).map((keep) => keeper(keep, ctx));
  const rowAxis = new PivotAxis<T>(options.rows ?? [], ctx, options.expandedRows);
  const columnAxis = new PivotAxis<T>(options.columns ?? [], ctx, options.expandedColumns);
  const rules = (options.measures ?? []).map((measure) => measureRule(measure, ctx));
  // By the number of the row member, then of the column member.
  const cells: Map<number, { rows: readonly unknown[]; columns: readonly unknown[]; count: number; sums: SummaryAccumulator[] }>[] = [];
  const across: MemberNode[] = [];
  const down: MemberNode[] = [];
  const values: unknown[] = new Array(rules.length);
  for (const row of rows) {
    if (pass && !pass(row)) continue;
    if (keepers.length && !keepers.every((kept) => kept(row))) continue;
    const acrossCount = rowAxis.shown(row, across);
    const downCount = columnAxis.shown(row, down);
    // Each measure reads the row once for all its crossings.
    for (let k = 0; k < rules.length; k++) values[k] = rules[k].value(row);
    for (let i = 0; i < acrossCount; i++) {
      const line = (cells[across[i].index] ??= new Map());
      for (let j = 0; j < downCount; j++) {
        let cell = line.get(down[j].index);
        if (!cell) line.set(down[j].index, (cell = { rows: across[i].path, columns: down[j].path, count: 0, sums: rules.map((rule) => rule.start()) }));
        cell.count++;
        for (let k = 0; k < rules.length; k++) cell.sums[k].add(values[k], row);
      }
    }
  }
  const groups: PivotGroup[] = [];
  for (const line of cells) {
    if (line) for (const cell of line.values()) groups.push({ rows: cell.rows, columns: cell.columns, count: cell.count, values: cell.sums.map((sum) => sum.result()) });
  }
  return groups;
}

/**
 * The members and values of a pivot from its groups, computed in memory or by a backend. The members of an axis come
 * from the groups that total the other axis, ordered by their level's `dir`; each group gives the values of its
 * crossing. A key is told from another by its value as it is (a `Date` by its time), so groups name a member with
 * the same key everywhere; a group under a member that is not there is left out.
 */
export function pivotResult<T>(groups: readonly PivotGroup[], options: PivotLoadOptions<T>, ctx: EvaluateContext = {}): PivotLoadResult {
  const rowAxis = new PivotAxis<T>(options.rows ?? [], ctx);
  const columnAxis = new PivotAxis<T>(options.columns ?? [], ctx);
  const rows = rowAxis.members(groups.filter((g) => !g.columns.length).map((g) => [g.rows, g.count]));
  const columns = columnAxis.members(groups.filter((g) => !g.rows.length).map((g) => [g.columns, g.count]));
  const cells = new Map<PivotMember, Map<PivotMember, readonly unknown[]>>();
  for (const g of groups) {
    const row = rows.get(pathId(g.rows));
    const column = columns.get(pathId(g.columns));
    if (!row || !column) continue;
    let line = cells.get(row);
    if (!line) cells.set(row, (line = new Map()));
    line.set(column, g.values);
  }
  return { rows: rows.get('')!, columns: columns.get('')!, values: (row, column) => cells.get(row)?.get(column) };
}

/** A pivot over rows in memory: `pivotResult` of `pivotGroups`. */
export function queryPivot<T>(rows: readonly T[], options: PivotLoadOptions<T>, ctx: EvaluateContext = {}): PivotLoadResult {
  return pivotResult(pivotGroups(rows, options, ctx), options, ctx);
}

/**
 * The depths of an axis a backend computes, down to the deepest one a shown member is expanded for (`PivotGroup`
 * tells which groups each depth holds). `expanded` lists members by their paths; a path counts when every member on
 * it is listed too. `undefined` or `true`: every depth, for every member.
 */
export function pivotDepths(levels: readonly PivotLevel<any>[], expanded: true | readonly (readonly unknown[])[] | undefined): PivotDepth[] {
  const depths: PivotDepth[] = [{ depth: 0, parents: null }];
  if (levels.length) depths.push({ depth: 1, parents: null });
  if (expanded === undefined || expanded === true) {
    for (let depth = 2; depth <= levels.length; depth++) depths.push({ depth, parents: null });
    return depths;
  }
  const open = new Set(expanded.map(pathId));
  for (let depth = 2; depth <= levels.length; depth++) {
    const seen = new Set<string>();
    const parents = expanded.filter((path) => {
      const id = pathId(path);
      if (path.length !== depth - 1 || seen.has(id) || !path.every((_, k) => open.has(pathId(path.slice(0, k + 1))))) return false;
      seen.add(id);
      return true;
    });
    if (!parents.length) break;
    depths.push({ depth, parents });
  }
  return depths;
}

/**
 * A group as a backend sent it, read the way memory gives it: keys of date parts and ranges as numbers, of `'date'` and
 * of declared dates as `Date`s, of declared numbers as numbers; `count`, `countDistinct` and `sum` as numbers, `avg`
 * as a number or `null`; running totals as numbers or `null`. Throws a `TypeError` for what is no group.
 */
export function readPivotGroup(group: unknown, options: PivotLoadOptions<any>, fields: Readonly<Record<string, FieldType>> = {}): PivotGroup {
  const g = group as Partial<PivotGroup> | null;
  if (!g || typeof g !== 'object' || !Array.isArray(g.rows) || !Array.isArray(g.columns)) throw new TypeError('a pivot group is { rows, columns, count, values }');
  const keys = (levels: readonly PivotLevel<any>[]) => (key: unknown, i: number) => readKey(key, levels[i], fields);
  const values = Array.isArray(g.values) ? g.values : [];
  const out: PivotGroup = {
    rows: g.rows.map(keys(options.rows ?? [])),
    columns: g.columns.map(keys(options.columns ?? [])),
    count: Number(g.count ?? 0),
    values: (options.measures ?? []).map((measure, i) => readValue(values[i] ?? null, measure)),
  };
  if (Array.isArray(g.running)) out.running = g.running.map((v) => (v === null || v === undefined ? null : Number(v)));
  return out;
}

/** The value of a level's interval; `null` for an empty value or one the interval cannot read. */
export function intervalValue(value: unknown, interval: PivotInterval | undefined): unknown {
  if (isEmpty(value)) return null;
  if (interval === undefined) return value;
  if (typeof interval === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? rangeStart(n, interval) : null;
  }
  const d = toDate(value);
  if (!d) return null;
  switch (interval) {
    case 'year':
      return d.getFullYear();
    case 'quarter':
      return Math.floor(d.getMonth() / 3) + 1;
    case 'month':
      return d.getMonth() + 1;
    case 'day':
      return d.getDate();
    case 'dayOfWeek':
      return d.getDay();
    default:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

/** Whether a row is kept by `keep`: its member on one of the levels the intervals make is one of the paths, or `filter` passes it. */
export function keeper<T>(keep: PivotKeep<T>, ctx: EvaluateContext): (row: T) => boolean {
  const intervals: readonly (PivotInterval | undefined)[] = keep.intervals?.length ? keep.intervals : [undefined];
  const axis = new PivotAxis<T>(intervals.map((interval) => ({ field: keep.field, interval, value: keep.value })), ctx);
  const ids = new Set(keep.paths.filter((path) => path.length && path.length <= intervals.length).map((path) => axis.idOf(path)));
  const passes = keep.filter ? createRowFilter<T>(keep.filter, ctx) : null;
  const include = keep.type !== 'exclude';
  return (row) => (axis.holds(row, ids) || (passes !== null && passes(row))) === include;
}

/** Memory: a member of an axis while rows are grouped. */
interface MemberNode {
  /** The member's number in its axis; the root is 0. */
  index: number;
  /** Its keys from the top, each the value of the first row that had it. */
  path: readonly unknown[];
  /** Its children by the comparable value of their keys. */
  children: Map<Comparable, MemberNode> | null;
  /** Its children by the values of rows that fell in them, each no object: a value seen before finds its child at once. */
  byValue: Map<unknown, MemberNode> | null;
  /** Its children are shown. */
  open: boolean;
  /** Its keys by their comparable values, to find it among the expanded members. */
  id: string;
}

/** One axis of a pivot: how a row's members are read and told apart, and how members are ordered. */
export class PivotAxis<T> {
  private readonly readers: ((row: T) => unknown)[];
  private readonly own: boolean[];
  private readonly comparers: (ValueComparer | undefined)[] = [];
  /** The comparable value of each key that is no object, by level: text is lowered once per value, not once per row. */
  private readonly comparables: Map<unknown, Comparable>[];
  /** The key of each value that is no object, by level with an interval: a date's year is read once per value, not once per row. */
  private readonly intervals: Map<unknown, unknown>[];
  /** The members shown below the top: the ids of the expanded ones, or `true` for all. */
  private readonly expanded: Set<string> | true;
  /** Memory: the root of the members found so far. */
  private readonly root: MemberNode = { index: 0, path: [], children: null, byValue: null, open: true, id: '' };
  private readonly found: MemberNode[] = [];
  private nodes = 1;
  /** The values kept in the members' `byValue`, all of them. */
  private byValues = 0;

  constructor(
    private readonly levels: readonly PivotLevel<T>[],
    private readonly ctx: EvaluateContext,
    expanded?: true | readonly (readonly unknown[])[],
  ) {
    this.own = levels.map((level) => !!(level.value ?? ctx.groupValue?.(level.field)));
    this.readers = levels.map((level) => level.value ?? (ctx.groupValue?.(level.field) as ((row: T) => unknown) | undefined) ?? ((row: T) => getField(row, level.field)));
    this.comparables = levels.map(() => new Map());
    this.intervals = levels.map(() => new Map());
    this.expanded = expanded === undefined || expanded === true ? true : new Set(expanded.map((path) => this.idOf(path)));
  }

  /** A path as an id: the comparable values of its keys, so a key matches the members it is told apart from. */
  idOf(path: readonly unknown[]): string {
    return path.reduce<string>((id, key, i) => (i < this.levels.length ? `${id}\u0001${partOf(this.comparable(i, key))}` : id), '');
  }

  /** Whether a row's member on some level (its path down to it) is one of `ids`. */
  holds(row: T, ids: ReadonlySet<string>): boolean {
    let id = '';
    for (let i = 0; i < this.levels.length; i++) {
      id += `\u0001${partOf(this.knownComparable(i, this.keyOf(i, this.readers[i](row))))}`;
      if (ids.has(id)) return true;
    }
    return false;
  }

  /** The comparable value of a row's member on a level: what tells it apart from the others. */
  comparableOf(row: T, level: number): Comparable {
    return this.knownComparable(level, this.keyOf(level, this.readers[level](row)));
  }

  /** The comparable value of a key on a level. */
  keyComparable(level: number, key: unknown): Comparable {
    return this.comparable(level, key);
  }

  /** A row's members as ids, on every level from the top: the ids of the paths down to level 1, 2 … written into `out`. */
  ids(row: T, out: string[]): void {
    let id = '';
    for (let i = 0; i < this.levels.length; i++) {
      id += `\u0001${partOf(this.knownComparable(i, this.keyOf(i, this.readers[i](row))))}`;
      out[i] = id;
    }
  }

  /** Memory: the members a row is shown in, the root first, written into `out`; returns their number. */
  shown(row: T, out: MemberNode[]): number {
    let node = this.root;
    out[0] = node;
    let n = 1;
    for (let i = 0; i < this.levels.length && node.open; i++) {
      const value = this.readers[i](row);
      const plain = value !== null && typeof value !== 'object';
      let child = plain ? node.byValue?.get(value) : undefined;
      if (!child) {
        const key = this.keyOf(i, value);
        const c = this.knownComparable(i, key);
        child = (node.children ??= new Map()).get(c);
        if (!child) {
          const id = `${node.id}\u0001${partOf(c)}`;
          const open = i + 1 < this.levels.length && (this.expanded === true || this.expanded.has(id));
          child = { index: this.nodes++, path: [...node.path, key], children: null, byValue: null, open, id };
          node.children.set(c, child);
        }
        if (plain && this.byValues < KNOWN_VALUES) {
          (node.byValue ??= new Map()).set(value, child);
          this.byValues++;
        }
      }
      out[n++] = child;
      node = child;
    }
    return n;
  }

  /** Memory: takes the members a row is shown in into those found so far (see `childCount`). */
  add(row: T) {
    this.shown(row, this.found);
  }

  /** Memory: the number of children found for a member shown open, by its path; 0 for one not found. */
  childCount(path: readonly unknown[]): number {
    if (path.length >= this.levels.length) return 0;
    let node: MemberNode | undefined = this.root;
    for (let i = 0; i < path.length && node; i++) node = node.children?.get(this.knownComparable(i, path[i]));
    return node?.children?.size ?? 0;
  }

  /** The members of the given paths and counts, by `pathId`; the root (`''`) always. */
  members(entries: (readonly [readonly unknown[], number])[]): Map<string, PivotMember> {
    const root: PivotMember = { key: undefined, path: [], count: 0, children: [] };
    const byId = new Map<string, PivotMember>([['', root]]);
    const sorted = entries.filter(([path]) => path.length <= this.levels.length).sort((a, b) => a[0].length - b[0].length);
    for (const [path, count] of sorted) {
      if (!path.length) {
        root.count = count;
        continue;
      }
      const id = pathId(path);
      const parent = byId.get(pathId(path.slice(0, -1)));
      if (!parent || byId.has(id)) continue;
      const member: PivotMember = { key: path[path.length - 1], path, count };
      (parent.children ??= []).push(member);
      byId.set(id, member);
    }
    // An axis without levels has a root without children.
    for (const member of byId.values()) if (member.children?.length) member.children.sort(this.order(member.path.length));
    return byId;
  }

  private knownComparable(level: number, key: unknown): Comparable {
    if (key === null || typeof key === 'object') return this.comparable(level, key);
    const known = this.comparables[level];
    let c = known.get(key);
    if (c === undefined) {
      c = this.comparable(level, key);
      if (known.size < KNOWN_VALUES) known.set(key, c);
    }
    return c;
  }

  /** The key of a row's value on a level: the value, or that of the level's interval. */
  private keyOf(level: number, value: unknown): unknown {
    const interval = this.levels[level].interval;
    if (interval === undefined || value === null || typeof value === 'object') return intervalValue(value, interval);
    const known = this.intervals[level];
    let key = known.get(value);
    if (key === undefined) {
      key = intervalValue(value, interval);
      if (known.size < KNOWN_VALUES) known.set(value, key);
    }
    return key;
  }

  /** The order of two keys of a level, as members are ordered: by the level's `dir`, the empty one last either way. */
  compare(level: number, a: unknown, b: unknown): number {
    return this.order(level)({ key: a, path: [], count: 0 }, { key: b, path: [], count: 0 });
  }

  private order(level: number): (a: PivotMember, b: PivotMember) => number {
    const { dir, field, interval } = this.levels[level];
    const sign = dir === 'desc' ? -1 : 1;
    const own = interval === undefined ? this.ctx.groupCompare?.(field) : undefined;
    return (a, b) => {
      const ka = this.knownComparable(level, a.key);
      const kb = this.knownComparable(level, b.key);
      if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
      return sign * (own ? own(a.key, b.key) : this.comparerOf(level, a.key).compare(ka, kb));
    };
  }

  private comparable(level: number, key: unknown): Comparable {
    return isEmpty(key) ? null : this.comparerOf(level, key).toComparable(key);
  }

  // The type of a level's values: its interval's, the declared one of its field, or the one of its first value.
  private comparerOf(level: number, key: unknown): ValueComparer {
    let cmp = this.comparers[level];
    if (!cmp) {
      const { field, interval } = this.levels[level];
      const type: FieldType = interval === 'date' ? 'date' : interval !== undefined ? 'number' : ((this.own[level] ? undefined : this.ctx.fields?.[field]) ?? fieldTypeOf(key));
      cmp = this.comparers[level] = new ValueComparer(type, this.ctx.locale);
    }
    return cmp;
  }
}

function partOf(c: Comparable): string {
  return c === null ? '\u0000' : `${typeof c}:${c}`;
}

/** A member's id by its keys as they are: groups name one member with the same keys. */
function pathId(path: readonly unknown[]): string {
  let id = '';
  for (const key of path) id += `\u0001${key === null || key === undefined ? '\u0000' : key instanceof Date ? `date:${key.getTime()}` : `${typeof key}:${String(key)}`}`;
  return id;
}

export function measureRule<T>(measure: PivotMeasure<T>, ctx: EvaluateContext): { value(row: unknown): unknown; start(): SummaryAccumulator } {
  const own = measure.value as ((row: unknown) => unknown) | undefined;
  if (measure.type !== 'custom') return new SummaryRule(measure, ctx, own);
  const field = measure.field;
  const read = own ?? (field === undefined ? () => undefined : (ctx.summaryValue?.(field) ?? ((row: unknown) => getField(row, field))));
  return {
    value: read,
    start: () => {
      let state = measure.start();
      return {
        add: (value, row) => {
          state = measure.add(state, value, row as T);
        },
        result: () => measure.result(state),
      };
    },
  };
}

export function readKey(key: unknown, level: PivotLevel<any> | undefined, fields: Readonly<Record<string, FieldType>>): unknown {
  if (isEmpty(key)) return null;
  if (!level) return key;
  if (level.interval === 'date') return toDate(key) ?? key;
  if (level.interval !== undefined) return Number(key);
  const type = fields[level.field];
  if (type === 'date' || type === 'datetime') return toDate(key) ?? key;
  return type === 'number' ? Number(key) : key;
}

export function readValue(value: unknown, measure: PivotMeasure<any>): unknown {
  if (measure.type === 'count' || measure.type === 'countDistinct' || measure.type === 'sum') return Number(value ?? 0);
  if (measure.type === 'avg') return value === null ? null : Number(value);
  return value;
}

// Exact for the decimals the numbers are written with: 0.3 in ranges of 0.1 starts at 0.3, not 0.2.
function rangeStart(n: number, width: number): number {
  const places = Math.max(decimals(n), decimals(width));
  if (places === 0 || places > 15) return Math.floor(n / width) * width;
  const scale = 10 ** places;
  const w = Math.round(width * scale);
  return (Math.floor(Math.round(n * scale) / w) * w) / scale;
}

function decimals(n: number): number {
  const [digits, exponent] = String(n).split('e');
  const dot = digits.indexOf('.');
  return Math.max(0, (dot < 0 ? 0 : digits.length - dot - 1) - Number(exponent ?? 0));
}
