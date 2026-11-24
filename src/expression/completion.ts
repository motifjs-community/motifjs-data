import { Checker, functionsOf } from './checker';
import type { ExpressionFunction } from './expression-function';
import type { ExpressionNode, ExpressionSpan } from './expression-node';
import { typeText, type ExpressionSchema, type ExpressionType } from './expression-type';
import { parse } from './parser';
import { tokens, type ExpressionToken } from './tokens';

/** A word that may be written at the caret: a name, a field of the value before the dot, a function or a word of the language. */
export interface ExpressionCompletion {
  label: string;
  kind: 'name' | 'field' | 'function' | 'keyword';
  /** The type of a name or a field, as text (`list<{ total: number }>`). */
  type?: string;
  /** The function, for its parameters and its description. */
  fn?: ExpressionFunction;
  /** The text written for it: a function's name is followed by its `(`. */
  insert: string;
}

/** The words that may be written at the caret, and the part of the text one is written over (the word being typed). */
export interface CompletionResult {
  at: ExpressionSpan;
  items: ExpressionCompletion[];
}

/** The call whose argument the caret is in: which argument, and where the call's name is. */
export interface SignatureHelp {
  name: string;
  /** `undefined` for a function that is not known. */
  fn: ExpressionFunction | undefined;
  /** From 0. */
  argument: number;
  at: ExpressionSpan;
}

export interface CompleteOptions {
  /** The text is a template: plain text with `{{ … }}` expressions in it. */
  template?: boolean;
  /** Functions of the application, besides those of the library. */
  functions?: readonly ExpressionFunction[];
}

/** The name written at the caret while the text before it is checked. */
const CARET = '__caret__';
const WORDS = new Set(['name', 'field', 'function', 'keyword', 'constant']);
/** Pieces after which a value has ended: an operator comes next, not another value. */
const ENDS_VALUE = new Set(['number', 'text', 'date', 'name', 'field', 'constant']);
const VALUE_WORDS = ['not', 'true', 'false', 'null'];
const OPERATOR_WORDS = ['and', 'or', 'in', 'not'];
const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '?': ' : null' };
const NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** The expression that holds the caret: where it starts and its pieces; `null` when the caret is in a template's plain text. */
function region(source: string, at: number, template: boolean): { start: number; pieces: ExpressionToken[] } | null {
  const all = tokens(source, { template });
  let start = template ? -1 : 0;
  let first = 0;
  all.forEach((token, k) => {
    if (token.kind !== 'mark' || token.at[0] >= at) return;
    const opens = source.startsWith('{{', token.at[0]);
    if (opens && token.at[1] <= at) {
      start = token.at[1];
      first = k + 1;
    } else if (!opens) start = -1;
  });
  if (start < 0) return null;
  const pieces: ExpressionToken[] = [];
  for (let k = first; k < all.length && all[k].at[0] < at && all[k].kind !== 'mark'; k++) pieces.push(all[k]);
  return { start, pieces };
}

function childrenOf(node: ExpressionNode): ExpressionNode[] {
  switch (node.kind) {
    case 'member':
      return [node.object];
    case 'index':
      return [node.object, node.index];
    case 'call':
      return node.args;
    case 'lambda':
      return [node.body];
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    case 'conditional':
      return [node.test, node.then, node.else];
    case 'list':
      return node.items;
    case 'object':
      return node.entries.map((entry) => entry.value);
    case 'template':
      return node.parts.filter((part): part is ExpressionNode => typeof part !== 'string');
    default:
      return [];
  }
}

function find(node: ExpressionNode, test: (node: ExpressionNode) => boolean): ExpressionNode | undefined {
  if (test(node)) return node;
  for (const child of childrenOf(node)) {
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
}

/** The ones whose label starts with `typed` first, then those that hold it; all of them for nothing typed. */
function filtered(items: ExpressionCompletion[], typed: string): ExpressionCompletion[] {
  if (!typed) return items;
  const lower = typed.toLowerCase();
  const starts = items.filter((item) => item.label.toLowerCase().startsWith(lower));
  const holds = items.filter((item) => !item.label.toLowerCase().startsWith(lower) && item.label.toLowerCase().includes(lower));
  return [...starts, ...holds];
}

const keyword = (label: string): ExpressionCompletion => ({ label, kind: 'keyword', insert: label });

/** Whether a text or a day is closed: its last character is the mark it opens with. */
function closed(source: string, piece: ExpressionToken): boolean {
  return piece.at[1] - piece.at[0] >= 2 && source[piece.at[1] - 1] === source[piece.at[0]];
}

/**
 * The words that may be written at offset `at` of an expression (or of a template's `{{ … }}`): after a dot the fields
 * of the value before it, after a value the words that join it to the next, elsewhere the names known there (a short
 * function's parameters too), the functions and the words that start a value. Those that start with or hold the word
 * being typed, which `at` of the result spans. `null` where nothing is written: in a text, a number or a template's
 * plain text, or at a key of an object.
 */
export function complete(
  source: string,
  at: number,
  schema: ExpressionSchema,
  library: readonly ExpressionFunction[],
  options: CompleteOptions = {},
): CompletionResult | null {
  const found = region(source, at, !!options.template);
  if (!found) return null;
  const { start } = found;
  const pieces = [...found.pieces];
  // The word at the caret: the part before it is what was typed, the whole of it is written over.
  let word: ExpressionSpan = [at, at];
  const last = pieces[pieces.length - 1];
  const reaches = !!last && last.at[1] >= at;
  if (reaches && WORDS.has(last.kind)) {
    word = last.at;
    pieces.pop();
  } else if (reaches && (last.at[1] > at || last.kind === 'number' || ((last.kind === 'text' || last.kind === 'date') && !closed(source, last)))) {
    // In a literal, at the end of a number, or at the end of a literal not closed yet.
    return null;
  } else if (/[\p{L}\p{N}_]/u.test(source[at] ?? '')) {
    let end = at;
    while (end < source.length && /[\p{L}\p{N}_]/u.test(source[end])) end++;
    word = [at, end];
  }
  const typed = source.slice(word[0], at);
  if (/^\d/.test(typed)) return null;
  const before = pieces[pieces.length - 1];
  const beforeText = before ? source.slice(before.at[0], before.at[1]) : '';
  if (before?.kind === 'error') return null;

  // The marks still open before the word, closed after it so the text reads.
  const open: string[] = [];
  for (const piece of pieces) {
    if (piece.kind !== 'punct' && piece.kind !== 'operator') continue;
    const mark = source.slice(piece.at[0], piece.at[1]);
    if (mark === '(' || mark === '[' || mark === '{' || mark === '?') open.push(mark);
    else if (mark === ':' && open[open.length - 1] === '?') open.pop();
    else if (mark === ')' || mark === ']' || mark === '}') {
      while (open[open.length - 1] === '?') open.pop();
      open.pop();
    }
  }
  const inner = open[open.length - 1];
  if (inner === '{' && (beforeText === '{' || beforeText === ',')) return null;

  const fns = functionsOf(library, options.functions);
  const member = beforeText === '.' || beforeText === '?.';
  if (!member && before && (ENDS_VALUE.has(before.kind) || [')', ']', '}'].includes(beforeText))) {
    return { at: word, items: filtered(OPERATOR_WORDS.map(keyword), typed) };
  }

  const probe = source.slice(start, word[0]) + CARET + open.reverse().map((mark) => CLOSERS[mark]).join('');
  const tree = parse(probe).tree;
  const target = tree && find(tree.root, (node) => (member ? node.kind === 'member' && node.name === CARET : node.kind === 'name' && node.name === CARET));
  let objectType: ExpressionType | undefined;
  let scope: ReadonlyMap<string, ExpressionType> = new Map();
  const checker = new Checker(probe, schema, fns, (node, type, names) => {
    if (target?.kind === 'member' && node === target.object) objectType = type;
    if (node === target) scope = names;
  });
  if (tree && target) checker.typeOf(tree.root, new Map());

  if (member) {
    const items: ExpressionCompletion[] = [];
    if (objectType?.name === 'object') {
      for (const [name, t] of Object.entries(objectType.fields)) if (NAME.test(name)) items.push({ label: name, kind: 'field', type: typeText(t), insert: name });
    }
    return { at: word, items: filtered(items, typed) };
  }
  const items: ExpressionCompletion[] = [];
  const named = new Set<string>();
  const add = (name: string, t: ExpressionType) => {
    if (named.has(name) || name === CARET) return;
    named.add(name);
    items.push({ label: name, kind: 'name', type: typeText(t), insert: name });
  };
  for (const [name, t] of scope) add(name, t);
  for (const [name, t] of checker.roots) add(name, t);
  for (const fn of fns.values()) items.push({ label: fn.name, kind: 'function', fn, insert: `${fn.name}(` });
  items.push(...VALUE_WORDS.map(keyword));
  return { at: word, items: filtered(items, typed) };
}

/** The call whose argument offset `at` is in, the innermost: its function and which argument; `null` outside every call. */
export function signatureAt(source: string, at: number, library: readonly ExpressionFunction[], options: CompleteOptions = {}): SignatureHelp | null {
  const found = region(source, at, !!options.template);
  if (!found) return null;
  const open: { call: ExpressionToken | null; commas: number }[] = [];
  let previous: ExpressionToken | null = null;
  for (const piece of found.pieces) {
    if (piece.at[1] > at) break;
    const mark = piece.kind === 'punct' ? source.slice(piece.at[0], piece.at[1]) : '';
    if (mark === '(') open.push({ call: previous?.kind === 'function' ? previous : null, commas: 0 });
    else if (mark === '[' || mark === '{') open.push({ call: null, commas: 0 });
    else if (mark === ')' || mark === ']' || mark === '}') open.pop();
    else if (mark === ',' && open.length) open[open.length - 1].commas++;
    previous = piece;
  }
  for (let k = open.length - 1; k >= 0; k--) {
    const call = open[k].call;
    if (!call) continue;
    const name = source.slice(call.at[0], call.at[1]);
    return { name, fn: functionsOf(library, options.functions).get(name), argument: open[k].commas, at: call.at };
  }
  return null;
}
