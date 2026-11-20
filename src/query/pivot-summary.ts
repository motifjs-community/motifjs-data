import type { SummaryItem } from './summary-item';

/** A measure of a pivot computed with a summary type, the way `summarize` computes it. */
export interface PivotSummary<T = unknown> extends SummaryItem {
  /** Reads the value with this function instead of `field` (a computed value); computed in memory only. */
  value?: (row: T) => unknown;
}
