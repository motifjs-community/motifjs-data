/** A member of a pivot axis: the rows that have one value on a level, under the members above it. */
export interface PivotMember {
  /** The value of the level (of its interval); `null` for empty values. The root of an axis has none (`undefined`). */
  key: unknown;
  /** The keys from the top level down to this member; empty for the root, which stands for every row (the grand total). */
  path: readonly unknown[];
  /** The number of rows the member holds. */
  count: number;
  /** The members of the next level, in order, when the member is expanded (the root always is). */
  children?: PivotMember[];
}
