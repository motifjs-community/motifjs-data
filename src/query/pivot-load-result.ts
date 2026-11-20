import type { PivotMember } from './pivot-member';

/** The members of both axes of a pivot and the measures of their crossings. */
export interface PivotLoadResult {
  /** The root of the row axis: the grand total, with the top row members as its children. */
  rows: PivotMember;
  /** The root of the column axis. */
  columns: PivotMember;
  /** The values of the measures where a row member and a column member cross, in order; `undefined` when no row falls in both. */
  values(row: PivotMember, column: PivotMember): readonly unknown[] | undefined;
}
