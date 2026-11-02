/** What `validateField` and `validateRow` get besides the row, which stays as it was read until it is saved. */
export interface RowCheckContext<T> {
  /** The values entered and not saved yet, by field. */
  readonly values: Readonly<Partial<T>>;
  readonly isNew: boolean;
  /** The value the field is saved with: the entered one when there is one, else the row's. */
  getValue(field: string): unknown;
}
