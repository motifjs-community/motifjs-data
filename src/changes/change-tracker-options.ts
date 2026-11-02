import type { DataSource } from '../source/data-source';
import type { RowCheckContext } from './row-check-context';
import type { SaveMode } from './save-mode';

export interface ChangeTrackerOptions<T, K> {
  source: DataSource<T, K>;
  /** Default `'wait'`. */
  saveMode?: SaveMode;
  /** Values a new row starts with. */
  createRow?: () => Partial<T>;
  /**
   * Checks a value as it is entered and before the row is saved; returns a message or nothing. `row` is
   * the row itself; the entered values are in `values`.
   */
  validateField?: (field: string, value: unknown, context: RowCheckContext<T> & { row: T }) => string | null | undefined | void;
  /**
   * Checks a row before it is saved: messages by field (`''` for the whole row), or one message. `row`
   * is the row itself; the entered values are in `context.values`, the fields they are in in `changed`.
   */
  validateRow?: (
    row: T,
    context: RowCheckContext<T> & { changed: readonly string[] },
  ) => Readonly<Record<string, string | null | undefined>> | string | null | undefined | void;
  /**
   * Saved new rows stay in `newRows` until the source's `reload()` or `releaseSaved()`, even when the
   * source has them, so a component can keep showing them where they were entered. Default `false`.
   */
  keepSavedNewRows?: boolean;
  /** The order changes are sent in by `saveChanges()`. Default `['remove', 'update', 'insert']`: deletions first, so unique values are free again. */
  saveOrder?: readonly ('remove' | 'update' | 'insert')[];
  /**
   * Whether an entered value is the one the row has, so it is no change. Default: empty values (`null`,
   * `undefined`, `''`) are the same, dates by their moment, else `Object.is`.
   */
  sameValue?: (a: unknown, b: unknown, field: string) => boolean;
}
