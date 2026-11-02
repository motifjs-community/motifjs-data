/** What a row shows: nothing to save, a new row, changed values, a deletion mark, a save in progress, a failed save, or a message. */
export type RowStatus = '' | 'new' | 'changed' | 'removed' | 'saving' | 'failed' | 'invalid';
