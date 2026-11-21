import type { PivotSummarySort } from './pivot-summary-sort';

/**
 * A running total `loadPivotCells` gives with the measures: the sum of a measure over a member's siblings on one axis,
 * from the first up to the member itself, where it crosses the member of the other axis. The siblings stand in the
 * order `loadPivotMembers` gives them: their level's `dir`, or a measure (`orders`).
 */
export interface PivotRunningTotal<T = unknown> {
  /** The measure added up, by its place in `measures`. */
  measure: number;
  /** The axis whose members' siblings are added up. */
  axis: 'rows' | 'columns';
  /** How the siblings on each level of the axis are ordered by a measure, as `loadPivotMembers` orders them; `null` for the level's own order. */
  orders?: readonly (PivotSummarySort<T> | null)[];
}
