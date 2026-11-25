import type { FilterExpression } from './filter-expression';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';
import type { PivotMeasure } from './pivot-measure';
import type { PivotSlice } from './pivot-slice';
import type { PivotSummarySort } from './pivot-summary-sort';

/**
 * Members of one level of a pivot axis, for a view that shows a part of it: the children of each slice's parent in the
 * order `loadPivot` gives them (by the level's `dir`, or by `sortBySummary`), the part each slice wants, and the number
 * of all of them. Every slice's parent stands on the same level.
 */
export interface PivotMembersOptions<T = unknown> {
  filter?: FilterExpression | null;
  keep?: readonly PivotKeep<T>[];
  /** The levels of the axis, the largest first; the members asked for are on the level below the slices' parents. */
  levels: readonly PivotLevel<T>[];
  slices: readonly PivotSlice[];
  /** Computed for each member at the other axis's total, in order. */
  measures?: readonly PivotMeasure<T>[];
  sortBySummary?: PivotSummarySort<T>;
  /** Also counts each member's children on the next level. */
  childCounts?: boolean;
  /**
   * Also counts the members below each member on this many levels (`descendants` of each member): its children, their
   * children, and so on, without those `nonEmpty` leaves out.
   */
  descendants?: number;
  /**
   * Members of the level whose places among their parent's children are wanted, by their keys from the top: where a
   * view places a member shown open that the parts it loaded do not hold.
   */
  find?: readonly (readonly unknown[])[];
  /**
   * Leaves out the members whose measures are all empty (`allEmpty` of their values): of `members`, `total`,
   * `childCount` and `found` (-1 for a member left out). A `count`, `countDistinct` or `sum` always has a value, so
   * with one of them, or without measures, no member is left out. Not about the empty member (key `null`): it is
   * left out only as any other is, by its measures.
   */
  nonEmpty?: boolean;
  /** Related data the rows need when they are grouped in memory (OData `$expand`). */
  expand?: readonly string[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
