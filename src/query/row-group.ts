/** A group of rows. The last grouping level holds `items`, the levels above it hold `groups`. */
export interface RowGroup<T> {
  field: string;
  /** The value of `field` in the group (from its first row); `null` for empty values. */
  key: unknown;
  /** Rows in the group, all levels below included. */
  count: number;
  items?: T[];
  groups?: RowGroup<T>[];
  /** Values of `groupSummary`, in order. */
  summary?: unknown[];
}
