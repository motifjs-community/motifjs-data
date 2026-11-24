import { describe, expect, it } from 'vitest';
import { expression } from '../src';

const schema: expression.Schema = {
  steps: '{ orders: { rows: list<{ id: number, email: text?, total: number, status: text, dueOn: date, name: text }> } }',
  item: '{ name: text, email: text?, total: number, contact: { email: text }?, orders: list<{ total: number }> }',
  vars: '{ count: number, * }',
  body: 'any',
};

/** The type of an expression as text, and its problems as `code@start` (warnings marked with `!`). */
function checked(text: string, options: expression.CheckOptions = {}) {
  const tree = expression.parse(text).tree;
  if (!tree) throw new Error(expression.parse(text).problems[0].message);
  const result = expression.check(tree, schema, options);
  return { type: expression.typeText(result.type), problems: result.problems.map((p) => `${p.severity === 'warning' ? '!' : ''}${p.code}@${p.at[0]}`) };
}

describe('expression, checking', () => {
  it('works out the type of an expression from the schema and the functions', () => {
    expect(checked('count(steps.orders.rows) > 0')).toEqual({ type: 'boolean', problems: [] });
    expect(checked('map(steps.orders.rows, r => r.email)')).toEqual({ type: 'list<text?>', problems: [] });
    expect(checked('sum(steps.orders.rows, r => r.total) * 1.2')).toEqual({ type: 'number', problems: [] });
    expect(checked("filter(steps.orders.rows, r => r.status = 'late')").type).toBe('list<{ id: number, email: text?, total: number, status: text, dueOn: date, name: text }>');
    expect(checked('groupBy(steps.orders.rows, r => r.status)').type).toBe('list<{ key: text, items: list<{ id: number, email: text?, total: number, status: text, dueOn: date, name: text }> }>');
    expect(checked("item.email ?? item.contact?.email ?? 'support@example.com'")).toEqual({ type: 'text', problems: [] });
    expect(checked('item.total > 10 ? item.name : null')).toEqual({ type: 'text?', problems: [] });
    expect(checked('[1, 2, null]').type).toBe('list<number?>');
    expect(checked("{ a: 1, b: 'x' }").type).toBe('{ a: number, b: text }');
    expect(checked('vars.anything + 1')).toEqual({ type: 'any', problems: [] });
    expect(checked('body.x[0].y')).toEqual({ type: 'any', problems: [] });
    expect(checked('#2026-01-31# < #2026-02-01 10:00#')).toEqual({ type: 'boolean', problems: [] });
  });

  it('warns of a field read from a value that may be null, unless with ?.', () => {
    expect(checked('item.contact.email')).toEqual({ type: 'text?', problems: ['!mayBeNull@0'] });
    expect(checked('item.contact?.email')).toEqual({ type: 'text?', problems: [] });
    expect(checked('first(steps.orders.rows).email').problems).toEqual(['!mayBeNull@0']);
    expect(checked('first(steps.orders.rows)?.email').problems).toEqual([]);
  });

  it('finds names, fields and functions that are not there', () => {
    expect(checked('nobody + 1').problems).toEqual(['unknownName@0']);
    expect(checked('item.nope').problems).toEqual(['unknownField@5']);
    expect(checked('nofn(1)').problems).toEqual(['unknownFunction@0']);
    expect(checked('item.name.length').problems).toEqual(['notAnObject@0']);
    const result = expression.check(expression.parse('item.nope').tree!, schema);
    expect(result.problems[0].message).toBe('{ name: text, email: text?, total: number, contact: { email: text }?, orders: list<{ total: number }> } has no field nope.');
  });

  it('finds arguments of the wrong number or kind, and operators of the wrong values', () => {
    expect(checked('len()').problems).toEqual(['argumentCount@0']);
    expect(checked("substring('a', 1, 2, 3)").problems).toEqual(['argumentCount@0']);
    expect(checked('len(1)').problems).toEqual(['argumentType@4']);
    expect(checked('len(x => x)').problems).toEqual(['argumentType@4']);
    expect(checked('filter(steps.orders.rows, 1)').problems).toEqual(['argumentType@26']);
    expect(checked("'a' - 1").problems).toEqual(['operandType@0']);
    expect(checked('item.name and true').problems).toEqual(['operandType@0']);
    expect(checked('1 in 2').problems).toEqual(['notAList@5']);
    expect(checked('item.name[0]').problems).toEqual(['notAList@0']);
    const [found] = expression.check(expression.parse('len(1)').tree!, schema).problems;
    expect(found.message).toBe('The argument text of len is text, not number.');
    expect(checked("diffDays(item.name, '2026-01-01')").problems).toEqual([]);
  });

  it('wants the type a place asks for', () => {
    expect(checked('item.total', { expect: 'boolean' }).problems).toEqual(['resultType@0']);
    expect(checked('item.total > 1', { expect: 'boolean' }).problems).toEqual([]);
    expect(checked('item.contact?.email', { expect: 'text' }).problems).toEqual([]);
  });

  it('knows the functions an application adds', () => {
    const shout: expression.Function = {
      name: 'shout',
      category: 'text',
      params: [{ name: 'text', kinds: ['text'] }],
      returns: () => ({ name: 'text' }),
      run: ([t]) => `${String(t)}!`,
      description: 'A text with an exclamation mark.',
      example: "shout('hi')",
    };
    const tree = expression.parse('shout(item.name)').tree!;
    expect(expression.check(tree, schema, { functions: [shout] }).problems).toEqual([]);
    expect(expression.evaluate(tree, { item: { name: 'Ada' } }, { functions: [shout] })).toBe('Ada!');
  });
});

describe('expression, types written as text', () => {
  it('reads and writes types', () => {
    for (const text of ['number', 'text?', 'list<date>', 'list<{ id: number, tags: list<text>? }>?', '{ a: any, * }']) {
      expect(expression.typeText(expression.type(text))).toBe(text);
    }
    expect(expression.type('{ id: number, }')).toEqual({ name: 'object', fields: { id: { name: 'number' } } });
    expect(() => expression.type('list<')).toThrow(SyntaxError);
    expect(() => expression.type('money')).toThrow(SyntaxError);
  });
});
