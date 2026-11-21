import type { PivotSliceResult } from './pivot-slice-result';

/** The members of a pivot axis that `loadPivotMembers` asked for. */
export interface PivotMembersResult {
  /** One per slice, in order. */
  slices: PivotSliceResult[];
  /** The place of each member `find` named among its parent's children, in order; -1 for one with no rows. */
  found?: number[];
}
