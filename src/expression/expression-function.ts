import type { ExpressionType } from './expression-type';

/** What a parameter takes: one of these kinds of value (`temporal` is a day or a moment, `lambda` a short function). */
export type ParamKind = 'number' | 'text' | 'boolean' | 'date' | 'datetime' | 'temporal' | 'list' | 'object' | 'any' | 'lambda';

export interface FunctionParam {
  name: string;
  kinds: ParamKind[];
  /** It may be left out. */
  optional?: boolean;
  /** It takes the rest of the arguments, as many as are given. */
  rest?: boolean;
  /** A short function's parameters' types, from the types of the arguments before it (the items of a list, say). */
  lambda?: (args: ExpressionType[]) => ExpressionType[];
}

/** What a function is given while it runs: the moment it is, the time zone and culture of the evaluation, and its limits. */
export interface RunContext {
  now: Date;
  timeZone: string;
  /** `undefined`: a culture of no country, for texts that read the same everywhere. */
  culture: string | undefined;
  /** Counts a step of work; throws past the limit. */
  step(count?: number): void;
  /** Throws for a list longer than the limit. */
  checkList(length: number): void;
  /** Throws for a text longer than the limit. */
  checkText(length: number): void;
  /** Throws a problem of an argument: `badArgument`. */
  fail(param: string, value: unknown): never;
}

/**
 * A function of the library: its parameters, its type from its arguments' types, what it does, and its text for the
 * reader. A short function arrives in `run` as a function of its parameters' values; every argument of a `lazy` one
 * arrives as a function that works it out, so only those needed are.
 */
export interface ExpressionFunction {
  name: string;
  category: 'text' | 'number' | 'list' | 'object' | 'date' | 'logic';
  params: FunctionParam[];
  returns: (args: ExpressionType[]) => ExpressionType;
  run: (args: unknown[], ctx: RunContext) => unknown;
  lazy?: boolean;
  description: string;
  example: string;
}
