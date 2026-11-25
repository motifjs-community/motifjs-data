/** What a backend does itself; anything turned off here is done in memory. */
export interface Capabilities {
  filter: boolean;
  sort: boolean;
  paging: boolean;
  count: boolean;
  select: boolean;
  group: boolean;
  summary: boolean;
  /** Pivots (`loadPivot`); missing means no. */
  pivot?: boolean;
  /** The parts of a pivot a view loads as it scrolls (`loadPivotMembers`, `loadPivotCounts`, `loadPivotCells`); missing means no. */
  pivotWindow?: boolean;
  /**
   * With `pivotWindow`, the counts that place members open by default without reading every one (`loadPivotBlocks`, and
   * `descendants` of `loadPivotMembers`); missing means no: they are worked out in memory, and a view reads such members
   * whole as it did before.
   */
  pivotBlocks?: boolean;
  insert: boolean;
  update: boolean;
  remove: boolean;
}
