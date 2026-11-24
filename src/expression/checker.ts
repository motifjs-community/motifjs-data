import type { ExpressionFunction, ParamKind } from './expression-function';
import type { ExpressionNode, ExpressionTree } from './expression-node';
import { problem, type ExpressionProblem } from './expression-problem';
import { ANY, BOOLEAN, DATE, DATETIME, NULL, NUMBER, TEXT, joinTypes, listOf, nullable, schemaType, typeText, type ExpressionSchema, type ExpressionType } from './expression-type';

/** What checking an expression gives: the type of its value, and its problems (errors and warnings). */
export interface CheckResult {
  type: ExpressionType;
  problems: ExpressionProblem[];
}

export interface CheckOptions {
  /** The type the value is wanted as, as a condition is `boolean`; another gives a `resultType` problem. */
  expect?: ExpressionType | string;
  /** Functions of the application, besides those of the library. */
  functions?: readonly ExpressionFunction[];
}

/** Whether a value of type `t` may stand where `kinds` are taken; `any`, `null` and a text read as a day may. */
function takes(kinds: readonly ParamKind[], t: ExpressionType): boolean {
  if (kinds.includes('any') || t.name === 'any' || t.name === 'null') return true;
  return kinds.some((kind) => {
    if (kind === 'temporal') return t.name === 'date' || t.name === 'datetime' || t.name === 'text';
    if (kind === 'date' || kind === 'datetime') return t.name === 'date' || t.name === 'datetime' || t.name === 'text';
    return kind === t.name;
  });
}

/** Whether a value of type `found` may stand where `wanted` is. */
function fits(found: ExpressionType, wanted: ExpressionType): boolean {
  if (wanted.name === 'any' || found.name === 'any' || found.name === 'null') return true;
  if (wanted.name === 'list') return found.name === 'list' && fits(found.item, wanted.item);
  if (wanted.name === 'datetime') return found.name === 'datetime' || found.name === 'date';
  return found.name === wanted.name;
}

const kindsText = (kinds: readonly ParamKind[]) => kinds.map((k) => (k === 'temporal' ? 'a day or a moment' : k === 'lambda' ? 'a short function' : k)).join(' or ');

const isNumber = (t: ExpressionType) => t.name === 'number' || t.name === 'any' || t.name === 'null';
const isTemporal = (t: ExpressionType) => t.name === 'date' || t.name === 'datetime';

/** Told of each node as it is checked: its type, and the names known there (a short function's parameters too). */
export type CheckWatch = (node: ExpressionNode, type: ExpressionType, scope: ReadonlyMap<string, ExpressionType>) => void;

export class Checker {
  readonly problems: ExpressionProblem[] = [];
  readonly roots: Map<string, ExpressionType>;
  readonly functions: Map<string, ExpressionFunction>;
  private readonly source: string;
  private readonly watch: CheckWatch | undefined;

  constructor(source: string, schema: ExpressionSchema, functions: Map<string, ExpressionFunction>, watch?: CheckWatch) {
    this.source = source;
    this.roots = new Map(Object.entries(schema).map(([name, t]) => [name, schemaType(t)]));
    this.functions = functions;
    this.watch = watch;
  }

  private text(node: ExpressionNode): string {
    return this.source.slice(node.at[0], node.at[1]);
  }

  typeOf(node: ExpressionNode, scope: ReadonlyMap<string, ExpressionType>): ExpressionType {
    const found = this.typeOfNode(node, scope);
    this.watch?.(node, found, scope);
    return found;
  }

  private typeOfNode(node: ExpressionNode, scope: ReadonlyMap<string, ExpressionType>): ExpressionType {
    switch (node.kind) {
      case 'literal':
        if (node.type === 'date') return DATE;
        if (node.type === 'datetime') return DATETIME;
        if (node.value === null) return NULL;
        return typeof node.value === 'number' ? NUMBER : typeof node.value === 'boolean' ? BOOLEAN : TEXT;
      case 'name': {
        const found = scope.get(node.name) ?? this.roots.get(node.name);
        if (found) return found;
        this.problems.push(problem('unknownName', node.at, { name: node.name }));
        return ANY;
      }
      case 'member':
        return this.member(node, this.typeOf(node.object, scope), node.name, node.optional, node.object);
      case 'index': {
        const object = this.typeOf(node.object, scope);
        const index = this.typeOf(node.index, scope);
        if (object.name === 'any') return ANY;
        if (object.nullable && !node.optional) this.problems.push(problem('mayBeNull', node.object.at, { name: this.text(node.object) }, 'warning'));
        const more = !!object.nullable || node.optional;
        if (object.name === 'list') {
          if (!isNumber(index)) this.problems.push(problem('operandType', node.index.at, { op: '[ ]', left: typeText(object), right: typeText(index) }));
          return nullable(object.item);
        }
        if (object.name === 'object') {
          if (node.index.kind === 'literal' && typeof node.index.value === 'string') return this.member(node, object, node.index.value, node.optional, node.object);
          return object.open || index.name !== 'text' ? ANY : nullable(ANY, more);
        }
        if (object.name === 'null') return NULL;
        this.problems.push(problem('notAList', node.object.at, { found: typeText(object) }));
        return ANY;
      }
      case 'call':
        return this.call(node, scope);
      case 'lambda':
        // Read only as an argument of a call: `call` checks it there.
        this.problems.push(problem('lambdaOutsideCall', node.at));
        return ANY;
      case 'unary': {
        const operand = this.typeOf(node.operand, scope);
        if (node.op === '-') {
          if (!isNumber(operand)) this.problems.push(problem('operandType', node.at, { op: '-', left: typeText(operand), right: '-' }));
          return nullable(NUMBER, !!operand.nullable);
        }
        if (!['boolean', 'any', 'null'].includes(operand.name)) this.problems.push(problem('operandType', node.at, { op: 'not', left: typeText(operand), right: '-' }));
        return BOOLEAN;
      }
      case 'binary':
        return this.binary(node, scope);
      case 'conditional': {
        const test = this.typeOf(node.test, scope);
        if (!['boolean', 'any', 'null'].includes(test.name)) this.problems.push(problem('operandType', node.test.at, { op: '?', left: typeText(test), right: '-' }));
        return joinTypes(this.typeOf(node.then, scope), this.typeOf(node.else, scope));
      }
      case 'list':
        return listOf(node.items.map((item) => this.typeOf(item, scope)).reduce<ExpressionType | null>((joined, t) => (joined ? joinTypes(joined, t) : t), null) ?? ANY);
      case 'object':
        return { name: 'object', fields: Object.fromEntries(node.entries.map((entry) => [entry.key, this.typeOf(entry.value, scope)])) };
      case 'template':
        for (const part of node.parts) if (typeof part !== 'string') this.typeOf(part, scope);
        return TEXT;
    }
  }

  /** A field of a value of type `object`: its type, or a problem. */
  private member(node: ExpressionNode, object: ExpressionType, name: string, optional: boolean, of: ExpressionNode): ExpressionType {
    if (object.name === 'any') return ANY;
    if (object.name === 'null') return NULL;
    if (object.nullable && !optional) this.problems.push(problem('mayBeNull', of.at, { name: this.text(of) }, 'warning'));
    const more = !!object.nullable;
    if (object.name !== 'object') {
      this.problems.push(problem('notAnObject', of.at, { found: typeText(object) }));
      return ANY;
    }
    const field = Object.prototype.hasOwnProperty.call(object.fields, name) ? object.fields[name] : undefined;
    if (field) return nullable(field, more || !!field.nullable);
    if (!object.open) this.problems.push(problem('unknownField', [node.at[1] - name.length, node.at[1]], { type: typeText(object), name }));
    return ANY;
  }

  private call(node: Extract<ExpressionNode, { kind: 'call' }>, scope: ReadonlyMap<string, ExpressionType>): ExpressionType {
    const fn = this.functions.get(node.name);
    if (!fn) {
      this.problems.push(problem('unknownFunction', [node.at[0], node.at[0] + node.name.length], { name: node.name }));
      for (const arg of node.args) if (arg.kind !== 'lambda') this.typeOf(arg, scope);
      return ANY;
    }
    const required = fn.params.filter((p) => !p.optional && !p.rest).length;
    const rest = fn.params.some((p) => p.rest);
    if (node.args.length < required || (!rest && node.args.length > fn.params.length)) {
      const expected = rest ? `${required} or more` : required === fn.params.length ? String(required) : `${required} to ${fn.params.length}`;
      this.problems.push(problem('argumentCount', node.at, { name: fn.name, expected, count: node.args.length }));
    }
    const types: ExpressionType[] = [];
    node.args.forEach((arg, k) => {
      const p = fn.params[Math.min(k, fn.params.length - 1)];
      if (!p) return;
      if (arg.kind === 'lambda') {
        if (!p.kinds.includes('lambda')) {
          this.problems.push(problem('argumentType', arg.at, { name: fn.name, param: p.name, expected: kindsText(p.kinds), found: 'a short function' }));
          types.push(ANY);
          return;
        }
        // The short function's parameters take their types from the arguments before it.
        const given = p.lambda?.(types) ?? [];
        const inner = new Map(scope);
        arg.params.forEach((name, i) => inner.set(name, given[i] ?? ANY));
        types.push(this.typeOf(arg.body, inner));
        return;
      }
      const t = this.typeOf(arg, scope);
      types.push(t);
      if (p.kinds.includes('lambda') && !p.kinds.some((kind) => kind !== 'lambda')) {
        this.problems.push(problem('argumentType', arg.at, { name: fn.name, param: p.name, expected: kindsText(p.kinds), found: typeText(t) }));
      } else if (!takes(p.kinds, t)) {
        this.problems.push(problem('argumentType', arg.at, { name: fn.name, param: p.name, expected: kindsText(p.kinds), found: typeText(t) }));
      }
    });
    return fn.returns(types);
  }

  private binary(node: Extract<ExpressionNode, { kind: 'binary' }>, scope: ReadonlyMap<string, ExpressionType>): ExpressionType {
    const left = this.typeOf(node.left, scope);
    const right = this.typeOf(node.right, scope);
    const wrong = () => this.problems.push(problem('operandType', node.at, { op: node.op === 'notIn' ? 'not in' : node.op, left: typeText(left), right: typeText(right) }));
    const may = !!left.nullable || !!right.nullable;
    switch (node.op) {
      case '-':
      case '*':
      case '/':
      case '%':
        if (!isNumber(left) || !isNumber(right)) wrong();
        return nullable(NUMBER, may || left.name === 'null' || right.name === 'null');
      case '+':
        if (left.name === 'text' || right.name === 'text') return TEXT;
        if (left.name === 'any' || right.name === 'any') return ANY;
        if (!isNumber(left) || !isNumber(right)) wrong();
        return nullable(NUMBER, may);
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const ok =
          left.name === 'any' ||
          right.name === 'any' ||
          left.name === 'null' ||
          right.name === 'null' ||
          (left.name === 'number' && right.name === 'number') ||
          (left.name === 'text' && right.name === 'text') ||
          ((isTemporal(left) || left.name === 'text') && (isTemporal(right) || right.name === 'text'));
        if (!ok) wrong();
        return BOOLEAN;
      }
      case '=':
      case '!=':
        return BOOLEAN;
      case 'and':
      case 'or':
        if (!['boolean', 'any', 'null'].includes(left.name) || !['boolean', 'any', 'null'].includes(right.name)) wrong();
        return BOOLEAN;
      case '??':
        return left.name === 'null' ? right : joinTypes(nullable(left, false), right);
      case 'in':
      case 'notIn':
        if (right.name !== 'list' && right.name !== 'any' && right.name !== 'null') this.problems.push(problem('notAList', node.right.at, { found: typeText(right) }));
        return BOOLEAN;
    }
  }
}

/** The functions known by name: the library's, and the application's over them. */
export function functionsOf(library: readonly ExpressionFunction[], own: readonly ExpressionFunction[] = []): Map<string, ExpressionFunction> {
  return new Map([...library, ...own].map((fn) => [fn.name, fn]));
}

/**
 * Checks an expression against the types of the names it is given (`schema`): the type of its value, and its problems
 * where they are. The functions of the library and the application's are known.
 */
export function check(tree: ExpressionTree, schema: ExpressionSchema, library: readonly ExpressionFunction[], options: CheckOptions = {}): CheckResult {
  const checker = new Checker(tree.source, schema, functionsOf(library, options.functions));
  const found = checker.typeOf(tree.root, new Map());
  const expect = options.expect === undefined ? undefined : schemaType(options.expect);
  if (expect && !fits(found, expect)) checker.problems.push(problem('resultType', tree.root.at, { found: typeText(found), expected: typeText(expect) }));
  return { type: found, problems: checker.problems };
}
