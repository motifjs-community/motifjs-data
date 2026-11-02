/** What a `ChangeTracker` holds for one row, to read. It is the tracker's own record and follows every change. */
export interface RowEditState<T> {
  /** The key as text, or `+1`, `+2` … for a new row. */
  readonly rowId: string;
  /** The row object; for a new row, the one in `newRows`. */
  readonly row: T;
  /** Added and never saved. */
  readonly isNew: boolean;
  /** Marked for deletion (`batch`), or being deleted. */
  readonly removed: boolean;
  readonly saving: boolean;
  /** The last save failed. */
  readonly failed: boolean;
  /** Changed values by field. */
  readonly draft: Readonly<Record<string, unknown>>;
  /** Messages by field; `''` holds the message of the whole row. */
  readonly errors: Readonly<Record<string, string>>;
}
