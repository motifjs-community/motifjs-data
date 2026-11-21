import type { FilterOperator } from './filter-operator';
import type { PivotInterval } from './pivot-interval';

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  /** `[from, to]` for `between` (a `null` end is open), an array for `in` / `notin`. */
  value?: unknown;
  caseSensitive?: boolean;
  /**
   * Compares the field's value through an interval, as a pivot level groups it: a part of a date (`2024` for
   * `'year'`, `1` to `4` for `'quarter'`) or the start of a range of numbers. A row without a value is blank.
   */
  interval?: PivotInterval;
}
