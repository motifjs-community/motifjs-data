import { check as checkWith, type CheckOptions, type CheckResult } from './checker';
import { complete as completeWith, signatureAt as signatureWith, type CompleteOptions, type CompletionResult, type SignatureHelp } from './completion';
import { evaluate as evaluateWith, type EvaluateOptions } from './evaluator';
import type { ExpressionFunction } from './expression-function';
import type { ExpressionTree } from './expression-node';
import { ExpressionError } from './expression-problem';
import type { ExpressionSchema } from './expression-type';
import { CORE_FUNCTIONS } from './functions-core';
import { DATE_FUNCTIONS } from './functions-date';
import { parse, parseTemplate, type ParseResult } from './parser';

export { Day } from './day';
export { DEFAULT_LIMITS } from './evaluator';
export { ExpressionError, PROBLEM_TEXTS, problemText } from './expression-problem';
export { joinTypes, nullable, type, typeText } from './expression-type';
export { parse, parseTemplate } from './parser';
export type { CheckOptions, CheckResult } from './checker';
export type { CompleteOptions, CompletionResult, ExpressionCompletion as Completion, SignatureHelp } from './completion';
export type { EvaluateLimits, EvaluateOptions } from './evaluator';
export type { ExpressionFunction as Function, FunctionParam, ParamKind, RunContext } from './expression-function';
export type {
  BinaryOperator,
  ExpressionNode as Node,
  ExpressionSpan as Span,
  ExpressionTree as Tree,
  UnaryOperator,
} from './expression-node';
export type { ExpressionProblem as Problem, ExpressionProblemCode as ProblemCode } from './expression-problem';
export type { ExpressionSchema as Schema, ExpressionType as Type, PlainTypeName } from './expression-type';
export type { ParseResult } from './parser';
export { tokens } from './tokens';
export type { ExpressionToken as Token, ExpressionTokenKind as TokenKind, TokensOptions } from './tokens';

/** Every function of the library: texts, numbers, lists, objects, logic, days and moments. */
export const functions: readonly ExpressionFunction[] = [...CORE_FUNCTIONS, ...DATE_FUNCTIONS];

/**
 * Checks an expression against the types of the names it is given: the type of its value, and its problems where they
 * are. `options.expect` is the type the value is wanted as; `options.functions` the application's own.
 */
export function check(tree: ExpressionTree, schema: ExpressionSchema = {}, options: CheckOptions = {}): CheckResult {
  return checkWith(tree, schema, functions, options);
}

/** Works out the value of an expression with the values of its names; a problem throws an `ExpressionError`. */
export function evaluate(tree: ExpressionTree, names: Readonly<Record<string, unknown>> = {}, options: EvaluateOptions = {}): unknown {
  return evaluateWith(tree, names, functions, options);
}

/** The tree of a reading that found none: its problem as an `ExpressionError`. */
function treeOf(result: ParseResult): ExpressionTree {
  if (result.tree) return result.tree;
  const found = result.problems[0];
  throw new ExpressionError(found.code, found.at, found.params);
}

/** Reads and works out an expression's text at once; a problem of the text or of the evaluation throws. */
export function run(text: string, names: Readonly<Record<string, unknown>> = {}, options: EvaluateOptions = {}): unknown {
  return evaluate(treeOf(parse(text)), names, options);
}

/** Reads and works out a text with `{{ … }}` expressions in it: the text, its expressions written in. */
export function render(text: string, names: Readonly<Record<string, unknown>> = {}, options: EvaluateOptions = {}): string {
  return evaluate(treeOf(parseTemplate(text)), names, options) as string;
}

/**
 * The words that may be written at offset `at` of an expression's text (or of a template's `{{ … }}` with
 * `options.template`): the fields of the value before a dot, the names of `schema` and the short functions' parameters
 * known there, the functions and the words of the language; those that start with or hold the word being typed. `null`
 * where nothing is written (in a text, at a key of an object, in a template's plain text).
 */
export function complete(source: string, at: number, schema: ExpressionSchema = {}, options: CompleteOptions = {}): CompletionResult | null {
  return completeWith(source, at, schema, functions, options);
}

/** The call whose argument offset `at` is in: its function and which argument, for an editor that shows its parameters. */
export function signatureAt(source: string, at: number, options: CompleteOptions = {}): SignatureHelp | null {
  return signatureWith(source, at, functions, options);
}
