import type { EventArgs } from '@motifx/core';
import type { Change } from '../adapter/change';

/**
 * Rows are about to be sent. Change a change's `data` to change what goes out; `skip(row)` keeps one
 * row back (its edits and marks stay, unsent); `cancel` keeps every row back.
 */
export interface ChangeTrackerSavingEventArgs<T, K = unknown> extends EventArgs {
  /** What is sent, in the order it is sent. */
  readonly changes: readonly Change<T, K>[];
  /** The row of each change. */
  readonly rows: readonly T[];
  /** Keeps a row back from this save. */
  skip(row: T): void;
}
