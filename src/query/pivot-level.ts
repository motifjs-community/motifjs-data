import type { PivotInterval } from './pivot-interval';

/**
 * A level of a pivot axis: rows with the same value of `field` (through `interval`) form one member. The same field
 * can stand on several levels with different intervals (year, then month).
 */
export interface PivotLevel<T = unknown> {
  /** Dotted paths read nested values: `'customer.country'`. */
  field: string;
  interval?: PivotInterval;
  /** Members are ordered by their values; empty values form one member, the last. Default `'asc'`. */
  dir?: 'asc' | 'desc';
  /** Reads the value with this function instead of `field` (a computed value); grouped in memory only. */
  value?: (row: T) => unknown;
}
