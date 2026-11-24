import { Day } from './day';
import type { ExpressionSpan } from './expression-node';
import { problem, type ExpressionProblem } from './expression-problem';

/** A piece of an expression's text. A literal's `value` is what it means; a day's or a moment's is its normalized text. */
export interface Token {
  type: 'number' | 'text' | 'date' | 'datetime' | 'name' | 'keyword' | 'punct' | 'end';
  text: string;
  value?: number | string;
  at: ExpressionSpan;
}

/** A problem of the text, which stops the reading. */
export class ReadFailure extends Error {
  readonly problem: ExpressionProblem;

  constructor(found: ExpressionProblem) {
    super(found.message);
    this.problem = found;
  }
}

export const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);

/** The marks, longest first, so `?.` is read before `?`. */
const PUNCTS = ['=>', '?.', '??', '!=', '<=', '>=', '&&', '||', '==', '?', ':', '=', '<', '>', '!', '+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', '.'];

const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

/** A day or a moment written between `#` marks, as the tree keeps it; throws for one that is not. */
function readDate(text: string, at: ExpressionSpan): Token {
  const inner = text.slice(1, -1).trim();
  const fail = () => new ReadFailure(problem('badDate', at, { text }));
  if (DAY.test(inner)) {
    if (!Day.parse(inner)) throw fail();
    return { type: 'date', text, value: inner, at };
  }
  const m = MOMENT.exec(inner);
  if (!m || !Day.parse(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) throw fail();
  return { type: 'datetime', text, value: `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}${m[5] ?? ''}`, at };
}

/** Reads the text of an expression into tokens, one at a time, from any offset (a template reads its parts so). */
export class Lexer {
  readonly source: string;
  private at: number;

  constructor(source: string, start = 0) {
    this.source = source;
    this.at = start;
  }

  get offset(): number {
    return this.at;
  }

  next(): Token {
    const s = this.source;
    while (this.at < s.length && /\s/.test(s[this.at])) this.at++;
    const start = this.at;
    if (start >= s.length) return { type: 'end', text: '', at: [start, start] };
    const c = s[start];
    if (/\d/.test(c)) {
      const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(start))!;
      const after = s[start + m[0].length];
      if (after !== undefined && NAME_PART.test(after)) {
        const word = /^[\p{L}\p{N}_.]+/u.exec(s.slice(start))![0];
        throw new ReadFailure(problem('badNumber', [start, start + word.length], { text: word }));
      }
      this.at = start + m[0].length;
      return { type: 'number', text: m[0], value: Number(m[0]), at: [start, this.at] };
    }
    if (c === "'" || c === '"') return this.readText(c);
    if (c === '#') {
      const end = s.indexOf('#', start + 1);
      if (end < 0) throw new ReadFailure(problem('badDate', [start, s.length], { text: s.slice(start) }));
      this.at = end + 1;
      return readDate(s.slice(start, end + 1), [start, end + 1]);
    }
    if (NAME_START.test(c)) {
      let end = start + 1;
      while (end < s.length && NAME_PART.test(s[end])) end++;
      this.at = end;
      const text = s.slice(start, end);
      return { type: KEYWORDS.has(text) ? 'keyword' : 'name', text, at: [start, end] };
    }
    const punct = PUNCTS.find((p) => s.startsWith(p, start));
    if (!punct) throw new ReadFailure(problem('unexpectedToken', [start, start + 1], { found: c, expected: 'a value' }));
    this.at = start + punct.length;
    return { type: 'punct', text: punct, at: [start, this.at] };
  }

  private readText(quote: string): Token {
    const s = this.source;
    const start = this.at;
    let value = '';
    let at = start + 1;
    while (at < s.length && s[at] !== quote) {
      if (s[at] !== '\\') {
        value += s[at++];
        continue;
      }
      const next = s[at + 1];
      const simple: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', n: '\n', t: '\t' };
      if (next !== undefined && next in simple) {
        value += simple[next];
        at += 2;
        continue;
      }
      const code = next === 'u' ? /^\\u\{([0-9A-Fa-f]{1,6})\}/.exec(s.slice(at)) : null;
      if (code && Number.parseInt(code[1], 16) <= 0x10ffff) {
        value += String.fromCodePoint(Number.parseInt(code[1], 16));
        at += code[0].length;
        continue;
      }
      const escape = s.slice(at, at + 2);
      throw new ReadFailure(problem('badEscape', [at, at + escape.length], { escape }));
    }
    if (at >= s.length) throw new ReadFailure(problem('unclosedText', [start, s.length], { quote }));
    this.at = at + 1;
    return { type: 'text', text: s.slice(start, this.at), value, at: [start, this.at] };
  }
}
