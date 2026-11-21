import type { PivotSliceMember } from './pivot-slice-member';

/** The members a slice asked for, and the number of all the children of its parent. */
export interface PivotSliceResult {
  parent: readonly unknown[];
  total: number;
  members: PivotSliceMember[];
}
