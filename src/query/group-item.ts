/** A grouping level: rows with the same value of `field` form a group. Groups are ordered by that value. */
export interface GroupItem {
  field: string;
  /** Default `'asc'`. */
  dir?: 'asc' | 'desc';
}
