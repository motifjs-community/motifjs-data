/** A service operation: its name, the arguments it takes and how its result is read. */
export interface SoapOperation<A extends unknown[], R> {
  name: string;
  /** Default: `namespace` + `contract/` + `name`. */
  action?: string;
  /** The arguments by parameter name, in the operation's parameter order. */
  args: (...input: A) => Record<string, unknown>;
  /** Reads the result, given as plain values, objects and arrays (see `lists`). */
  read?: (result: unknown) => R;
}
