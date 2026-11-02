import type { RowGroup } from './row-group';

export interface LoadResult<T> {
  rows: T[];
  total?: number;
  /** With `group`. */
  groups?: RowGroup<T>[];
  /** With `group` and `count`: top-level groups. */
  groupCount?: number;
  /** With `summary`: its values, in order. */
  summary?: unknown[];
}
