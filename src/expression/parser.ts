import type { BinaryOperator, ExpressionNode, ExpressionSpan, ExpressionTree, LambdaNode, TemplateNode } from './expression-node';
import { problem, type ExpressionProblem } from './expression-problem';
import { Lexer, ReadFailure, type Token } from './lexer';

/** What reading an expression gives: its tree, or `null` with the problem that stopped the reading. */
export interface ParseResult {
  tree: ExpressionTree | null;
  problems: ExpressionProblem[];
}

/** How tightly each operator between two values binds; a higher one is worked out first. */
const BINDING: Record<string, number> = {
  '?': 1,
  '??': 2,
  or: 3,
  '||': 3,
  and: 4,
  '&&': 4,
  '=': 5,
  '!=': 5,
  '<': 6,
  '<=': 6,
  '>': 6,
  '>=': 6,
  in: 6,
  not: 6,
  '+': 7,
  '-': 7,
  '*': 8,
  '/': 8,
  '%': 8,
};

const UNARY_BINDING = 9;

const OPERATORS: Record<string, BinaryOperator> = { '||': 'or', '&&': 'and', or: 'or', and: 'and' };

/** What a token reads as in a problem's text. */
const shown = (token: Token) => (token.type === 'end' ? 'the end' : token.text);

class Parser {
  private readonly lexer: Lexer;
  private token: Token;
  constructor(source: string, start = 0) {
    this.lexer = new Lexer(source, start);
    this.token = this.lexer.next();
  }

  get current(): Token {
    return this.token;
  }

  advance(): Token {
    const was = this.token;
    this.token = this.lexer.next();
    return was;
  }

  /** Throws when the token is not `text`; else moves past it. */
  expect(text: string): Token {
    if (this.token.text !== text || this.token.type === 'text') this.fail(`'${text}'`);
    return this.advance();
  }

  fail(expected: string): never {
    const t = this.token;
    if (t.type === 'end') throw new ReadFailure(problem('unexpectedEnd', t.at, { expected }));
    if (t.text === '==') throw new ReadFailure(problem('useSingleEquals', t.at));
    throw new ReadFailure(problem('unexpectedToken', t.at, { found: shown(t), expected }));
  }

  is(text: string): boolean {
    return this.token.text === text && (this.token.type === 'punct' || this.token.type === 'keyword');
  }

  /** An expression whose operators bind tighter than `floor`. */
  expression(floor = 0): ExpressionNode {
    let left = this.unary();
    for (;;) {
      const t = this.token;
      if (t.type !== 'punct' && t.type !== 'keyword') return left;
      // `not in` is one operator; a `not` alone here ends the expression.
      const notIn = t.text === 'not';
      const binding = BINDING[t.text];
      if (binding === undefined || binding <= floor) return left;
      if (t.text === '?') {
        this.advance();
        const then = this.expression();
        this.expect(':');
        const otherwise = this.expression(binding - 1);
        left = { kind: 'conditional', test: left, then, else: otherwise, at: [left.at[0], otherwise.at[1]] };
        continue;
      }
      this.advance();
      if (notIn) this.expect('in');
      const op: BinaryOperator = notIn ? 'notIn' : (OPERATORS[t.text] ?? (t.text as BinaryOperator));
      const right = this.expression(binding);
      left = { kind: 'binary', op, left, right, at: [left.at[0], right.at[1]] };
    }
  }

  private unary(): ExpressionNode {
    const t = this.token;
    if (t.text === '-' && t.type === 'punct') {
      this.advance();
      const operand = this.expression(UNARY_BINDING);
      return { kind: 'unary', op: '-', operand, at: [t.at[0], operand.at[1]] };
    }
    if ((t.text === 'not' && t.type === 'keyword') || (t.text === '!' && t.type === 'punct')) {
      this.advance();
      const operand = this.expression(UNARY_BINDING);
      return { kind: 'unary', op: 'not', operand, at: [t.at[0], operand.at[1]] };
    }
    return this.postfix(this.primary());
  }

  /** Fields, items and calls after a value: `a.b`, `a?.b`, `a[i]`, `a?.[i]`, `f(…)`. */
  private postfix(node: ExpressionNode): ExpressionNode {
    for (;;) {
      if (this.is('.') || this.is('?.')) {
        const optional = this.advance().text === '?.';
        if (optional && this.is('[')) {
          node = this.index(node, true);
          continue;
        }
        const name = this.token;
        if (name.type !== 'name' && name.type !== 'keyword') this.fail('a name');
        this.advance();
        node = { kind: 'member', object: node, name: name.text, optional, at: [node.at[0], name.at[1]] };
      } else if (this.is('[')) node = this.index(node, false);
      else if (this.is('(')) {
        if (node.kind !== 'name') this.fail('an operator');
        const args = this.list(')', true);
        node = { kind: 'call', name: node.name, args: args.items, at: [node.at[0], args.end] };
      } else return node;
    }
  }

  private index(object: ExpressionNode, optional: boolean): ExpressionNode {
    this.expect('[');
    const index = this.expression();
    const end = this.expect(']').at[1];
    return { kind: 'index', object, index, optional, at: [object.at[0], end] };
  }

  /** Comma separated values up to `close`, after the opening mark; a call's may be short functions. */
  private list(close: string, call: boolean): { items: ExpressionNode[]; end: number } {
    this.advance();
    const items: ExpressionNode[] = [];
    while (!this.is(close)) {
      if (items.length) this.expect(',');
      items.push(call ? this.argument() : this.expression());
    }
    return { items, end: this.expect(close).at[1] };
  }

  /** An argument of a call: a short function when it is one, all of it, else an expression. */
  private argument(): ExpressionNode {
    const start = this.token.at[0];
    if (this.token.type === 'name' && this.arrowAfter(1)) {
      const name = this.advance().text;
      return this.lambda([name], start);
    }
    if (this.is('(')) {
      const params = this.lambdaParams();
      if (params) {
        while (!this.is(')')) this.advance();
        this.advance();
        return this.lambda(params, start);
      }
    }
    return this.expression();
  }

  /** Whether `=>` follows the next `count` tokens. */
  private arrowAfter(count: number): boolean {
    const probe = new Lexer(this.lexer.source, this.token.at[0]);
    for (let k = 0; k < count; k++) probe.next();
    const t = probe.next();
    return t.type === 'punct' && t.text === '=>';
  }

  private primary(): ExpressionNode {
    const t = this.token;
    switch (t.type) {
      case 'number':
        this.advance();
        return { kind: 'literal', value: t.value as number, at: t.at };
      case 'text':
        this.advance();
        return { kind: 'literal', value: t.value as string, at: t.at };
      case 'date':
      case 'datetime':
        this.advance();
        return { kind: 'literal', value: t.value as string, type: t.type, at: t.at };
      case 'keyword':
        if (t.text === 'true' || t.text === 'false' || t.text === 'null') {
          this.advance();
          return { kind: 'literal', value: t.text === 'null' ? null : t.text === 'true', at: t.at };
        }
        return this.fail('a value');
      case 'name':
        if (this.arrowAfter(1)) throw new ReadFailure(problem('lambdaOutsideCall', t.at));
        this.advance();
        return { kind: 'name', name: t.text, at: t.at };
      case 'punct':
        if (t.text === '(') {
          if (this.lambdaParams()) throw new ReadFailure(problem('lambdaOutsideCall', t.at));
          this.advance();
          const inner = this.expression();
          this.expect(')');
          return inner;
        }
        if (t.text === '[') {
          const items = this.list(']', false);
          return { kind: 'list', items: items.items, at: [t.at[0], items.end] };
        }
        if (t.text === '{') return this.object();
        return this.fail('a value');
      default:
        return this.fail('a value');
    }
  }

  /** The names of a short function's parameters when the `(` here opens them (`(a, b) =>`); nothing is read. */
  private lambdaParams(): string[] | null {
    const probe = new Lexer(this.lexer.source, this.token.at[0]);
    probe.next();
    const names: string[] = [];
    let t = probe.next();
    const arrow = () => {
      const after = probe.next();
      return after.type === 'punct' && after.text === '=>' ? names : null;
    };
    if (t.type === 'punct' && t.text === ')') return arrow();
    for (;;) {
      if (t.type !== 'name') return null;
      names.push(t.text);
      t = probe.next();
      if (t.type === 'punct' && t.text === ',') t = probe.next();
      else if (t.type === 'punct' && t.text === ')') return arrow();
      else return null;
    }
  }

  private lambda(params: string[], start: number): LambdaNode {
    this.expect('=>');
    const body = this.expression();
    return { kind: 'lambda', params, body, at: [start, body.at[1]] };
  }

  private object(): ExpressionNode {
    const open = this.advance();
    const entries: { key: string; value: ExpressionNode }[] = [];
    while (!this.is('}')) {
      if (entries.length) this.expect(',');
      const key = this.token;
      if (key.type !== 'name' && key.type !== 'text' && key.type !== 'keyword') this.fail('a name');
      this.advance();
      this.expect(':');
      entries.push({ key: key.type === 'text' ? (key.value as string) : key.text, value: this.expression() });
    }
    const end = this.expect('}').at[1];
    return { kind: 'object', entries, at: [open.at[0], end] };
  }
}

const failed = (e: unknown): ParseResult => {
  if (e instanceof ReadFailure) return { tree: null, problems: [e.problem] };
  throw e;
};

/** Reads an expression: its tree, or the problem that stopped the reading, where it is. */
export function parse(source: string): ParseResult {
  try {
    const parser = new Parser(source);
    if (parser.current.type === 'end') parser.fail('a value');
    const root = parser.expression();
    if (parser.current.type !== 'end') parser.fail('an operator or the end');
    return { tree: { version: 1, source, root }, problems: [] };
  } catch (e) {
    return failed(e);
  }
}

/**
 * Reads a text with expressions in it: `{{ … }}` parts are expressions, the rest is text (`\{{` writes `{{`). Its tree's
 * root is a `template`.
 */
export function parseTemplate(source: string): ParseResult {
  try {
    const parts: (string | ExpressionNode)[] = [];
    let text = '';
    let at = 0;
    while (at < source.length) {
      if (source.startsWith('\\{{', at)) {
        text += '{{';
        at += 3;
        continue;
      }
      if (!source.startsWith('{{', at)) {
        text += source[at++];
        continue;
      }
      if (text) parts.push(text);
      text = '';
      const parser = new Parser(source, at + 2);
      if (parser.current.type === 'end') throw new ReadFailure(problem('unclosedTemplate', [at, source.length]));
      const node = parser.expression();
      const after: Token = parser.current;
      const close: ExpressionSpan = [after.at[0], after.at[0] + 2];
      if (!(after.text === '}' && after.type === 'punct' && source[close[0] + 1] === '}')) {
        if (after.type === 'end') throw new ReadFailure(problem('unclosedTemplate', [at, source.length]));
        parser.fail("'}}'");
      }
      parts.push(node);
      at = close[1];
    }
    if (text) parts.push(text);
    const root: TemplateNode = { kind: 'template', parts, at: [0, source.length] };
    return { tree: { version: 1, source, root }, problems: [] };
  } catch (e) {
    return failed(e);
  }
}
