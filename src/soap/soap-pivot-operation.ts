import type { PivotLoadOptions } from '../query/pivot-load-options';
import type { RestPivotPart, RestPivotPartOptions } from '../rest/rest-pivot-part';

/** What one call of the pivot operation computes: a whole pivot, or a part a view loads as it scrolls. */
export type SoapPivotKind = 'whole' | RestPivotPart;

/** The options the kind carries: `loadPivot`'s for `'whole'`, a part's for the others. */
export type SoapPivotOptions<T> = PivotLoadOptions<T> | RestPivotPartOptions<T>;

/**
 * One service operation that computes pivots, whole and in parts, with the same bodies and answers as a REST pivot
 * endpoint. By default it is called with two parameters, `kind` and `body`: `body` is the JSON text of
 * `defaultPivotBody` (`'whole'`) or `defaultPivotPartBody` (`'members'`, `'counts'`, `'cells'`, `'blocks'`), and the
 * operation answers the JSON text of the REST answer, read with `defaultReadPivot` (`'whole'`) or
 * `defaultReadPivotPart`. JSON goes as plain text because XML carries no types; `args` and `read` change both sides.
 */
export interface SoapPivotOperation<T> {
  name: string;
  /** Default: `namespace` + `contract/` + `name`. */
  action?: string;
  /** The arguments by parameter name, in the operation's parameter order. Default: `{ kind, body }`, `body` the JSON text above. */
  args?: (kind: SoapPivotKind, options: SoapPivotOptions<T>) => Record<string, unknown>;
  /** Reads the result as the REST defaults read a body: the groups for `'whole'` and `'cells'`, `{ slices }`, `{ counts }`, `{ blocks }`. Default: the result parsed as JSON when it is text. */
  read?: (kind: SoapPivotKind, result: unknown, options: SoapPivotOptions<T>) => unknown;
  /** `false` for an operation that answers whole pivots only: a view then loads the pivot whole. Default `true`. */
  window?: boolean;
  /** The operation answers `kind: 'blocks'` and members' `descendants` (`capabilities.pivotBlocks`). Default `false`: they are worked out in memory. */
  blocks?: boolean;
}
