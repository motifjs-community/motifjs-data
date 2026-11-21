/** The numbers `loadPivotCounts` asked for. */
export interface PivotCountsResult {
  /** The number of a member's children, the member named by its path as the request named it; 0 for one with no rows. */
  childCount(path: readonly unknown[]): number;
}
