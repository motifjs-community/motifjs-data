import { toTemporal } from './dates';
import { Day } from './day';
import type { ExpressionFunction, RunContext } from './expression-function';
import type { ExpressionNode, ExpressionSpan, ExpressionTree } from './expression-node';
import { ExpressionError, type ExpressionProblemCode } from './expression-problem';
import { compare, equal, isRecord, kindOf, own, toText } from './values';

/** How far an evaluation may go before it stops with a problem. */
export interface EvaluateLimits {
  steps: number;
  listLength: number;
  textLength: number;
  depth: number;
}

export const DEFAULT_LIMITS: EvaluateLimits = { steps: 100_000, listLength: 100_000, textLength: 1_000_000, depth: 64 };

/** What an evaluation is given besides the values of its names. */
export interface EvaluateOptions {
  /** The moment `now()` gives; the moment of the call when not given. */
  now?: Date;
  /** The time zone days and moments are read in (`Europe/Istanbul`); the runtime's when not given. */
  timeZone?: string;
  /** The culture of texts (`tr-TR`): cases and names of months; none gives texts that read the same everywhere. */
  culture?: string;
  limits?: Partial<EvaluateLimits>;
  /** Functions of the application, besides those of the library. */
  functions?: readonly ExpressionFunction[];
}

type Scope = ReadonlyMap<string, unknown>;

/** A problem of an argument a function met: it stops the evaluation at the call. */
class ArgumentFailure extends Error {
  readonly param: string;
  readonly value: unknown;

  constructor(param: string, value: unknown) {
    super(param);
    this.param = param;
    this.value = value;
  }
}

const shownValue = (value: unknown, timeZone: string) => {
  const text = typeof value === 'string' ? `'${value}'` : toText(value, timeZone) || 'null';
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
};

class Evaluator {
  private readonly source: string;
  private readonly names: Readonly<Record<string, unknown>>;
  private readonly functions: Map<string, ExpressionFunction>;
  private readonly limits: EvaluateLimits;
  private readonly ctx: RunContext;
  private steps = 0;
  private depth = 0;
  private at: ExpressionSpan = [0, 0];

  constructor(source: string, names: Readonly<Record<string, unknown>>, functions: Map<string, ExpressionFunction>, options: EvaluateOptions) {
    this.source = source;
    this.names = names;
    this.functions = functions;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    const limits = this.limits;
    const self = this;
    this.ctx = {
      now: options.now ?? new Date(),
      timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      culture: options.culture,
      step(count = 1) {
        self.step(count);
      },
      checkList(length) {
        if (length > limits.listLength) self.fail('listLimit', { limit: limits.listLength });
      },
      checkText(length) {
        if (length > limits.textLength) self.fail('textLimit', { limit: limits.textLength });
      },
      fail(param, value) {
        throw new ArgumentFailure(param, value);
      },
    };
  }

  fail(code: ExpressionProblemCode, params: Record<string, string | number> = {}, at: ExpressionSpan = this.at): never {
    throw new ExpressionError(code, at, params);
  }

  private step(count = 1): void {
    this.steps += count;
    if (this.steps > this.limits.steps) this.fail('stepLimit', { limit: this.limits.steps });
  }

  private text(node: ExpressionNode): string {
    return this.source.slice(node.at[0], node.at[1]);
  }

  value(node: ExpressionNode, scope: Scope): unknown {
    this.step();
    if (++this.depth > this.limits.depth) this.fail('depthLimit', { limit: this.limits.depth }, node.at);
    try {
      return this.work(node, scope) ?? null;
    } finally {
      this.depth--;
    }
  }

  private work(node: ExpressionNode, scope: Scope): unknown {
    this.at = node.at;
    switch (node.kind) {
      case 'literal':
        if (node.type === 'date') return Day.parse(node.value as string);
        if (node.type === 'datetime') return toTemporal(node.value as string, this.ctx.timeZone);
        return node.value;
      case 'name':
        if (scope.has(node.name)) return scope.get(node.name);
        if (Object.prototype.hasOwnProperty.call(this.names, node.name)) return this.names[node.name] ?? null;
        return this.fail('unknownName', { name: node.name });
      case 'member': {
        const object = this.value(node.object, scope);
        return this.field(object, node.name, node.optional, node.object, node.at);
      }
      case 'index': {
        const object = this.value(node.object, scope);
        if (object === null) return node.optional ? null : this.fail('nullPath', { name: this.text(node.object) }, node.object.at);
        const index = this.value(node.index, scope);
        if (Array.isArray(object)) {
          if (typeof index !== 'number' || !Number.isInteger(index)) return this.fail('typeMismatch', { op: '[ ]', left: 'list', right: kindOf(index) }, node.at);
          return object[index] ?? null;
        }
        if (isRecord(object) && typeof index === 'string') return own(object, index);
        return this.fail('typeMismatch', { op: '[ ]', left: kindOf(object), right: kindOf(index) }, node.at);
      }
      case 'call':
        return this.call(node, scope);
      case 'lambda':
        return this.fail('lambdaOutsideCall', {}, node.at);
      case 'unary': {
        const operand = this.value(node.operand, scope);
        if (operand === null) return null;
        if (node.op === '-') return typeof operand === 'number' ? -operand : this.fail('typeMismatch', { op: '-', left: kindOf(operand), right: '-' }, node.at);
        return typeof operand === 'boolean' ? !operand : this.fail('typeMismatch', { op: 'not', left: kindOf(operand), right: '-' }, node.at);
      }
      case 'binary':
        return this.binary(node, scope);
      case 'conditional': {
        const test = this.value(node.test, scope);
        if (test !== null && typeof test !== 'boolean') return this.fail('typeMismatch', { op: '?', left: kindOf(test), right: '-' }, node.test.at);
        return test === true ? this.value(node.then, scope) : this.value(node.else, scope);
      }
      case 'list': {
        this.ctx.checkList(node.items.length);
        return node.items.map((item) => this.value(item, scope));
      }
      case 'object': {
        const object: Record<string, unknown> = {};
        for (const entry of node.entries) object[entry.key] = this.value(entry.value, scope);
        return object;
      }
      case 'template': {
        let text = '';
        for (const part of node.parts) {
          text += typeof part === 'string' ? part : toText(this.value(part, scope), this.ctx.timeZone);
          this.ctx.checkText(text.length);
        }
        return text;
      }
    }
  }

  /** A field of a value: its own, `null` for one an object has not; `?.` gives `null` for a `null` value. */
  private field(object: unknown, name: string, optional: boolean, of: ExpressionNode, at: ExpressionSpan): unknown {
    if (object === null) return optional ? null : this.fail('nullPath', { name: this.text(of) }, of.at);
    if (!isRecord(object)) return this.fail('notAnObject', { found: kindOf(object) }, at);
    return own(object, name);
  }

  private call(node: Extract<ExpressionNode, { kind: 'call' }>, scope: Scope): unknown {
    const fn = this.functions.get(node.name);
    if (!fn) return this.fail('unknownFunction', { name: node.name }, node.at);
    const args = node.args.map((arg) => {
      if (arg.kind === 'lambda') {
        return (...values: unknown[]) => {
          const inner = new Map(scope);
          arg.params.forEach((name, k) => inner.set(name, values[k] ?? null));
          return this.value(arg.body, inner);
        };
      }
      return fn.lazy ? () => this.value(arg, scope) : this.value(arg, scope);
    });
    this.at = node.at;
    try {
      const result = fn.run(args, this.ctx);
      return result === undefined ? null : result;
    } catch (e) {
      if (e instanceof ArgumentFailure) return this.fail('badArgument', { name: fn.name, param: e.param, value: shownValue(e.value, this.ctx.timeZone) }, node.at);
      throw e;
    }
  }

  private binary(node: Extract<ExpressionNode, { kind: 'binary' }>, scope: Scope): unknown {
    const tz = this.ctx.timeZone;
    // The ones that work out their right side only when it is needed.
    if (node.op === 'and' || node.op === 'or') {
      const left = this.truth(this.value(node.left, scope), node);
      if (node.op === 'and' ? !left : left) return left;
      return this.truth(this.value(node.right, scope), node);
    }
    if (node.op === '??') {
      const left = this.value(node.left, scope);
      return left !== null ? left : this.value(node.right, scope);
    }
    const left = this.value(node.left, scope);
    const right = this.value(node.right, scope);
    const mismatch = () => this.fail('typeMismatch', { op: node.op === 'notIn' ? 'not in' : node.op, left: kindOf(left), right: kindOf(right) }, node.at);
    switch (node.op) {
      case '=':
        return equal(left, right, tz);
      case '!=':
        return !equal(left, right, tz);
      case 'in':
      case 'notIn': {
        if (right === null) return node.op === 'notIn';
        if (!Array.isArray(right)) return mismatch();
        this.step(right.length);
        const found = right.some((item) => equal(left, item, tz));
        return node.op === 'in' ? found : !found;
      }
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const order = compare(left, right, tz);
        if (order === null) return null;
        if (order === undefined) return mismatch();
        return node.op === '<' ? order < 0 : node.op === '<=' ? order <= 0 : node.op === '>' ? order > 0 : order >= 0;
      }
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          const text = toText(left, tz) + toText(right, tz);
          this.ctx.checkText(text.length);
          return text;
        }
        if (left === null || right === null) return null;
        return typeof left === 'number' && typeof right === 'number' ? left + right : mismatch();
      default: {
        if (left === null || right === null) return null;
        if (typeof left !== 'number' || typeof right !== 'number') return mismatch();
        if ((node.op === '/' || node.op === '%') && right === 0) return this.fail('divideByZero', {}, node.at);
        return node.op === '-' ? left - right : node.op === '*' ? left * right : node.op === '/' ? left / right : left % right;
      }
    }
  }

  /** A value as a condition: `null` is false; a value that is not true or false is a problem. */
  private truth(value: unknown, node: Extract<ExpressionNode, { kind: 'binary' }>): boolean {
    if (value === null) return false;
    if (typeof value !== 'boolean') return this.fail('typeMismatch', { op: node.op, left: kindOf(value), right: '-' }, node.at);
    return value;
  }
}

/**
 * Works out the value of an expression with the values of its names (`names`): a number, a text, a boolean, a `Day`, a
 * `Date`, a list, an object or `null`. A problem stops it with an `ExpressionError` where it is.
 */
export function evaluate(tree: ExpressionTree, names: Readonly<Record<string, unknown>>, library: readonly ExpressionFunction[], options: EvaluateOptions = {}): unknown {
  const functions = new Map([...library, ...(options.functions ?? [])].map((fn) => [fn.name, fn]));
  return new Evaluator(tree.source, names, functions, options).value(tree.root, new Map());
}
