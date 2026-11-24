import type { ExpressionSpan } from './expression-node';

/** What can be wrong with an expression: as it is written, as it is checked, and as it is worked out. */
export type ExpressionProblemCode =
  // Writing.
  | 'unexpectedEnd'
  | 'unexpectedToken'
  | 'unclosedText'
  | 'badEscape'
  | 'badNumber'
  | 'badDate'
  | 'useSingleEquals'
  | 'lambdaOutsideCall'
  | 'unclosedTemplate'
  // Checking.
  | 'unknownName'
  | 'unknownField'
  | 'unknownFunction'
  | 'argumentCount'
  | 'argumentType'
  | 'operandType'
  | 'notAList'
  | 'notAnObject'
  | 'mayBeNull'
  | 'resultType'
  // Working out.
  | 'nullPath'
  | 'divideByZero'
  | 'typeMismatch'
  | 'badArgument'
  | 'stepLimit'
  | 'listLimit'
  | 'textLimit'
  | 'depthLimit';

/** The text of each problem in English, with its `{params}`; a user interface gives its own, by the code. */
export const PROBLEM_TEXTS: Record<ExpressionProblemCode, string> = {
  unexpectedEnd: 'The expression ends too soon: {expected} is missing.',
  unexpectedToken: '{found} was not expected here; {expected} was.',
  unclosedText: 'The text is not closed: a {quote} is missing at its end.',
  badEscape: '{escape} is not an escape of a text.',
  badNumber: '{text} is not a number.',
  badDate: '{text} is not a day or a moment: write #2026-01-31# or #2026-01-31 09:30#.',
  useSingleEquals: 'Compare with = alone.',
  lambdaOutsideCall: 'A short function is written only as an argument of a function.',
  unclosedTemplate: 'The {{ is not closed with }}.',
  unknownName: '{name} is not known here.',
  unknownField: '{type} has no field {name}.',
  unknownFunction: 'There is no function {name}.',
  argumentCount: '{name} takes {expected} arguments, not {count}.',
  argumentType: 'The argument {param} of {name} is {expected}, not {found}.',
  operandType: '{op} does not take {left} and {right}.',
  notAList: '{found} is not a list.',
  notAnObject: '{found} has no fields.',
  mayBeNull: '{name} may be null: write ?. to give null then.',
  resultType: 'The expression gives {found}; {expected} is wanted here.',
  nullPath: '{name} is null: write ?. to give null then.',
  divideByZero: 'A division by zero.',
  typeMismatch: '{op} does not take {left} and {right}.',
  badArgument: 'The argument {param} of {name} cannot be {value}.',
  stepLimit: 'The expression took more than {limit} steps.',
  listLimit: 'A list grew past {limit} items.',
  textLimit: 'A text grew past {limit} characters.',
  depthLimit: 'The expression went deeper than {limit} levels.',
};

/** A problem of an expression: where it is, its code, the values its text names, and that text in English. */
export interface ExpressionProblem {
  code: ExpressionProblemCode;
  severity: 'error' | 'warning';
  at: ExpressionSpan;
  params: Record<string, string | number>;
  message: string;
}

/** The text of a problem with its params filled in. */
export function problemText(code: ExpressionProblemCode, params: Record<string, string | number>): string {
  return PROBLEM_TEXTS[code].replace(/\{(\w+)\}/g, (part, name: string) => (name in params ? String(params[name]) : part));
}

export function problem(code: ExpressionProblemCode, at: ExpressionSpan, params: Record<string, string | number> = {}, severity: 'error' | 'warning' = 'error'): ExpressionProblem {
  return { code, severity, at, params, message: problemText(code, params) };
}

/** A problem met while an expression is worked out: it stops there. */
export class ExpressionError extends Error {
  readonly code: ExpressionProblemCode;
  readonly at: ExpressionSpan;
  readonly params: Record<string, string | number>;

  constructor(code: ExpressionProblemCode, at: ExpressionSpan, params: Record<string, string | number> = {}) {
    super(problemText(code, params));
    this.name = 'ExpressionError';
    this.code = code;
    this.at = at;
    this.params = params;
  }
}
