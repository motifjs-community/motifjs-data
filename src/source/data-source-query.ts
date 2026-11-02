import type { FilterExpression } from '../query/filter-expression';
import type { GroupItem } from '../query/group-item';
import type { SortItem } from '../query/sort-item';

/** Parts of the query to change at once; the ones left out stay. */
export interface DataSourceQuery {
  filter?: FilterExpression | null;
  sort?: readonly SortItem[];
  group?: readonly GroupItem[];
  searchText?: string;
  params?: Readonly<Record<string, unknown>>;
}
