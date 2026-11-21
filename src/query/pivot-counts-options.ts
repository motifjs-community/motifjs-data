import type { FilterExpression } from './filter-expression';
import type { PivotKeep } from './pivot-keep';
import type { PivotLevel } from './pivot-level';

/** The number of children of members of a pivot axis, each on the level below it: where a view places members shown open. */
export interface PivotCountsOptions<T = unknown> {
  filter?: FilterExpression | null;
  keep?: readonly PivotKeep<T>[];
  /** The levels of the axis, the largest first. */
  levels: readonly PivotLevel<T>[];
  /** The members, by their keys from the top level down, above the last level; `[]` counts the top level's members. */
  paths: readonly (readonly unknown[])[];
  /** Related data the rows need when they are grouped in memory (OData `$expand`). */
  expand?: readonly string[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
