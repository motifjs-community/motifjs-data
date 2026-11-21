import type { PivotLevel } from './pivot-level';

/**
 * Orders members by a measure instead of by their values: the measure's place in `measures`, read at the other axis's
 * total, or in one member of the other axis (`levels` and `path`). The level's `dir` turns it around; members without a
 * value go last either way, and members of the same value keep the order of their values.
 */
export interface PivotSummarySort<T = unknown> {
  measure: number;
  /** The levels of the other axis, the largest first, for `path`. */
  levels?: readonly PivotLevel<T>[];
  /** The member of the other axis the measure is read in, by its keys from the top level down; its total without. */
  path?: readonly unknown[];
}
