import { describe, expect, it } from 'vitest';
import { expression } from '../src';

const { Day, ExpressionError, run, render } = expression;

/** A moment the tests are evaluated at: 2026-03-10 09:00 in Istanbul. */
const options: expression.EvaluateOptions = { now: new Date('2026-03-10T06:00:00Z'), timeZone: 'Europe/Istanbul' };

const rows = [
  { id: 1, name: 'Ada', email: 'ada@example.com', total: 120, status: 'late', dueOn: '2026-03-01' },
  { id: 2, name: 'Can', email: null, total: 80, status: 'open', dueOn: '2026-03-20' },
  { id: 3, name: 'Ece', email: 'ece@example.com', total: 300, status: 'late', dueOn: '2026-02-20' },
];
const names = {
  steps: { orders: { rows } },
  rows,
  item: { name: 'Ada', email: null, total: 42, contact: { email: 'ada@example.com' }, orders: [{ total: 10 }, { total: 20 }], dueOn: '2026-03-01' },
  nobody: null,
};

const value = (text: string) => run(text, names, options);

/** The problem an expression stops with: its code and where. */
function stops(text: string, more: expression.EvaluateOptions = {}) {
  try {
    run(text, names, { ...options, ...more });
  } catch (e) {
    expect(e).toBeInstanceOf(ExpressionError);
    const err = e as InstanceType<typeof ExpressionError>;
    return `${err.code}@${err.at[0]}`;
  }
  throw new Error(`${text} did not stop`);
}

describe('expression, working out', () => {
  it('counts, compares and joins', () => {
    expect(value('1 + 2 * 3 - 4 / 2 % 3')).toBe(5);
    expect(value("'a' + 1 + 2")).toBe('a12');
    expect(value("1 + 2 + 'a'")).toBe('3a');
    expect(value('item.total >= 42 and item.total < 43')).toBe(true);
    expect(value("'b' > 'a'")).toBe(true);
    expect(value('[1, 2] = [1, 2] and { a: 1 } = { a: 1 }')).toBe(true);
    expect(value('2 in [1, 2] and 3 not in [1, 2]')).toBe(true);
    expect(value('not (1 > 2) && !false || false')).toBe(true);
    expect(value('item.total > 40 ? "big" : "small"')).toBe('big');
  });

  it('gives null where a value is missing, and treats it so in conditions', () => {
    expect(value('1 + null')).toBeNull();
    expect(value("'a' + null")).toBe('a');
    expect(value('null < 1')).toBeNull();
    expect(value('null = null and item.email = null and 1 != null')).toBe(true);
    expect(value('null and true')).toBe(false);
    expect(value('null or true')).toBe(true);
    expect(value('null ? 1 : 2')).toBe(2);
    expect(value('item.email ?? item.contact?.email ?? "support@example.com"')).toBe('ada@example.com');
    expect(value('nobody?.name')).toBeNull();
    expect(value('nobody?.[0]')).toBeNull();
    expect(value('item.missing')).toBeNull();
    expect(value('rows[10]')).toBeNull();
  });

  it('stops on a field of null without ?., a division by zero and values that do not go together', () => {
    expect(stops('nobody.name')).toBe('nullPath@0');
    expect(stops('item.total / 0')).toBe('divideByZero@0');
    expect(stops('5 % 0')).toBe('divideByZero@0');
    expect(stops("'a' - 1")).toBe('typeMismatch@0');
    expect(stops('1 < "a"')).toBe('typeMismatch@0');
    expect(stops('1 and true')).toBe('typeMismatch@0');
    expect(stops('1 in 2')).toBe('typeMismatch@0');
    expect(stops('rows.name')).toBe('notAnObject@0');
    expect(stops('unknown + 1')).toBe('unknownName@0');
    expect(stops('len(5)')).toBe('badArgument@0');
    try {
      run('item.contact.email + nobody.name', names, options);
    } catch (e) {
      expect((e as Error).message).toBe('nobody is null: write ?. to give null then.');
    }
  });

  it('works out only the side it needs', () => {
    expect(value('false and 1 / 0 > 1')).toBe(false);
    expect(value('true or 1 / 0 > 1')).toBe(true);
    expect(value('1 ?? 1 / 0')).toBe(1);
    expect(value('true ? 1 : 1 / 0')).toBe(1);
    expect(value('if(false, 1 / 0, 2)')).toBe(2);
    expect(value('coalesce(null, 3, 1 / 0)')).toBe(3);
  });

  it('reads only the fields of the values themselves, nothing they inherit', () => {
    expect(value('item.constructor')).toBeNull();
    expect(value("item['__proto__']")).toBeNull();
    expect(value("get(item, 'toString')")).toBeNull();
    expect(value("has(item, 'hasOwnProperty')")).toBe(false);
  });

  it('reads days and moments, and compares them with texts that are ones', () => {
    expect(value('#2026-01-31#')).toEqual(new Day(2026, 1, 31));
    expect((value('#2026-01-31 09:30#') as Date).toISOString()).toBe('2026-01-31T06:30:00.000Z');
    expect((value('#2026-01-31T09:30:00Z#') as Date).toISOString()).toBe('2026-01-31T09:30:00.000Z');
    expect(value('#2026-01-31# < #2026-02-01#')).toBe(true);
    expect(value("item.dueOn < #2026-03-02# and item.dueOn = #2026-03-01#")).toBe(true);
    expect(value('#2026-01-31# < #2026-01-31 00:01#')).toBe(true);
  });

  it('keeps within its limits', () => {
    expect(stops('range(0, 200001)')).toBe('listLimit@0');
    expect(stops('map(range(1, 1000), x => map(range(1, 1000), y => y))', { limits: { steps: 10_000 } })).toMatch(/^stepLimit@/);
    expect(stops("repeat('ab', 600000)")).toBe('textLimit@0');
    expect(stops('((((((((((1))))))))))'.replace(/\(/g, '[').replace(/\)/g, ']'), { limits: { depth: 5 } })).toMatch(/^depthLimit@/);
  });

  it('writes a template, its expressions as text', () => {
    expect(render('Sayın {{ item.name }}, {{ count(item.orders) }} siparişiniz gecikti.', names, options)).toBe('Sayın Ada, 2 siparişiniz gecikti.');
    expect(render('{{ item.email }}|{{ #2026-01-31# }}|{{ [1, 2] }}|{{ 1.5 }}|{{ true }}', names, options)).toBe('|2026-01-31|[1,2]|1.5|true');
    expect(() => render('{{ item.', names, options)).toThrow(ExpressionError);
  });

  it('works out the examples of the specification', () => {
    expect(value("count(filter(steps.orders.rows, r => r.status = 'late')) > 0")).toBe(true);
    expect(value('sum(steps.orders.rows, r => r.total) * 1.2')).toBe(600);
    expect(value("item.email ?? item.contact?.email ?? 'destek@ornek.com'")).toBe('ada@example.com');
    expect(value("diffDays(item.dueOn, today()) > 3 ? 'gecikti' : 'yolda'")).toBe('gecikti');
    expect(value("join(map(take(sortBy(rows, r => r.total, 'desc'), 5), r => r.name), ', ')")).toBe('Ece, Ada, Can');
    expect(value("formatDate(addDays(today(), 1), 'dd MMMM yyyy', 'tr-TR')")).toBe('11 Mart 2026');
    expect(render('Sayın {{ item.name }}, {{ count(item.orders) }} siparişiniz gecikti.', names, options)).toBe('Sayın Ada, 2 siparişiniz gecikti.');
  });
});
