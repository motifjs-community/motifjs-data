/**
 * One crossing of a pivot as it is computed: the rows whose first `rows.length` row levels have these keys and whose
 * first `columns.length` column levels have those, their number and the values of the measures, in order. Empty keys
 * are `null`. With no key on an axis the group is the total of that axis.
 *
 * A backend that computes pivots returns, for every row depth from 0 to the number of row levels and every column depth
 * likewise, the groups of the rows by the levels down to those depths, keeping a group when its members are shown: at
 * depth 2 or deeper, only under a member that is expanded and shown itself.
 */
export interface PivotGroup {
  rows: readonly unknown[];
  columns: readonly unknown[];
  count: number;
  values: readonly unknown[];
  /** For `loadPivotCells` with `running`: the running totals of the crossing, one per running total, `null` for none. */
  running?: readonly unknown[];
}
