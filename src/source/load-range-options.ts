import type { FilterExpression } from '../query/filter-expression';
import type { SortItem } from '../query/sort-item';

/** A part of a data source's rows, for `DataSource.loadRange`. */
export interface LoadRangeOptions {
  skip?: number;
  take?: number;
  /** Narrows the source's query (joined with AND). */
  filter?: FilterExpression | null;
  /** Another order for these rows than the source's (the rows of groups, in `groupOrder`). */
  sort?: readonly SortItem[];
  /** Asks for the total of the query too. */
  count?: boolean;
  signal?: AbortSignal;
}
