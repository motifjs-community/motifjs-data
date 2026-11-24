import { describe, expect, it } from 'vitest';
import { expression } from '../src';

const { run, ExpressionError } = expression;

const options: expression.EvaluateOptions = { now: new Date('2026-03-10T06:00:00Z'), timeZone: 'Europe/Istanbul' };
const rows = [
  { name: 'Ada', city: 'Ankara', total: 120 },
  { name: 'Can', city: 'İzmir', total: null },
  { name: 'Ece', city: 'Ankara', total: 300 },
];
const value = (text: string, culture?: string) => run(text, { rows, o: { a: 1, b: 'x' } }, { ...options, culture });
const fails = (text: string) => {
  try {
    value(text);
  } catch (e) {
    expect(e).toBeInstanceOf(ExpressionError);
    return (e as InstanceType<typeof ExpressionError>).code;
  }
  throw new Error(`${text} did not fail`);
};

describe('expression, the functions of texts', () => {
  it('measure, change case, trim and look into texts', () => {
    expect(value("len('Merhaba😀')")).toBe(8);
    expect(value("upper('istanbul')")).toBe('ISTANBUL');
    expect(value("upper('istanbul')", 'tr-TR')).toBe('İSTANBUL');
    expect(value("lower('IŞIK')", 'tr-TR')).toBe('ışık');
    expect(value("trim('  a  ') + '|' + trimStart('  a ') + '|' + trimEnd(' a  ')")).toBe('a|a | a');
    expect(value("contains('Hello', 'ell') and not contains('Hello', 'ELL') and contains('Hello', 'ELL', true)")).toBe(true);
    expect(value("startsWith('TR12', 'TR') and endsWith('a.com', '.com')")).toBe(true);
    expect(value("indexOf('😀ab', 'b')")).toBe(2);
    expect(value("indexOf('ab', 'z')")).toBe(-1);
    expect(value("len(null) = null and upper(null) = null")).toBe(true);
  });

  it('cut, replace, split, join, pad and repeat', () => {
    expect(value("substring('abcdef', 2, 3)")).toBe('cde');
    expect(value("substring('abcdef', 4)")).toBe('ef');
    expect(value("replace('a-b-c', '-', '+')")).toBe('a+b+c');
    expect(value("split('a,b,,c', ',')")).toEqual(['a', 'b', '', 'c']);
    expect(value("join([1, null, 'x', #2026-01-02#], '/')")).toBe('1//x/2026-01-02');
    expect(value("padStart('7', 3, '0') + padEnd('ab', 5, '.') + padStart('abc', 2)")).toBe('007ab...abc');
    expect(value("repeat('ab', 3)")).toBe('ababab');
    expect(value("left('Ankara', 3) + right('Ankara', 2) + right('x', 0)")).toBe('Ankra');
    expect(value("text(1.5) + text(true) + text(null) + text([1]) + text({ a: 1 })")).toBe('1.5true[1]{"a":1}');
    expect(fails("repeat('a', -1)")).toBe('badArgument');
    expect(fails("substring('a', 1.5)")).toBe('badArgument');
  });
});

describe('expression, the functions of numbers', () => {
  it('round half away from zero, and work numbers out', () => {
    expect(value('round(1.005, 2)')).toBe(1.01);
    expect(value('round(-2.5)')).toBe(-3);
    expect(value('round(1234.5678, -2)')).toBe(1200);
    expect(value('[floor(1.7), ceil(1.2), abs(-3), sign(-2), sign(0), pow(2, 10), sqrt(81)]')).toEqual([1, 2, 3, -1, 0, 1024, 9]);
    expect(value('[min(3, null, 1), max(3, 7), min(), clamp(120, 0, 100)]')).toEqual([1, 7, null, 100]);
    expect(value("[number('12.5'), number(' -3 '), number('1e3'), number('12,5'), number(true), number(null)]")).toEqual([12.5, -3, 1000, null, 1, null]);
    expect(fails('sqrt(-1)')).toBe('badArgument');
    expect(fails("abs('a')")).toBe('badArgument');
  });
});

describe('expression, the functions of lists', () => {
  it('count, pick and sum', () => {
    expect(value('[count(rows), count(null), count([])]')).toEqual([3, 0, 0]);
    expect(value("[isEmpty([]), isEmpty(''), isEmpty(null), isEmpty({}), isEmpty([0])]")).toEqual([true, true, true, true, false]);
    expect(value('[first(rows).name, last(rows).name, at(rows, 1).name, at(rows, -1).name, at(rows, 9), first([])]')).toEqual(['Ada', 'Ece', 'Can', 'Ece', null, null]);
    expect(value('[sum(rows, r => r.total), avg(rows, r => r.total), sum([1, 2, 3]), avg([]), sum([])]')).toEqual([420, 210, 6, null, 0]);
    expect(value('[minOf(rows, r => r.total), maxOf(rows, r => r.name), minOf([#2026-02-01#, #2026-01-01#]), maxOf([])]')).toEqual([120, 'Ece', new expression.Day(2026, 1, 1), null]);
  });

  it('filter, map, find, ask and sort', () => {
    expect(value("map(filter(rows, r => r.city = 'Ankara'), r => r.name)")).toEqual(['Ada', 'Ece']);
    expect(value('find(rows, r => r.total > 200).name')).toBe('Ece');
    expect(value('find(rows, r => r.total > 999)')).toBeNull();
    expect(value('[any(rows, r => r.total = null), any([]), any([1]), all(rows, r => r.name != null), all([], r => false), any(null), all(null, r => false)]')).toEqual([true, false, true, true, true, false, true]);
    expect(value('map(sortBy(rows, r => r.total), r => r.name)')).toEqual(['Can', 'Ada', 'Ece']);
    expect(value("map(sortBy(rows, r => r.total, 'desc'), r => r.name)")).toEqual(['Ece', 'Ada', 'Can']);
    expect(value("map(sortBy(rows, r => r.city), r => r.name)")).toEqual(['Ada', 'Ece', 'Can']);
    expect(fails("sortBy(rows, r => r.total, 'up')")).toBe('badArgument');
  });

  it('keep the distinct, take, skip, group, flatten, join lists and count up', () => {
    expect(value('distinct([1, 2, 1, 3, 2])')).toEqual([1, 2, 3]);
    expect(value('map(distinct(rows, r => r.city), r => r.name)')).toEqual(['Ada', 'Can']);
    expect(value('[take([1, 2, 3], 2), skip([1, 2, 3], 2), take([1], 5)]')).toEqual([[1, 2], [3], [1]]);
    expect(value('map(groupBy(rows, r => r.city), g => g.key + ":" + text(count(g.items)))')).toEqual(['Ankara:2', 'İzmir:1']);
    expect(value('flatten([[1, 2], 3, [[4]]])')).toEqual([1, 2, 3, [4]]);
    expect(value('concat([1], null, [2, 3])')).toEqual([1, 2, 3]);
    expect(value('range(5, 3)')).toEqual([5, 6, 7]);
  });
});

describe('expression, the functions of objects and logic', () => {
  it('read the fields of an object', () => {
    expect(value("[keys(o), values(o), get(o, 'b'), get(o, 'z'), has(o, 'a'), has(o, 'z'), has(null, 'a')]")).toEqual([['a', 'b'], [1, 'x'], 'x', null, true, false, false]);
  });

  it('choose, convert and write JSON', () => {
    expect(value("[if(1 > 2, 'a', 'b'), if(null, 1, 2), coalesce(null, null), coalesce(null, 'x', 'y')]")).toEqual(['b', 2, null, 'x']);
    expect(value("[bool('TRUE'), bool(0), bool('yes'), bool(null)]")).toEqual([true, false, null, null]);
    expect(value("map([1, 'a', true, null, [], {}, #2026-01-01#, #2026-01-01 10:00#], x => typeOf(x))")).toEqual(['number', 'text', 'boolean', 'null', 'list', 'object', 'date', 'datetime']);
    expect(value("parseJson('{\"a\": [1, 2]}').a[1]")).toBe(2);
    expect(value("toJson({ d: #2026-01-02#, n: null, l: [1] })")).toBe('{"d":"2026-01-02","n":null,"l":[1]}');
    expect(value('[isNull(null), isNull(0)]')).toEqual([true, false]);
    expect(fails("parseJson('{x')")).toBe('badArgument');
    expect(fails("if(1, 'a', 'b')")).toBe('badArgument');
  });
});

describe('expression, the library', () => {
  it('has the 84 functions of the specification, each with a description and an example that reads and checks', () => {
    expect(expression.functions).toHaveLength(84);
    expect(new Set(expression.functions.map((fn) => fn.name)).size).toBe(84);
    const counts: Record<string, number> = {};
    for (const fn of expression.functions) counts[fn.category] = (counts[fn.category] ?? 0) + 1;
    expect(counts).toEqual({ text: 21, number: 11, list: 22, object: 4, date: 19, logic: 7 });
    const schema = { item: 'any', rows: 'any', steps: 'any', vars: 'any' };
    for (const fn of expression.functions) {
      expect(fn.description.length, fn.name).toBeGreaterThan(10);
      const tree = expression.parse(fn.example).tree ?? expression.parseTemplate(fn.example).tree;
      expect(tree, `${fn.name}: ${fn.example}`).not.toBeNull();
      const errors = expression.check(tree!, schema).problems.filter((p) => p.severity === 'error');
      expect(errors.map((p) => p.message), `${fn.name}: ${fn.example}`).toEqual([]);
      expect(fn.example, fn.name).toContain(`${fn.name}(`);
    }
  });
});
