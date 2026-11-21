/** The crossings `loadPivotCells` asked for. */
export interface PivotCellsResult {
  /** The measures where a row member and a column member cross, in order; `undefined` when no row falls in both. */
  values(rowPath: readonly unknown[], columnPath: readonly unknown[]): readonly unknown[] | undefined;
  /** The number of rows in both. */
  count(rowPath: readonly unknown[], columnPath: readonly unknown[]): number;
  /**
   * The running totals asked for (`running`) where a row member and a column member cross, one per running total, in
   * order (`null` where none of the siblings has a value); `undefined` without running totals.
   */
  running?(rowPath: readonly unknown[], columnPath: readonly unknown[]): readonly unknown[] | undefined;
}
