import type { FilterExpression } from './filter-expression';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';
import type { PivotMeasure } from './pivot-measure';
import type { PivotRunningTotal } from './pivot-running-total';

/**
 * The measures where some row members and some column members cross, for a view that shows a part of a pivot: every
 * row path with every column path, each member at its own depth.
 */
export interface PivotCellsOptions<T = unknown> {
  filter?: FilterExpression | null;
  keep?: readonly PivotKeep<T>[];
  rows: readonly PivotLevel<T>[];
  columns: readonly PivotLevel<T>[];
  measures: readonly PivotMeasure<T>[];
  /** The row members by their keys from the top level down; `[]` is the total of the rows. */
  rowPaths: readonly (readonly unknown[])[];
  /** The column members likewise. */
  columnPaths: readonly (readonly unknown[])[];
  /** Running totals to give with the measures: each a measure added up over a member's siblings on an axis, up to it. */
  running?: readonly PivotRunningTotal<T>[];
  /** Related data the rows need when they are grouped in memory (OData `$expand`). */
  expand?: readonly string[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
