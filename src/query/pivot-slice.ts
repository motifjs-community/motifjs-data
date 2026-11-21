/** A part of one member's children on a pivot axis: from `skip` on, `take` of them; every one without `take`. */
export interface PivotSlice {
  /** The member's keys from the top level down; `[]` for the top level. */
  parent: readonly unknown[];
  skip?: number;
  take?: number;
}
