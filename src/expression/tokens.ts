import type { ExpressionSpan } from './expression-node';
import { Lexer, ReadFailure } from './lexer';

/**
 * What a piece of an expression's text is, for an editor that colors it: a literal, a name, a function's name (one
 * followed by `(`), a field's name (one after `.`), a word of the language, a mark, or, in a template, its plain text
 * (`template`) and the `{{` and `}}` around its expressions (`mark`). A piece that cannot be read is an `error`.
 */
export type ExpressionTokenKind =
  | 'number'
  | 'text'
  | 'date'
  | 'name'
  | 'function'
  | 'field'
  | 'keyword'
  | 'constant'
  | 'operator'
  | 'punct'
  | 'template'
  | 'mark'
  | 'error';

export interface ExpressionToken {
  kind: ExpressionTokenKind;
  at: ExpressionSpan;
}

export interface TokensOptions {
  /** The text is a template: plain text with `{{ … }}` expressions in it. */
  template?: boolean;
}

const OPERATORS = new Set(['=>', '??', '!=', '<=', '>=', '&&', '||', '==', '?', ':', '=', '<', '>', '!', '+', '-', '*', '/', '%']);
const CONSTANTS = new Set(['true', 'false', 'null']);

/** The end of a text that does not read (a bad escape in it): its closing quote, or the end of the source. */
function textEnd(source: string, start: number): number {
  const quote = source[start];
  for (let at = start + 1; at < source.length; at++) {
    if (source[at] === '\\') at++;
    else if (source[at] === quote) return at + 1;
  }
  return source.length;
}

/**
 * Reads the tokens of an expression from `start`, to the end of the source or, in a template, to the `}}` that closes
 * it (given as a `mark`); returns where it stopped. A piece that does not read is kept as what it looks like, so the
 * rest still colors.
 */
function readTokens(source: string, start: number, out: ExpressionToken[], template: boolean): number {
  let lexer = new Lexer(source, start);
  let depth = 0;
  let before = '';
  for (;;) {
    let token;
    const was = lexer.offset;
    try {
      token = lexer.next();
    } catch (e) {
      if (!(e instanceof ReadFailure)) throw e;
      // The piece that failed starts after the spaces before it.
      let from = was;
      while (from < source.length && /\s/.test(source[from])) from++;
      const code = e.problem.code;
      let to = Math.max(e.problem.at[1], from + 1);
      let kind: ExpressionTokenKind = 'error';
      if (code === 'unclosedText') kind = 'text';
      else if (code === 'badEscape') {
        kind = 'text';
        to = textEnd(source, from);
      } else if (code === 'badDate') kind = 'date';
      else if (code === 'badNumber') kind = 'number';
      out.push({ kind, at: [from, to] });
      before = '';
      lexer = new Lexer(source, to);
      continue;
    }
    if (token.type === 'end') return source.length;
    const text = token.text;
    let kind: ExpressionTokenKind;
    switch (token.type) {
      case 'number':
      case 'text':
        kind = token.type;
        break;
      case 'date':
      case 'datetime':
        kind = 'date';
        break;
      case 'name':
      case 'keyword':
        if (before === '.' || before === '?.') kind = 'field';
        else if (token.type === 'name') kind = 'name';
        else kind = CONSTANTS.has(text) ? 'constant' : 'keyword';
        break;
      default:
        kind = OPERATORS.has(text) ? 'operator' : 'punct';
        if (text === '(' && out.length && out[out.length - 1].kind === 'name' && out[out.length - 1].at[1] <= token.at[0]) out[out.length - 1].kind = 'function';
        if (template && text === '{') depth++;
        if (template && text === '}') {
          if (depth === 0 && source[token.at[1]] === '}') {
            out.push({ kind: 'mark', at: [token.at[0], token.at[1] + 1] });
            return token.at[1] + 1;
          }
          depth = Math.max(0, depth - 1);
        }
    }
    out.push({ kind, at: token.at });
    before = token.type === 'punct' ? text : '';
  }
}

/**
 * The pieces of an expression's text, or of a template's, in order, each with what it is: for an editor that colors
 * them. It never throws: a text with problems still gives its pieces, those that do not read as `error` (the problems
 * themselves come from `parse`).
 */
export function tokens(source: string, options: TokensOptions = {}): ExpressionToken[] {
  const out: ExpressionToken[] = [];
  if (!options.template) {
    readTokens(source, 0, out, false);
    return out;
  }
  let at = 0;
  let from = 0;
  while (at < source.length) {
    if (source.startsWith('\\{{', at)) {
      at += 3;
      continue;
    }
    if (!source.startsWith('{{', at)) {
      at++;
      continue;
    }
    if (at > from) out.push({ kind: 'template', at: [from, at] });
    out.push({ kind: 'mark', at: [at, at + 2] });
    at = from = readTokens(source, at + 2, out, true);
  }
  if (at > from) out.push({ kind: 'template', at: [from, at] });
  return out;
}
