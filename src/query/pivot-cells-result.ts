/** The crossings `loadPivotCells` asked for. */
export interface PivotCellsResult {
  /** The measures where a row member and a column member cross, in order; `undefined` when no row falls in both. */
  values(rowPath: readonly unknown[], columnPath: readonly unknown[]): readonly unknown[] | undefined;
  /** The number of rows in both. */
  count(rowPath: readonly unknown[], columnPath: readonly unknown[]): number;
}
