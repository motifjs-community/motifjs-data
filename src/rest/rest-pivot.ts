import type { PivotLoadOptions } from '../query/pivot-load-options';
import type { RestPivotPart, RestPivotPartOptions } from './rest-pivot-part';

/**
 * An endpoint that computes pivots: it takes the pivot's options and answers with its groups (see `PivotGroup`), and
 * the parts a view loads as it scrolls (a body with `kind`, see `defaultPivotPartBody`).
 */
export interface RestPivot<T> {
  url: string;
  /** Default `'POST'`. */
  method?: string;
  /** The body sent. Default: `filter`, `rows`, `columns`, `measures`, `expandedRows` and `expandedColumns` (see `defaultPivotBody`). */
  write?: (options: PivotLoadOptions<T>) => unknown;
  /** The groups of the answer. Default: the body when it is an array, or its `groups`. */
  read?: (body: unknown, options: PivotLoadOptions<T>) => unknown[];
  /** `false` for an endpoint that answers whole pivots only: a view then loads the pivot whole. Default `true`. */
  window?: boolean;
  /** The body of a part. Default: `defaultPivotPartBody`. */
  writePart?: (kind: RestPivotPart, options: RestPivotPartOptions<T>) => unknown;
  /** A part's answer as `loadPivotMembers`, `loadPivotCounts` or `loadPivotCells` read it. Default: `defaultReadPivotPart`. */
  readPart?: (kind: RestPivotPart, body: unknown, options: RestPivotPartOptions<T>) => unknown;
}
