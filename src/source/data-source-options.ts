import type { DataAdapter } from '../adapter/data-adapter';
import type { FilterExpression } from '../query/filter-expression';
import type { GroupItem } from '../query/group-item';
import type { SortItem } from '../query/sort-item';
import type { SummaryItem } from '../query/summary-item';
import type { LoadMode } from './load-mode';

export interface DataSourceOptions<T, K> {
  adapter: DataAdapter<T, K>;
  /** Default `'page'`. */
  loadMode?: LoadMode;
  /** Rows of a page or of a block. Default 20 (`'blocks'`: 50). */
  pageSize?: number;
  filter?: FilterExpression | null;
  sort?: readonly SortItem[];
  /** Grouping levels (`'all'` and `'page'`; a page holds top-level groups). */
  group?: readonly GroupItem[];
  /** Summary values of each group. */
  groupSummary?: readonly SummaryItem[];
  /** Summary values of all matching rows; in `'page'` and `'blocks'` they load once per query. */
  summary?: readonly SummaryItem[];
  /** Fields `search(text)` looks in. */
  searchFields?: readonly string[];
  /** Default `'contains'`. */
  searchOperator?: 'contains' | 'startswith' | 'endswith' | '=';
  select?: readonly string[];
  expand?: readonly string[];
  params?: Readonly<Record<string, unknown>>;
  /** `'all'`: a new query keeps the old rows in `rows` until the new ones arrive (no `cleared`). Default `true`. */
  keepRowsWhileLoading?: boolean;
  /**
   * Ask for the total row count: with each page (`'page'`), with the first block of a query
   * (`'blocks'`). Off, a block that comes back shorter than the block size tells where the rows end,
   * for a backend that cannot count (an endless list). Default `true`.
   */
  count?: boolean;
  /** `'blocks'`: blocks kept in memory; the ones used longest ago are dropped. Default 40. */
  cacheBlocks?: number;
  /** `'blocks'`: after a jump (a scroll bar drag), wait this long without movement before loading. Default 120 ms. */
  scrollStopMs?: number;
  /** `'blocks'`: a move of more rows than this is a jump, which waits for `scrollStopMs`. Default: `pageSize`. */
  jumpRows?: number;
  /** `'blocks'`: blocks this many away from the view keep loading when the view moves, and stay in the cache. Default 1. */
  nearBlocks?: number;
}
