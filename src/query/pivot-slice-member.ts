/** A member of a slice: its key, its path and its rows, its measures at the other axis's total, and the number of its children when asked. */
export interface PivotSliceMember {
  /** The value of the level (of its interval); `null` for empty values. */
  key: unknown;
  /** The keys from the top level down to this member. */
  path: readonly unknown[];
  count: number;
  /** The measures of the member at the other axis's total, in order. */
  values: readonly unknown[];
  /** The number of the member's children on the next level, with `childCounts`. */
  childCount?: number;
}
