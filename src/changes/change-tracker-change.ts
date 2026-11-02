/**
 * What happened to `rows`. `edited`: values, marks or messages changed. `added`: new rows. `dropped`:
 * new rows taken away before they were saved. `saving`: sent. `saved` / `failed`: the answer came.
 * `released`: saved new rows left `newRows` because the source now has them.
 */
export interface ChangeTrackerChange<T> {
  reason: 'edited' | 'added' | 'dropped' | 'saving' | 'saved' | 'failed' | 'released';
  rows: readonly T[];
}
