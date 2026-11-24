import { describe, expect, it } from 'vitest';
import { expression } from '../src';

const { parse, parseTemplate } = expression;

/** The tree of an expression written back with brackets, to see how it was read. */
function shape(node: expression.Node): string {
  switch (node.kind) {
    case 'literal':
      return node.type ? `#${node.value}#` : JSON.stringify(node.value);
    case 'name':
      return node.name;
    case 'member':
      return `${shape(node.object)}${node.optional ? '?.' : '.'}${node.name}`;
    case 'index':
      return `${shape(node.object)}${node.optional ? '?.' : ''}[${shape(node.index)}]`;
    case 'call':
      return `${node.name}(${node.args.map(shape).join(', ')})`;
    case 'lambda':
      return `(${node.params.join(', ')}) => ${shape(node.body)}`;
    case 'unary':
      return `(${node.op} ${shape(node.operand)})`;
    case 'binary':
      return `(${shape(node.left)} ${node.op} ${shape(node.right)})`;
    case 'conditional':
      return `(${shape(node.test)} ? ${shape(node.then)} : ${shape(node.else)})`;
    case 'list':
      return `[${node.items.map(shape).join(', ')}]`;
    case 'object':
      return `{${node.entries.map((e) => `${e.key}: ${shape(e.value)}`).join(', ')}}`;
    case 'template':
      return node.parts.map((p) => (typeof p === 'string' ? p : `{{${shape(p)}}}`)).join('');
  }
}

const read = (text: string) => {
  const result = parse(text);
  if (!result.tree) throw new Error(result.problems[0].message);
  return shape(result.tree.root);
};

const problemOf = (text: string) => {
  const result = parse(text);
  expect(result.tree).toBeNull();
  const [found] = result.problems;
  return { code: found.code, at: found.at, message: found.message };
};

describe('expression, reading', () => {
  it('reads values: numbers, texts with escapes, days, moments, true, false and null', () => {
    expect(read('12')).toBe('12');
    expect(read('2.5e-3')).toBe('0.0025');
    expect(read("'it\\'s'")).toBe('"it\'s"');
    expect(read('"a\\nb\\u{1F600}"')).toBe(JSON.stringify('a\nb😀'));
    expect(read('#2026-01-31#')).toBe('#2026-01-31#');
    expect(read('#2026-01-31 09:30#')).toBe('#2026-01-31T09:30:00#');
    expect(read('#2026-01-31T09:30:15+03:00#')).toBe('#2026-01-31T09:30:15+03:00#');
    expect(read('true and not false or null')).toBe('((true and (not false)) or null)');
  });

  it('binds operators as the specification orders them', () => {
    expect(read('a + b * c - d / e % f')).toBe('((a + (b * c)) - ((d / e) % f))');
    expect(read('a < b and c >= d or e = f and g != h')).toBe('(((a < b) and (c >= d)) or ((e = f) and (g != h)))');
    expect(read('a ?? b ?? c')).toBe('((a ?? b) ?? c)');
    expect(read('a ? b : c ? d : e')).toBe('(a ? b : (c ? d : e))');
    expect(read('a or b ? c : d')).toBe('((a or b) ? c : d)');
    expect(read('-a.b * 2')).toBe('((- a.b) * 2)');
    expect(read('x in [1, 2] and y not in list')).toBe('((x in [1, 2]) and (y notIn list))');
    expect(read('a || b && !c')).toBe('(a or (b and (not c)))');
    expect(read('(a + b) * c')).toBe('((a + b) * c)');
  });

  it('reads fields, items, calls, short functions, lists and objects', () => {
    expect(read('steps.orders.rows[0].email')).toBe('steps.orders.rows[0].email');
    expect(read('item?.contact?.email ?? x?.[2]')).toBe('(item?.contact?.email ?? x?.[2])');
    expect(read("steps['Sipariş listesi'].rows")).toBe('steps["Sipariş listesi"].rows');
    expect(read('item.in + item.null')).toBe('(item.in + item.null)');
    expect(read('filter(rows, r => r.total > 100)')).toBe('filter(rows, (r) => (r.total > 100))');
    expect(read('sortBy(rows, (r) => r.at, "desc")')).toBe('sortBy(rows, (r) => r.at, "desc")');
    expect(read('pair(rows, (a, b) => a + b, () => 1)')).toBe('pair(rows, (a, b) => (a + b), () => 1)');
  });

  it('reads lists and objects, empty ones too', () => {
    expect(read('[]')).toBe('[]');
    expect(read("{ id: 1, 'two words': 2, in: 3 }")).toBe('{id: 1, two words: 2, in: 3}');
    expect(read('{}')).toBe('{}');
    expect(read('count()')).toBe('count()');
  });

  it('keeps where each node stands, as the specification shows', () => {
    const tree = parse('count(steps.orders.rows) > 0').tree!;
    expect(tree).toEqual({
      version: 1,
      source: 'count(steps.orders.rows) > 0',
      root: {
        kind: 'binary',
        op: '>',
        at: [0, 28],
        left: {
          kind: 'call',
          name: 'count',
          at: [0, 24],
          args: [
            {
              kind: 'member',
              name: 'rows',
              optional: false,
              at: [6, 23],
              object: { kind: 'member', name: 'orders', optional: false, at: [6, 18], object: { kind: 'name', name: 'steps', at: [6, 11] } },
            },
          ],
        },
        right: { kind: 'literal', value: 0, at: [27, 28] },
      },
    });
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });

  it('says what stopped the reading, and where', () => {
    expect(problemOf('1 +')).toMatchObject({ code: 'unexpectedEnd', at: [3, 3] });
    expect(problemOf('')).toMatchObject({ code: 'unexpectedEnd' });
    expect(problemOf("'open")).toMatchObject({ code: 'unclosedText', at: [0, 5] });
    expect(problemOf("'a\\qb'")).toMatchObject({ code: 'badEscape', at: [2, 4], message: '\\q is not an escape of a text.' });
    expect(problemOf('12abc')).toMatchObject({ code: 'badNumber', at: [0, 5] });
    expect(problemOf('#2026-02-30#')).toMatchObject({ code: 'badDate' });
    expect(problemOf('#2026-01-31 25:00#')).toMatchObject({ code: 'badDate' });
    expect(problemOf('a == b')).toMatchObject({ code: 'useSingleEquals', at: [2, 4] });
    expect(problemOf('x => x + 1')).toMatchObject({ code: 'lambdaOutsideCall' });
    expect(problemOf('f(1 + (x => x))')).toMatchObject({ code: 'lambdaOutsideCall' });
    expect(problemOf('[x => x]')).toMatchObject({ code: 'lambdaOutsideCall' });
    expect(problemOf('a b')).toMatchObject({ code: 'unexpectedToken', at: [2, 3], message: 'b was not expected here; an operator or the end was.' });
    expect(problemOf('(a + 1)(2)')).toMatchObject({ code: 'unexpectedToken' });
    expect(problemOf('a @ b')).toMatchObject({ code: 'unexpectedToken', at: [2, 3] });
  });

  it('reads a template: its text and its expressions, {{ written with \\{{', () => {
    const tree = parseTemplate('Dear {{ item.name }}, {{ count(item.orders) }} \\{{late}} {{ {a: {b: 1}}.a.b }}.').tree!;
    expect(shape(tree.root)).toBe('Dear {{item.name}}, {{count(item.orders)}} {{late}} {{{a: {b: 1}}.a.b}}.');
    expect(parseTemplate('plain').tree!.root).toEqual({ kind: 'template', parts: ['plain'], at: [0, 5] });
    expect(parseTemplate('{{ a').problems[0].code).toBe('unclosedTemplate');
    expect(parseTemplate('{{ a b }}').problems[0].code).toBe('unexpectedToken');
    expect(parseTemplate('x {{ }}').problems[0].code).toBe('unexpectedToken');
  });
});
