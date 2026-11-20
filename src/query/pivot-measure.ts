import type { PivotCustomMeasure } from './pivot-custom-measure';
import type { PivotSummary } from './pivot-summary';

/** A value computed for each crossing of a pivot (and its totals). */
export type PivotMeasure<T = unknown> = PivotSummary<T> | PivotCustomMeasure<T>;
