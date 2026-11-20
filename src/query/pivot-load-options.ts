import type { FilterExpression } from './filter-expression';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';
import type { PivotMeasure } from './pivot-measure';

/**
 * What a pivot computes: the rows that `filter` passes and `keep` keeps, grouped by the `rows` levels and the `columns`
 * levels, with the `measures` of every crossing and of every total. A member's children are computed only when it is
 * expanded, and a member is shown only when every member above it is: the top members always are.
 */
export interface PivotLoadOptions<T = unknown> {
  filter?: FilterExpression | null;
  /** Keeps rows by their members on levels read like the axes' (date parts, ranges, computed values); every entry applies. */
  keep?: readonly PivotKeep<T>[];
  rows?: readonly PivotLevel<T>[];
  columns?: readonly PivotLevel<T>[];
  measures?: readonly PivotMeasure<T>[];
  /** The row members whose children are wanted, each by its `path`; `true` for every member. Default `true`. */
  expandedRows?: true | readonly (readonly unknown[])[];
  /** The column members whose children are wanted, each by its `path`; `true` for every member. Default `true`. */
  expandedColumns?: true | readonly (readonly unknown[])[];
  /** Related data the rows need when they are grouped in memory (OData `$expand`). */
  expand?: readonly string[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
