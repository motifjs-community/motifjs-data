import type { EvaluateContext } from './evaluate-context';
import { PivotAxis } from './pivot';
import type { PivotCellsOptions } from './pivot-cells-options';
import type { PivotCellsResult } from './pivot-cells-result';
import type { PivotLevel } from './pivot-level';
import type { PivotMembersOptions } from './pivot-members-options';
import type { PivotMembersResult } from './pivot-members-result';
import type { PivotRunningTotal } from './pivot-running-total';

type Path = readonly unknown[];

/** A parent whose children a running total adds up, and the members of the other axis they cross. */
export interface PivotRunningAsk<T> {
  /** The running total's place in `running`. */
  readonly index: number;
  readonly total: PivotRunningTotal<T>;
  readonly parent: Path;
  /** The children of the parent asked for. */
  readonly paths: readonly Path[];
  /** The members of the other axis asked for. */
  readonly others: readonly Path[];
  /** How the parent's children are read in their order, and their values where they cross the others. */
  readonly members: PivotMembersOptions<T>;
  readonly cells: (siblings: readonly Path[]) => PivotCellsOptions<T>;
}

/** What the running totals of `loadPivotCells` read first: per running total, the parents of the members asked for. */
export function runningAsks<T>(options: PivotCellsOptions<T>): PivotRunningAsk<T>[] {
  const out: PivotRunningAsk<T>[] = [];
  (options.running ?? []).forEach((total, index) => {
    const rows = total.axis === 'rows';
    const levels = rows ? options.rows : options.columns;
    const others = rows ? options.columnPaths : options.rowPaths;
    const parents = new Map<string, { parent: Path; paths: Path[] }>();
    for (const path of rows ? options.rowPaths : options.columnPaths) {
      // A total has no siblings: its running total is its value.
      if (!path.length || path.length > levels.length) continue;
      const parent = path.slice(0, -1);
      const id = JSON.stringify(parent);
      const group = parents.get(id) ?? { parent, paths: [] };
      group.paths.push(path);
      parents.set(id, group);
    }
    for (const { parent, paths } of parents.values()) {
      const depth = parent.length;
      const own: readonly PivotLevel<T>[] = levels.slice(0, depth + 1);
      out.push({
        index,
        total,
        parent,
        paths,
        others,
        members: { filter: options.filter, keep: options.keep, levels: own, slices: [{ parent }], measures: options.measures, sortBySummary: total.orders?.[depth] ?? undefined, expand: options.expand, params: options.params, signal: options.signal },
        cells: (siblings) => ({
          filter: options.filter,
          keep: options.keep,
          rows: rows ? own : options.rows,
          columns: rows ? options.columns : own,
          measures: options.measures,
          rowPaths: rows ? siblings : others,
          columnPaths: rows ? others : siblings,
          expand: options.expand,
          params: options.params,
          signal: options.signal,
        }),
      });
    }
  });
  return out;
}

/**
 * The running totals of the crossings asked for, from each parent's children in their order and their values: by the
 * id of a crossing (`PivotAxis.idOf` of both paths), a value per running total. A total's running total is its value.
 */
export function runningTotals<T>(
  options: PivotCellsOptions<T>,
  read: readonly { ask: PivotRunningAsk<T>; members: PivotMembersResult; cells: PivotCellsResult }[],
  own: PivotCellsResult,
  ctx: EvaluateContext,
): (rowPath: Path, columnPath: Path) => readonly unknown[] | undefined {
  const rowAxis = new PivotAxis<T>(options.rows, ctx);
  const columnAxis = new PivotAxis<T>(options.columns, ctx);
  const count = options.running?.length ?? 0;
  const sums = new Map<string, unknown[]>();
  const at = (r: Path, c: Path) => {
    const id = `${rowAxis.idOf(r)}\u0002${columnAxis.idOf(c)}`;
    let list = sums.get(id);
    if (!list) sums.set(id, (list = new Array(count).fill(null)));
    return list;
  };
  for (const { ask, members, cells } of read) {
    const rows = ask.total.axis === 'rows';
    const axis = rows ? rowAxis : columnAxis;
    const siblings = members.slices[0]?.members.map((m) => m.path) ?? [];
    const wanted = new Set(ask.paths.map((p) => axis.idOf(p)));
    for (const other of ask.others) {
      let sum: number | null = null;
      for (const sibling of siblings) {
        const v = (rows ? cells.values(sibling, other) : cells.values(other, sibling))?.[ask.total.measure];
        if (typeof v === 'number' && !Number.isNaN(v)) sum = (sum ?? 0) + v;
        if (wanted.has(axis.idOf(sibling))) at(rows ? sibling : other, rows ? other : sibling)[ask.index] = sum;
      }
    }
  }
  // A total's running total: its value.
  (options.running ?? []).forEach((total, k) => {
    const rows = total.axis === 'rows';
    for (const r of options.rowPaths) {
      for (const c of options.columnPaths) {
        if ((rows ? r : c).length) continue;
        at(r, c)[k] = own.values(r, c)?.[total.measure] ?? null;
      }
    }
  });
  return (rowPath, columnPath) => (count ? sums.get(`${rowAxis.idOf(rowPath)}\u0002${columnAxis.idOf(columnPath)}`) : undefined);
}
