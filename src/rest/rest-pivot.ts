import type { PivotLoadOptions } from '../query/pivot-load-options';

/** An endpoint that computes pivots: it takes the pivot's options and answers with its groups (see `PivotGroup`). */
export interface RestPivot<T> {
  url: string;
  /** Default `'POST'`. */
  method?: string;
  /** The body sent. Default: `filter`, `rows`, `columns`, `measures`, `expandedRows` and `expandedColumns` (see `defaultPivotBody`). */
  write?: (options: PivotLoadOptions<T>) => unknown;
  /** The groups of the answer. Default: the body when it is an array, or its `groups`. */
  read?: (body: unknown, options: PivotLoadOptions<T>) => unknown[];
}
