import type { FilterOperator } from './filter-operator';

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  /** `[from, to]` for `between` (a `null` end is open), an array for `in` / `notin`. */
  value?: unknown;
  caseSensitive?: boolean;
}
