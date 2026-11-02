import type { FilterExpression } from './filter-expression';
import type { GroupItem } from './group-item';
import type { SortItem } from './sort-item';
import type { SummaryItem } from './summary-item';

export interface LoadOptions {
  filter?: FilterExpression | null;
  sort?: readonly SortItem[];
  /** With `group`, `skip` and `take` count top-level groups. */
  skip?: number;
  take?: number;
  /** Also return the number of matching rows in `total` (and of top-level groups in `groupCount`). */
  count?: boolean;
  select?: readonly string[];
  /** Related data to include (OData `$expand`); ignored by backends without it. */
  expand?: readonly string[];
  /** Grouping levels; the result has `groups`, and `rows` in group order. */
  group?: readonly GroupItem[];
  /** With `group`: only the groups with their keys and counts (and `groupSummary`), no rows; `rows` is empty. */
  groupsOnly?: boolean;
  /** Summary values of each group. */
  groupSummary?: readonly SummaryItem[];
  /** Summary values of all matching rows, not only the page. */
  summary?: readonly SummaryItem[];
  /** Passed to the backend as they are. */
  params?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}
