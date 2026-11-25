/** The children of one parent counted in blocks, as `loadPivotBlocks` asked. */
export interface PivotParentBlocks {
  /** The parent, by its keys as the request named it. */
  parent: readonly unknown[];
  /** The number of its children. */
  total: number;
  /**
   * Per block of children, in order: the number of members on each level from the children down, `depth + 1` numbers
   * (the block's children first, then the members below them).
   */
  counts: readonly (readonly number[])[];
}

/** What `loadPivotBlocks` asked for: one entry per parent, in order. */
export interface PivotBlocksResult {
  blocks: readonly PivotParentBlocks[];
}
