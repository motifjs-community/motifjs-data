import type { Change } from '../adapter/change';
import type { SaveOutcome } from '../adapter/save-outcome';

/** The answer to a save came: one outcome per change, in the order they were sent. */
export interface ChangeTrackerSavedEventArgs<T, K = unknown> {
  readonly changes: readonly Change<T, K>[];
  /** The row of each change. */
  readonly rows: readonly T[];
  readonly outcomes: readonly SaveOutcome<T, K>[];
}
