import type { PivotSliceResult } from './pivot-slice-result';

/** The members of a pivot axis that `loadPivotMembers` asked for. */
export interface PivotMembersResult {
  /** One per slice, in order. */
  slices: PivotSliceResult[];
}
