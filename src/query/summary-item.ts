import type { SummaryType } from './summary-type';

/** One summary value. `count` needs no field and counts every row. */
export interface SummaryItem {
  type: SummaryType;
  field?: string;
  /**
   * Leave empty values (`null`, `undefined`, `''`, `NaN`) out. Default `true`. With `false`, `sum` and
   * `avg` count them as 0; `min` and `max` have no order for them and leave them out either way. Done
   * in memory only: a backend computes its own way.
   */
  skipEmpty?: boolean;
}
