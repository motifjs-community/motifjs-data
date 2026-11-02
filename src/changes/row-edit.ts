/** The unsaved state of one row. The row object keeps its values until the row is saved. */
export interface RowEdit<T> {
  rowId: string;
  row: T;
  /** Added and never saved. */
  isNew: boolean;
  /** Changed values by field. */
  draft: Record<string, unknown>;
  /** Messages by field; `''` holds the message of the whole row. */
  errors: Record<string, string>;
  saving: boolean;
  /** Marked for deletion (`batch`), or being deleted. */
  removed: boolean;
  /** The last save failed. */
  failed: boolean;
}
