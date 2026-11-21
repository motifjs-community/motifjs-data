import { validateFilter } from '../query/filter-validation';
import { isPivotInterval } from '../query/pivot';
import type { PivotCellsOptions } from '../query/pivot-cells-options';
import type { PivotCountsOptions } from '../query/pivot-counts-options';
import type { PivotKeep } from '../query/pivot-keep';
import type { PivotLevel } from '../query/pivot-level';
import type { PivotLoadOptions } from '../query/pivot-load-options';
import type { PivotMeasure } from '../query/pivot-measure';
import type { PivotMembersOptions } from '../query/pivot-members-options';
import type { PivotRunningTotal } from '../query/pivot-running-total';
import type { PivotSummarySort } from '../query/pivot-summary-sort';

/** The summary types a backend and memory compute. */
export const SUMMARY_TYPES = new Set(['count', 'countDistinct', 'sum', 'min', 'max', 'avg']);

type Invalid = (detail: string) => Error;

/** The options of `loadPivot` as the adapter works with them: copies, checked; `invalid` makes the error of a wrong one. */
export function checkPivotOptions<T>(o: PivotLoadOptions<T>, invalid: Invalid): PivotLoadOptions<T> {
  const out: PivotLoadOptions<T> = { ...o };
  checkFilter(o, out, invalid);
  for (const name of ['rows', 'columns'] as const) if (o[name]) out[name] = checkLevels(o[name], name, invalid);
  if (o.keep) out.keep = checkKeep(o.keep, invalid);
  if (o.measures) out.measures = checkMeasures(o.measures, invalid);
  for (const name of ['expandedRows', 'expandedColumns'] as const) {
    const paths = o[name];
    if (paths === undefined || paths === true) continue;
    if (!Array.isArray(paths) || !paths.every(Array.isArray)) throw invalid(`${name} is true or a list of paths (arrays of keys)`);
    out[name] = paths.map((path) => [...path]);
  }
  if (o.expand) out.expand = [...o.expand];
  return out;
}

/** The options of `loadPivotMembers`, checked. */
export function checkMembersOptions<T>(o: PivotMembersOptions<T>, invalid: Invalid): PivotMembersOptions<T> {
  const out: PivotMembersOptions<T> = { ...o };
  checkFilter(o, out, invalid);
  out.levels = checkLevels(o.levels, 'levels', invalid);
  if (!out.levels.length) throw invalid('levels needs at least one level');
  const slice = (s: (typeof o.slices)[number]) =>
    !!s && Array.isArray(s.parent) && s.parent.length < out.levels.length && (s.skip === undefined || isCount(s.skip)) && (s.take === undefined || isCount(s.take));
  if (!Array.isArray(o.slices) || !o.slices.length || !o.slices.every(slice)) throw invalid('slices are { parent: keys above the last level, skip?, take? }, at least one');
  if (o.slices.some((s) => s.parent.length !== o.slices[0].parent.length)) throw invalid('every slice has its parent on the same level');
  out.slices = o.slices.map((s) => ({ ...s, parent: [...s.parent] }));
  if (o.keep) out.keep = checkKeep(o.keep, invalid);
  if (o.measures) out.measures = checkMeasures(o.measures, invalid);
  if (o.sortBySummary) out.sortBySummary = checkSummarySort(o.sortBySummary, 'sortBySummary', out.measures?.length ?? 0, invalid);
  if (o.find) {
    const depth = o.slices[0].parent.length + 1;
    if (!Array.isArray(o.find) || !o.find.every((path) => Array.isArray(path) && path.length === depth)) throw invalid(`find are members of the level asked for, ${depth} keys each`);
    out.find = o.find.map((path) => [...path]);
  }
  if (o.expand) out.expand = [...o.expand];
  return out;
}

/** The options of `loadPivotCounts`, checked. */
export function checkCountsOptions<T>(o: PivotCountsOptions<T>, invalid: Invalid): PivotCountsOptions<T> {
  const out: PivotCountsOptions<T> = { ...o };
  checkFilter(o, out, invalid);
  out.levels = checkLevels(o.levels, 'levels', invalid);
  if (!out.levels.length) throw invalid('levels needs at least one level');
  out.paths = checkPaths(o.paths, 'paths', out.levels.length - 1, invalid);
  if (o.keep) out.keep = checkKeep(o.keep, invalid);
  if (o.expand) out.expand = [...o.expand];
  return out;
}

/** The options of `loadPivotCells`, checked. */
export function checkCellsOptions<T>(o: PivotCellsOptions<T>, invalid: Invalid): PivotCellsOptions<T> {
  const out: PivotCellsOptions<T> = { ...o };
  checkFilter(o, out, invalid);
  out.rows = checkLevels(o.rows ?? [], 'rows', invalid);
  out.columns = checkLevels(o.columns ?? [], 'columns', invalid);
  out.measures = checkMeasures(o.measures ?? [], invalid);
  out.rowPaths = checkPaths(o.rowPaths, 'rowPaths', out.rows.length, invalid);
  out.columnPaths = checkPaths(o.columnPaths, 'columnPaths', out.columns.length, invalid);
  if (o.keep) out.keep = checkKeep(o.keep, invalid);
  if (o.running) {
    const measures = out.measures.length;
    const one = (r: PivotRunningTotal<T>) => !!r && Number.isInteger(r.measure) && r.measure >= 0 && r.measure < measures && (r.axis === 'rows' || r.axis === 'columns') && (r.orders === undefined || Array.isArray(r.orders));
    if (!Array.isArray(o.running) || !o.running.every(one)) throw invalid('running items are { measure: the place of one of measures, axis: "rows" | "columns", orders? }');
    out.running = o.running.map((r, i) => ({
      measure: r.measure,
      axis: r.axis,
      ...(r.orders ? { orders: r.orders.map((sort: PivotSummarySort<T> | null, k: number) => (sort ? checkSummarySort(sort, `running[${i}].orders[${k}]`, measures, invalid) : null)) } : {}),
    }));
  }
  if (o.expand) out.expand = [...o.expand];
  return out;
}

function checkSummarySort<T>(sort: PivotSummarySort<T>, name: string, measures: number, invalid: Invalid): PivotSummarySort<T> {
  const levels = sort.levels ? checkLevels(sort.levels, `${name}.levels`, invalid) : [];
  const path = sort.path ?? [];
  if (!Number.isInteger(sort.measure) || sort.measure < 0 || sort.measure >= measures) throw invalid(`${name}.measure is the place of one of measures`);
  if (!Array.isArray(path) || path.length > levels.length) throw invalid(`${name}.path is keys of ${name}.levels, from the top`);
  return { measure: sort.measure, levels, path: [...path] };
}

function checkFilter(o: { filter?: unknown }, out: { filter?: unknown }, invalid: Invalid) {
  if (!o.filter) {
    delete out.filter;
    return;
  }
  try {
    validateFilter(o.filter);
  } catch (e) {
    throw invalid((e as Error).message);
  }
}

function checkLevels<T>(levels: readonly PivotLevel<T>[], name: string, invalid: Invalid): PivotLevel<T>[] {
  const level = (l: PivotLevel<T>) =>
    !!l && typeof l.field === 'string' && isPivotInterval(l.interval) && (l.dir === undefined || l.dir === 'asc' || l.dir === 'desc') && (l.value === undefined || typeof l.value === 'function');
  if (!Array.isArray(levels) || !levels.every(level)) throw invalid(`${name} items are { field, interval?, dir?: "asc" | "desc", value? }`);
  return levels.map((l) => ({ ...l }));
}

function checkKeep<T>(keep: readonly PivotKeep<T>[], invalid: Invalid): PivotKeep<T>[] {
  const one = (k: PivotKeep<T>) =>
    !!k &&
    typeof k.field === 'string' &&
    (k.intervals === undefined || (Array.isArray(k.intervals) && k.intervals.every((i) => i !== undefined && isPivotInterval(i)))) &&
    (k.value === undefined || typeof k.value === 'function') &&
    Array.isArray(k.paths) &&
    k.paths.every(Array.isArray) &&
    (k.type === undefined || k.type === 'include' || k.type === 'exclude');
  if (!Array.isArray(keep) || !keep.every(one)) throw invalid('keep items are { field, intervals?, value?, paths: arrays of keys, type?: "include" | "exclude", filter? }');
  keep.forEach((k, i) => {
    if (k.filter === undefined) return;
    try {
      validateFilter(k.filter, `keep[${i}].filter`);
    } catch (e) {
      throw invalid((e as Error).message);
    }
  });
  return keep.map((k) => ({ ...k, paths: k.paths.map((path: readonly unknown[]) => [...path]) }));
}

function checkMeasures<T>(measures: readonly PivotMeasure<T>[], invalid: Invalid): PivotMeasure<T>[] {
  const one = (m: PivotMeasure<T>) => {
    if (!m) return false;
    if (m.type === 'custom') return typeof m.start === 'function' && typeof m.add === 'function' && typeof m.result === 'function';
    return SUMMARY_TYPES.has(m.type) && (m.type === 'count' || typeof m.field === 'string' || typeof m.value === 'function');
  };
  if (!Array.isArray(measures) || !measures.every(one)) throw invalid('measures are { type, field } of a summary type (count needs no field), or { type: "custom", start, add, result }');
  return measures.map((m) => ({ ...m }));
}

function checkPaths(paths: readonly (readonly unknown[])[], name: string, deepest: number, invalid: Invalid): unknown[][] {
  if (!Array.isArray(paths) || !paths.every((path) => Array.isArray(path) && path.length <= deepest)) throw invalid(`${name} are arrays of keys, at most ${deepest} each`);
  return paths.map((path) => [...path]);
}

function isCount(n: unknown): boolean {
  return Number.isInteger(n) && (n as number) >= 0;
}
