import { describe, expect, it } from 'vitest';
import { expression } from '../src';

const { complete, signatureAt, tokens } = expression;

const schema: expression.Schema = {
  item: '{ name: text, email: text?, total: number, contact: { email: text }?, orders: list<{ total: number, status: text }> }',
  steps: '{ orders: { rows: list<{ id: number, status: text, total: number }> } }',
  rows: 'list<{ name: text, total: number }>',
};

/** The pieces of a text as `kind:text`. */
const read = (source: string, template = false) => tokens(source, { template }).map((t) => `${t.kind}:${source.slice(t.at[0], t.at[1])}`);

/** The labels offered where `|` stands in the text. */
function offered(marked: string, template = false): string[] | null {
  const at = marked.indexOf('|');
  const found = complete(marked.replace('|', ''), at, schema, { template });
  return found && found.items.map((item) => item.label);
}

describe('expression, pieces of its text', () => {
  it('tells names, functions, fields, words and marks apart', () => {
    expect(read("sum(rows, r => r.total) > 10 and item?.in = 'a' ? #2026-01-31# : null")).toEqual([
      'function:sum',
      'punct:(',
      'name:rows',
      'punct:,',
      'name:r',
      'operator:=>',
      'name:r',
      'punct:.',
      'field:total',
      'punct:)',
      'operator:>',
      'number:10',
      'keyword:and',
      'name:item',
      'punct:?.',
      'field:in',
      'operator:=',
      "text:'a'",
      'operator:?',
      'date:#2026-01-31#',
      'operator::',
      'constant:null',
    ]);
  });

  it('keeps going past what does not read', () => {
    expect(read("a @ 'x\\q' + 12ab + #2026-13-01# + 'open")).toEqual([
      'name:a',
      'error:@',
      "text:'x\\q'",
      'operator:+',
      'number:12ab',
      'operator:+',
      'date:#2026-13-01#',
      'operator:+',
      "text:'open",
    ]);
  });

  it('reads a template: its plain text, its marks and the expressions between them', () => {
    expect(read('Dear {{ item.name }}, \\{{ not }} {{ { a: 1 }.a }}{{ x', true)).toEqual([
      'template:Dear ',
      'mark:{{',
      'name:item',
      'punct:.',
      'field:name',
      'mark:}}',
      'template:, \\{{ not }} ',
      'mark:{{',
      'punct:{',
      'name:a',
      'operator::',
      'number:1',
      'punct:}',
      'punct:.',
      'field:a',
      'mark:}}',
      'mark:{{',
      'name:x',
    ]);
  });
});

describe('expression, words for the caret', () => {
  it('offers the fields of the value before a dot, through lists and short functions', () => {
    expect(offered('item.|')).toEqual(['name', 'email', 'total', 'contact', 'orders']);
    expect(offered('item.contact?.|')).toEqual(['email']);
    expect(offered('item.to|')).toEqual(['total']);
    expect(offered('steps.orders.rows[0].|')).toEqual(['id', 'status', 'total']);
    expect(offered("count(filter(steps.orders.rows, r => r.|")).toEqual(['id', 'status', 'total']);
    expect(offered('sum(item.orders, o => o.t|) > 3')).toEqual(['total', 'status']);
    expect(offered('(item.total > 1 ? item : item).|')).toEqual(['name', 'email', 'total', 'contact', 'orders']);
    expect(offered('item.total.|')).toEqual([]);
  });

  it('offers the names known there, the functions and the words that start a value', () => {
    const all = offered('|')!;
    expect(all.slice(0, 3)).toEqual(['item', 'steps', 'rows']);
    expect(all).toContain('sum');
    expect(all).toContain('formatDate');
    expect(all.slice(-4)).toEqual(['not', 'true', 'false', 'null']);
    expect(offered('map(rows, row => ro|')!.slice(0, 3)).toEqual(['row', 'rows', 'round']);
    expect(offered('item.total > 1 ? su|')).toContain('sum');
  });

  it('offers the words that join a value to the next after one', () => {
    expect(offered('item.total |')).toEqual(['and', 'or', 'in', 'not']);
    expect(offered("count(rows) a|")).toEqual(['and']);
    expect(offered("count(rows) o|")).toEqual(['or', 'not']);
  });

  it('offers nothing in a text, a number, at a key of an object or in a template text', () => {
    expect(offered("'ab|c'")).toBeNull();
    expect(offered("'ab|")).toBeNull();
    expect(offered('12|')).toBeNull();
    expect(offered('{ a|')).toBeNull();
    expect(offered('Dear |', true)).toBeNull();
    expect(offered('Dear {{ item.n| }}', true)).toEqual(['name', 'contact']);
    expect(offered('{{ x }} after |', true)).toBeNull();
  });

  it('spans the whole word at the caret', () => {
    expect(complete('item.tot + 1', 7, schema)!.at).toEqual([5, 8]);
    expect(complete('item. + 1', 5, schema)!.at).toEqual([5, 5]);
  });
});

describe('expression, the call at the caret', () => {
  const at = (marked: string, template = false) => {
    const found = signatureAt(marked.replace('|', ''), marked.indexOf('|'), { template });
    return found && `${found.name}#${found.argument}${found.fn ? '' : '?'}`;
  };

  it('finds the innermost call and the argument', () => {
    expect(at('sum(|')).toBe('sum#0');
    expect(at('sum(rows, |')).toBe('sum#1');
    expect(at('sum(rows, r => max([1, 2|')).toBe('max#0');
    expect(at('sum(rows, r => max([1, 2], |')).toBe('max#1');
    expect(at("formatDate(today(), 'dd, |")).toBe('formatDate#1');
    expect(at('sum(rows)|')).toBeNull();
    expect(at('nothing(1, |')).toBe('nothing#1?');
    expect(at('a {{ len(|', true)).toBe('len#0');
  });
});
