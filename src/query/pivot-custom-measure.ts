/**
 * A measure of a pivot with a summary of its own: each crossing starts a state with `start`, adds its rows with `add`
 * and gives `result` of the last state. Computed in memory only.
 *
 * @example
 * // The median of `amount`
 * { type: 'custom', field: 'amount', start: () => [], add: (list, value) => (typeof value === 'number' && list.push(value), list), result: median }
 */
export interface PivotCustomMeasure<T = unknown, S = any> {
  type: 'custom';
  /** The field whose value `add` gets; without it (and without `value`) `add` gets `undefined` and the row. */
  field?: string;
  /** Reads the value with this function instead of `field` (a computed value). */
  value?: (row: T) => unknown;
  start: () => S;
  add: (state: S, value: unknown, row: T) => S;
  result: (state: S) => unknown;
}
