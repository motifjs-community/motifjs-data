import type { FilterExpression } from './filter-expression';
import type { PivotInterval } from './pivot-interval';

/**
 * Keeps the rows whose member is one of `paths` (`'include'`, the default) or none of them (`'exclude'`): `field` (or
 * `value`) is read through each of `intervals` in turn, the way a pivot's levels read it, and a path names a member from
 * the first interval down (with `['year', 'quarter']`, `[2024]` is a year and `[2024, 2]` its second quarter). Keys are
 * told apart the way members are; `null` stands for empty values. The field need not be on an axis.
 *
 * @example
 * { field: 'date', intervals: ['year', 'quarter'], paths: [[2024, 1], [2024, 2]] }
 * { field: 'country', paths: [['Germany'], [null]], type: 'exclude' }
 * { field: 'date', intervals: ['year'], paths: [[2024]], filter: where('amount', '>', 1000) }
 */
export interface PivotKeep<T = unknown> {
  field: string;
  /** The intervals of the levels, the largest first; none for the values as they are. */
  intervals?: readonly PivotInterval[];
  /** Reads the value with this function instead of `field` (a computed value); kept in memory only. */
  value?: (row: T) => unknown;
  paths: readonly (readonly unknown[])[];
  type?: 'include' | 'exclude';
  /**
   * A row this filter passes counts as one of the members too: kept with `'include'`, left out with `'exclude'`. It
   * joins members and conditions of their own, the way a pivot's header filter offers both.
   */
  filter?: FilterExpression;
}
