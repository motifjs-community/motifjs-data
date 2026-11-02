/** `original` is the row as it was read (see `WriteOptions`). */
export type Change<T, K = unknown> =
  | { type: 'insert'; data: Partial<T> }
  | { type: 'update'; key: K; data: Partial<T>; original?: T }
  | { type: 'remove'; key: K; original?: T };
