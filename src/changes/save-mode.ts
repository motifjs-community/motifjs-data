/**
 * `wait`: a row is saved when the user leaves it (`commit`), and the caller waits for the answer.
 * `background`: the same, through one queue, without waiting. `batch`: only `saveChanges()` saves.
 */
export type SaveMode = 'wait' | 'background' | 'batch';
