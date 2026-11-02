export interface PushedChange<T, K = unknown> {
  type: 'insert' | 'update' | 'remove';
  key: K;
  /** The row for an insert, the changed fields for an update. */
  data?: Partial<T>;
}
