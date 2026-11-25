import type { FilterExpression } from './filter-expression';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';
import type { PivotMeasure } from './pivot-measure';
import type { PivotSummarySort } from './pivot-summary-sort';

/**
 * How many members stand below the children of members of a pivot axis, a block of children at a time: where a view
 * places the lines of members open by default without reading every one. The children are taken in the order
 * `loadPivotMembers` gives them (the level's `dir`, or `sortBySummary`), without those `nonEmpty` leaves out, so block
 * `k` holds the children `loadPivotMembers` gives from `k * size`. Every parent stands on the same level.
 */
export interface PivotBlocksOptions<T = unknown> {
  filter?: FilterExpression | null;
  keep?: readonly PivotKeep<T>[];
  /** The levels of the axis, the largest first; the children are on the level below the parents. */
  levels: readonly PivotLevel<T>[];
  /** The members whose children are counted, by their keys from the top; `[]` for the top level's members. */
  parents: readonly (readonly unknown[])[];
  /** The children of a block. Without it every parent's children are one block. */
  size?: number;
  /** The levels counted below the children: 0 counts the children alone, 1 their children too, and so on. */
  depth: number;
  /** Computed for each member at the other axis's total, for `sortBySummary` and `nonEmpty`. */
  measures?: readonly PivotMeasure<T>[];
  sortBySummary?: PivotSummarySort<T>;
  /** Counts only the members whose measures are not all empty, on every level, as `PivotMembersOptions.nonEmpty`. */
  nonEmpty?: boolean;
  /** Related data the rows need when they are grouped in memory (OData `$expand`). */
  expand?: readonly string[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
