import type { ExpressionFunction, FunctionParam, ParamKind, RunContext } from './expression-function';
import { ANY, BOOLEAN, NUMBER, TEXT, joinTypes, listOf, nullable, type ExpressionType } from './expression-type';
import { compare, equal, isRecord, kindOf, own, toText } from './values';

const param = (name: string, kinds: ParamKind[], more: Omit<FunctionParam, 'name' | 'kinds'> = {}): FunctionParam => ({ name, kinds, ...more });
const itemOf = (t: ExpressionType | undefined): ExpressionType => (t?.name === 'list' ? t.item : ANY);
const byItem = (args: ExpressionType[]) => [itemOf(args[0])];
const listOrAny = (t: ExpressionType | undefined): ExpressionType => (t?.name === 'list' ? nullable(t, false) : listOf(ANY));
const fixed = (t: ExpressionType) => () => t;

const LIST: ParamKind[] = ['list'];
const TEXT_KIND: ParamKind[] = ['text'];
const NUMBER_KIND: ParamKind[] = ['number'];
const LAMBDA: ParamKind[] = ['lambda'];

type Run = ExpressionFunction['run'];

/** The characters of a text, not its code units: a letter outside the first plane is one. */
const chars = (text: string) => Array.from(text);

/** A text in upper or lower case, as the culture writes it (the Turkish dotted and dotless i). */
const cased = (text: string, upper: boolean, ctx: RunContext) => (upper ? (ctx.culture ? text.toLocaleUpperCase(ctx.culture) : text.toUpperCase()) : ctx.culture ? text.toLocaleLowerCase(ctx.culture) : text.toLowerCase());

/** A whole number of an argument, or the argument's problem. */
function whole(value: unknown, name: string, ctx: RunContext): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) ctx.fail(name, value);
  return value;
}

function textOf(value: unknown, name: string, ctx: RunContext): string {
  if (typeof value !== 'string') ctx.fail(name, value);
  return value;
}

function listArg(value: unknown, name: string, ctx: RunContext): unknown[] {
  if (!Array.isArray(value)) ctx.fail(name, value);
  ctx.step(value.length);
  return value;
}

/** A short function's answer to a question: `true` alone is yes. */
const yes = (answer: unknown) => answer === true;

/** Rounds half away from zero, by decimal digits, so `round(1.005, 2)` is `1.01`. */
export function roundHalfAway(n: number, digits = 0): number {
  if (!Number.isFinite(n)) return n;
  const [mantissa, exponent] = Math.abs(n).toExponential().split('e');
  const rounded = Math.round(Number(`${mantissa}e${Number(exponent) + digits}`));
  const [m, e] = rounded.toExponential().split('e');
  return Math.sign(n) * Number(`${m}e${Number(e) - digits}`);
}

/** A function whose first argument `null` gives `null`. */
const nullsGiveNull =
  (run: Run): Run =>
  (args, ctx) =>
    args[0] === null || args[0] === undefined ? null : run(args, ctx);

const TEXT_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'len',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([t], ctx) => chars(textOf(t, 'text', ctx)).length),
    description: 'The number of characters of a text.',
    example: "len('Merhaba')",
  },
  {
    name: 'upper',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t], ctx) => cased(textOf(t, 'text', ctx), true, ctx)),
    description: 'A text in capital letters, as the culture of the evaluation writes them.',
    example: 'upper(item.city)',
  },
  {
    name: 'lower',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t], ctx) => cased(textOf(t, 'text', ctx), false, ctx)),
    description: 'A text in small letters, as the culture of the evaluation writes them.',
    example: 'lower(item.email)',
  },
  {
    name: 'trim',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t], ctx) => textOf(t, 'text', ctx).trim()),
    description: 'A text without the spaces at its start and end.',
    example: 'trim(item.name)',
  },
  {
    name: 'trimStart',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t], ctx) => textOf(t, 'text', ctx).trimStart()),
    description: 'A text without the spaces at its start.',
    example: 'trimStart(item.code)',
  },
  {
    name: 'trimEnd',
    category: 'text',
    params: [param('text', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t], ctx) => textOf(t, 'text', ctx).trimEnd()),
    description: 'A text without the spaces at its end.',
    example: 'trimEnd(item.code)',
  },
  {
    name: 'contains',
    category: 'text',
    params: [param('text', TEXT_KIND), param('part', TEXT_KIND), param('ignoreCase', ['boolean'], { optional: true })],
    returns: fixed(BOOLEAN),
    run: nullsGiveNull(([t, part, ignoreCase], ctx) => {
      const text = textOf(t, 'text', ctx);
      const p = textOf(part, 'part', ctx);
      return ignoreCase === true ? cased(text, false, ctx).includes(cased(p, false, ctx)) : text.includes(p);
    }),
    description: 'Whether a text has a part in it; with `true`, whatever the case of its letters.',
    example: "contains(item.subject, 'urgent', true)",
  },
  {
    name: 'startsWith',
    category: 'text',
    params: [param('text', TEXT_KIND), param('part', TEXT_KIND)],
    returns: fixed(BOOLEAN),
    run: nullsGiveNull(([t, part], ctx) => textOf(t, 'text', ctx).startsWith(textOf(part, 'part', ctx))),
    description: 'Whether a text starts with a part.',
    example: "startsWith(item.code, 'TR')",
  },
  {
    name: 'endsWith',
    category: 'text',
    params: [param('text', TEXT_KIND), param('part', TEXT_KIND)],
    returns: fixed(BOOLEAN),
    run: nullsGiveNull(([t, part], ctx) => textOf(t, 'text', ctx).endsWith(textOf(part, 'part', ctx))),
    description: 'Whether a text ends with a part.',
    example: "endsWith(item.email, '.com')",
  },
  {
    name: 'indexOf',
    category: 'text',
    params: [param('text', TEXT_KIND), param('part', TEXT_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([t, part], ctx) => {
      const text = textOf(t, 'text', ctx);
      const at = text.indexOf(textOf(part, 'part', ctx));
      return at < 0 ? -1 : chars(text.slice(0, at)).length;
    }),
    description: 'Where a part first stands in a text, from 0; -1 when it is not in it.',
    example: "indexOf(item.email, '@')",
  },
  {
    name: 'substring',
    category: 'text',
    params: [param('text', TEXT_KIND), param('start', NUMBER_KIND), param('length', NUMBER_KIND, { optional: true })],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, start, length], ctx) => {
      const all = chars(textOf(t, 'text', ctx));
      const from = Math.max(0, whole(start, 'start', ctx));
      const count = length === undefined || length === null ? all.length : Math.max(0, whole(length, 'length', ctx));
      return all.slice(from, from + count).join('');
    }),
    description: 'A part of a text: from a place (0 is the first character), so many characters or to its end.',
    example: 'substring(item.code, 2, 4)',
  },
  {
    name: 'replace',
    category: 'text',
    params: [param('text', TEXT_KIND), param('find', TEXT_KIND), param('with', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, find, by], ctx) => {
      const text = textOf(t, 'text', ctx);
      const f = textOf(find, 'find', ctx);
      const result = f ? text.split(f).join(textOf(by, 'with', ctx)) : text;
      ctx.checkText(result.length);
      return result;
    }),
    description: 'A text with every place of a part written as another.',
    example: "replace(item.phone, ' ', '')",
  },
  {
    name: 'split',
    category: 'text',
    params: [param('text', TEXT_KIND), param('separator', TEXT_KIND)],
    returns: fixed(listOf(TEXT)),
    run: nullsGiveNull(([t, separator], ctx) => {
      const parts = textOf(t, 'text', ctx).split(textOf(separator, 'separator', ctx));
      ctx.checkList(parts.length);
      return parts;
    }),
    description: 'The parts of a text between its separators, as a list.',
    example: "split(item.tags, ',')",
  },
  {
    name: 'join',
    category: 'text',
    params: [param('list', LIST), param('separator', TEXT_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([list, separator], ctx) => {
      const result = listArg(list, 'list', ctx)
        .map((item) => toText(item, ctx.timeZone))
        .join(textOf(separator, 'separator', ctx));
      ctx.checkText(result.length);
      return result;
    }),
    description: 'The items of a list as one text, a separator between them.',
    example: "join(map(rows, r => r.name), ', ')",
  },
  {
    name: 'padStart',
    category: 'text',
    params: [param('text', TEXT_KIND), param('length', NUMBER_KIND), param('fill', TEXT_KIND, { optional: true })],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, length, fill], ctx) => pad(textOf(t, 'text', ctx), whole(length, 'length', ctx), fill, true, ctx)),
    description: 'A text made as long as a length, a fill (a space when none is given) added before it.',
    example: "padStart(text(item.no), 6, '0')",
  },
  {
    name: 'padEnd',
    category: 'text',
    params: [param('text', TEXT_KIND), param('length', NUMBER_KIND), param('fill', TEXT_KIND, { optional: true })],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, length, fill], ctx) => pad(textOf(t, 'text', ctx), whole(length, 'length', ctx), fill, false, ctx)),
    description: 'A text made as long as a length, a fill (a space when none is given) added after it.',
    example: "padEnd(item.name, 20, '.')",
  },
  {
    name: 'repeat',
    category: 'text',
    params: [param('text', TEXT_KIND), param('count', NUMBER_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, count], ctx) => {
      const text = textOf(t, 'text', ctx);
      const n = whole(count, 'count', ctx);
      if (n < 0) ctx.fail('count', n);
      ctx.checkText(text.length * n);
      return text.repeat(n);
    }),
    description: 'A text written so many times.',
    example: "repeat('-', 10)",
  },
  {
    name: 'left',
    category: 'text',
    params: [param('text', TEXT_KIND), param('count', NUMBER_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, count], ctx) => chars(textOf(t, 'text', ctx)).slice(0, Math.max(0, whole(count, 'count', ctx))).join('')),
    description: 'The first characters of a text.',
    example: 'left(item.name, 1)',
  },
  {
    name: 'right',
    category: 'text',
    params: [param('text', TEXT_KIND), param('count', NUMBER_KIND)],
    returns: fixed(TEXT),
    run: nullsGiveNull(([t, count], ctx) => {
      const all = chars(textOf(t, 'text', ctx));
      const n = Math.max(0, whole(count, 'count', ctx));
      return n ? all.slice(-n).join('') : '';
    }),
    description: 'The last characters of a text.',
    example: 'right(item.iban, 4)',
  },
  {
    name: 'text',
    category: 'text',
    params: [param('value', ['any'])],
    returns: fixed(TEXT),
    run: ([value], ctx) => toText(value, ctx.timeZone),
    description: 'A value as text: null is empty, a day YYYY-MM-DD, a moment YYYY-MM-DD HH:MM:SS, a list or an object JSON.',
    example: "'No ' + text(item.no)",
  },
];

function pad(text: string, length: number, fill: unknown, before: boolean, ctx: RunContext): string {
  const filler = fill === undefined || fill === null ? ' ' : textOf(fill, 'fill', ctx);
  ctx.checkText(length);
  const have = chars(text).length;
  if (!filler || have >= length) return text;
  const add = chars(filler.repeat(Math.ceil((length - have) / chars(filler).length))).slice(0, length - have).join('');
  return before ? add + text : text + add;
}

function numberOf(value: unknown, name: string, ctx: RunContext): number {
  if (typeof value !== 'number') ctx.fail(name, value);
  return value;
}

/** The numbers among the arguments, `null` ones left out. */
function numbers(values: unknown[], ctx: RunContext): number[] {
  return values.filter((v) => v !== null && v !== undefined).map((v, k) => numberOf(v, `value${k + 1}`, ctx));
}

const NUMBER_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'round',
    category: 'number',
    params: [param('number', NUMBER_KIND), param('digits', NUMBER_KIND, { optional: true })],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n, digits], ctx) => roundHalfAway(numberOf(n, 'number', ctx), digits === undefined || digits === null ? 0 : whole(digits, 'digits', ctx))),
    description: 'A number rounded to so many decimal digits (none when not given), a half away from zero.',
    example: 'round(item.price * 1.2, 2)',
  },
  {
    name: 'floor',
    category: 'number',
    params: [param('number', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n], ctx) => Math.floor(numberOf(n, 'number', ctx))),
    description: 'The whole number at or below a number.',
    example: 'floor(item.hours)',
  },
  {
    name: 'ceil',
    category: 'number',
    params: [param('number', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n], ctx) => Math.ceil(numberOf(n, 'number', ctx))),
    description: 'The whole number at or above a number.',
    example: 'ceil(count(rows) / 20)',
  },
  {
    name: 'abs',
    category: 'number',
    params: [param('number', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n], ctx) => Math.abs(numberOf(n, 'number', ctx))),
    description: 'A number without its sign.',
    example: 'abs(item.balance)',
  },
  {
    name: 'min',
    category: 'number',
    params: [param('values', NUMBER_KIND, { rest: true })],
    returns: fixed(nullable(NUMBER)),
    run: (args, ctx) => {
      const found = numbers(args, ctx);
      return found.length ? Math.min(...found) : null;
    },
    description: 'The smallest of the numbers given, null ones left out.',
    example: 'min(item.stock, 10)',
  },
  {
    name: 'max',
    category: 'number',
    params: [param('values', NUMBER_KIND, { rest: true })],
    returns: fixed(nullable(NUMBER)),
    run: (args, ctx) => {
      const found = numbers(args, ctx);
      return found.length ? Math.max(...found) : null;
    },
    description: 'The largest of the numbers given, null ones left out.',
    example: 'max(item.discount, 0)',
  },
  {
    name: 'clamp',
    category: 'number',
    params: [param('number', NUMBER_KIND), param('low', NUMBER_KIND), param('high', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n, low, high], ctx) => Math.min(Math.max(numberOf(n, 'number', ctx), numberOf(low, 'low', ctx)), numberOf(high, 'high', ctx))),
    description: 'A number kept between a lowest and a highest.',
    example: 'clamp(item.score, 0, 100)',
  },
  {
    name: 'pow',
    category: 'number',
    params: [param('number', NUMBER_KIND), param('power', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n, power], ctx) => numberOf(n, 'number', ctx) ** numberOf(power, 'power', ctx)),
    description: 'A number to a power.',
    example: 'pow(1.01, 12)',
  },
  {
    name: 'sqrt',
    category: 'number',
    params: [param('number', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n], ctx) => {
      const x = numberOf(n, 'number', ctx);
      if (x < 0) ctx.fail('number', x);
      return Math.sqrt(x);
    }),
    description: 'The square root of a number that is not below zero.',
    example: 'sqrt(item.area)',
  },
  {
    name: 'sign',
    category: 'number',
    params: [param('number', NUMBER_KIND)],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([n], ctx) => Math.sign(numberOf(n, 'number', ctx)) || 0),
    description: '-1, 0 or 1, as a number is below, at or above zero.',
    example: 'sign(item.balance)',
  },
  {
    name: 'number',
    category: 'number',
    params: [param('value', ['any'])],
    returns: fixed(nullable(NUMBER)),
    run: ([value]) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'string' && /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/.test(value)) return Number(value);
      return null;
    },
    description: 'A value as a number: a text written with a point for its decimals, true 1, false 0; null for anything else.',
    example: "number(item.amount) ?? 0",
  },
];

/** The values a short function picks of a list's items, or the items themselves. */
const picked = (list: unknown[], select: unknown): unknown[] => (typeof select === 'function' ? list.map((item) => (select as (x: unknown) => unknown)(item)) : list);

/** The largest or the smallest of the values picked, `null` ones left out. */
function extreme(list: unknown[], select: unknown, sign: number, ctx: RunContext): unknown {
  let best: unknown = null;
  for (const value of picked(list, select)) {
    if (value === null || value === undefined) continue;
    if (best === null) {
      best = value;
      continue;
    }
    const order = compare(value, best, ctx.timeZone);
    if (order === undefined) ctx.fail('list', value);
    if (order !== null && order * sign > 0) best = value;
  }
  return best;
}

function sum(list: unknown[], select: unknown, ctx: RunContext): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const value of picked(list, select)) {
    if (value === null || value === undefined) continue;
    total += numberOf(value, 'list', ctx);
    count++;
  }
  return { total, count };
}

const LIST_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'count',
    category: 'list',
    params: [param('list', LIST)],
    returns: fixed(NUMBER),
    run: ([list], ctx) => (list === null || list === undefined ? 0 : listArg(list, 'list', ctx).length),
    description: 'The number of items of a list; 0 for null.',
    example: 'count(steps.orders.rows)',
  },
  {
    name: 'isEmpty',
    category: 'list',
    params: [param('value', ['list', 'text', 'object', 'any'])],
    returns: fixed(BOOLEAN),
    run: ([value]) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length) || (isRecord(value) && !Object.keys(value).length),
    description: 'Whether a list, a text or an object has nothing in it; true for null.',
    example: 'isEmpty(item.note)',
  },
  {
    name: 'first',
    category: 'list',
    params: [param('list', LIST)],
    returns: (args) => nullable(itemOf(args[0])),
    run: nullsGiveNull(([list], ctx) => listArg(list, 'list', ctx)[0] ?? null),
    description: 'The first item of a list; null when it has none.',
    example: 'first(steps.orders.rows)?.email',
  },
  {
    name: 'last',
    category: 'list',
    params: [param('list', LIST)],
    returns: (args) => nullable(itemOf(args[0])),
    run: nullsGiveNull(([list], ctx) => {
      const l = listArg(list, 'list', ctx);
      return l[l.length - 1] ?? null;
    }),
    description: 'The last item of a list; null when it has none.',
    example: 'last(sortBy(rows, r => r.at))',
  },
  {
    name: 'at',
    category: 'list',
    params: [param('list', LIST), param('index', NUMBER_KIND)],
    returns: (args) => nullable(itemOf(args[0])),
    run: nullsGiveNull(([list, index], ctx) => {
      const l = listArg(list, 'list', ctx);
      const i = whole(index, 'index', ctx);
      return l[i < 0 ? l.length + i : i] ?? null;
    }),
    description: 'The item at a place of a list, from 0; a place below zero counts from its end; null past it.',
    example: 'at(rows, -1)',
  },
  {
    name: 'sum',
    category: 'list',
    params: [param('list', LIST), param('select', LAMBDA, { optional: true, lambda: byItem })],
    returns: fixed(NUMBER),
    run: nullsGiveNull(([list, select], ctx) => sum(listArg(list, 'list', ctx), select, ctx).total),
    description: 'The sum of the numbers of a list, or of what a short function picks of its items; null ones left out.',
    example: 'sum(rows, r => r.total)',
  },
  {
    name: 'avg',
    category: 'list',
    params: [param('list', LIST), param('select', LAMBDA, { optional: true, lambda: byItem })],
    returns: fixed(nullable(NUMBER)),
    run: nullsGiveNull(([list, select], ctx) => {
      const { total, count } = sum(listArg(list, 'list', ctx), select, ctx);
      return count ? total / count : null;
    }),
    description: 'The average of the numbers of a list, or of what a short function picks; null when there is none.',
    example: 'avg(rows, r => r.total)',
  },
  {
    name: 'minOf',
    category: 'list',
    params: [param('list', LIST), param('select', LAMBDA, { optional: true, lambda: byItem })],
    returns: (args) => nullable(args[1] ?? itemOf(args[0])),
    run: nullsGiveNull(([list, select], ctx) => extreme(listArg(list, 'list', ctx), select, -1, ctx)),
    description: 'The smallest value of a list, or of what a short function picks: a number, a text, a day or a moment.',
    example: 'minOf(rows, r => r.orderedOn)',
  },
  {
    name: 'maxOf',
    category: 'list',
    params: [param('list', LIST), param('select', LAMBDA, { optional: true, lambda: byItem })],
    returns: (args) => nullable(args[1] ?? itemOf(args[0])),
    run: nullsGiveNull(([list, select], ctx) => extreme(listArg(list, 'list', ctx), select, 1, ctx)),
    description: 'The largest value of a list, or of what a short function picks: a number, a text, a day or a moment.',
    example: 'maxOf(rows, r => r.total)',
  },
  {
    name: 'filter',
    category: 'list',
    params: [param('list', LIST), param('keep', LAMBDA, { lambda: byItem })],
    returns: (args) => listOrAny(args[0]),
    run: nullsGiveNull(([list, keep], ctx) => listArg(list, 'list', ctx).filter((item) => yes((keep as (x: unknown) => unknown)(item)))),
    description: 'The items of a list a short function answers true for.',
    example: "filter(rows, r => r.status = 'late')",
  },
  {
    name: 'map',
    category: 'list',
    params: [param('list', LIST), param('make', LAMBDA, { lambda: byItem })],
    returns: (args) => listOf(args[1] ?? ANY),
    run: nullsGiveNull(([list, make], ctx) => listArg(list, 'list', ctx).map((item) => (make as (x: unknown) => unknown)(item))),
    description: 'A list of what a short function makes of each item of a list.',
    example: 'map(rows, r => r.email)',
  },
  {
    name: 'find',
    category: 'list',
    params: [param('list', LIST), param('match', LAMBDA, { lambda: byItem })],
    returns: (args) => nullable(itemOf(args[0])),
    run: nullsGiveNull(([list, match], ctx) => listArg(list, 'list', ctx).find((item) => yes((match as (x: unknown) => unknown)(item))) ?? null),
    description: 'The first item of a list a short function answers true for; null when there is none.',
    example: 'find(rows, r => r.id = vars.id)',
  },
  {
    name: 'any',
    category: 'list',
    params: [param('list', LIST), param('match', LAMBDA, { optional: true, lambda: byItem })],
    returns: fixed(BOOLEAN),
    run: ([list, match], ctx) => {
      if (list === null || list === undefined) return false;
      const l = listArg(list, 'list', ctx);
      return typeof match === 'function' ? l.some((item) => yes((match as (x: unknown) => unknown)(item))) : l.length > 0;
    },
    description: 'Whether a list has an item a short function answers true for, or any item at all.',
    example: 'any(rows, r => r.total > 1000)',
  },
  {
    name: 'all',
    category: 'list',
    params: [param('list', LIST), param('match', LAMBDA, { lambda: byItem })],
    returns: fixed(BOOLEAN),
    run: ([list, match], ctx) => {
      if (list === null || list === undefined) return true;
      return listArg(list, 'list', ctx).every((item) => yes((match as (x: unknown) => unknown)(item)));
    },
    description: 'Whether a short function answers true for every item of a list; true for an empty one.',
    example: 'all(rows, r => r.paid)',
  },
  {
    name: 'sortBy',
    category: 'list',
    params: [param('list', LIST), param('key', LAMBDA, { lambda: byItem }), param('direction', TEXT_KIND, { optional: true })],
    returns: (args) => listOrAny(args[0]),
    run: nullsGiveNull(([list, key, direction], ctx) => {
      const l = listArg(list, 'list', ctx);
      if (direction !== undefined && direction !== null && direction !== 'asc' && direction !== 'desc') ctx.fail('direction', direction);
      const sign = direction === 'desc' ? -1 : 1;
      const keyed = l.map((item, k) => ({ item, k, key: (key as (x: unknown) => unknown)(item) ?? null }));
      ctx.step(Math.ceil(l.length * Math.log2(l.length + 1)));
      keyed.sort((a, b) => {
        // Items without a key come first, last when sorted down.
        if (a.key === null || b.key === null) return ((a.key === null ? 0 : 1) - (b.key === null ? 0 : 1)) * sign || a.k - b.k;
        const order = compare(a.key, b.key, ctx.timeZone);
        if (order === undefined || order === null) return ctx.fail('key', b.key);
        return order * sign || a.k - b.k;
      });
      return keyed.map((one) => one.item);
    }),
    description: "The items of a list sorted by what a short function picks of them, 'desc' from the largest; the order of equal ones kept.",
    example: "sortBy(rows, r => r.total, 'desc')",
  },
  {
    name: 'distinct',
    category: 'list',
    params: [param('list', LIST), param('key', LAMBDA, { optional: true, lambda: byItem })],
    returns: (args) => listOrAny(args[0]),
    run: nullsGiveNull(([list, key], ctx) => {
      const l = listArg(list, 'list', ctx);
      const keys = picked(l, key);
      const kept: number[] = [];
      keys.forEach((k, at) => {
        ctx.step(kept.length);
        if (!kept.some((seen) => equal(keys[seen], k, ctx.timeZone))) kept.push(at);
      });
      return kept.map((at) => l[at]);
    }),
    description: 'The items of a list without the ones equal to one before them, or whose picked value is.',
    example: 'distinct(map(rows, r => r.city))',
  },
  {
    name: 'take',
    category: 'list',
    params: [param('list', LIST), param('count', NUMBER_KIND)],
    returns: (args) => listOrAny(args[0]),
    run: nullsGiveNull(([list, count], ctx) => listArg(list, 'list', ctx).slice(0, Math.max(0, whole(count, 'count', ctx)))),
    description: 'The first items of a list.',
    example: "take(sortBy(rows, r => r.total, 'desc'), 5)",
  },
  {
    name: 'skip',
    category: 'list',
    params: [param('list', LIST), param('count', NUMBER_KIND)],
    returns: (args) => listOrAny(args[0]),
    run: nullsGiveNull(([list, count], ctx) => listArg(list, 'list', ctx).slice(Math.max(0, whole(count, 'count', ctx)))),
    description: 'The items of a list after the first ones.',
    example: 'skip(rows, 10)',
  },
  {
    name: 'groupBy',
    category: 'list',
    params: [param('list', LIST), param('key', LAMBDA, { lambda: byItem })],
    returns: (args) => listOf({ name: 'object', fields: { key: args[1] ?? ANY, items: listOrAny(args[0]) } }),
    run: nullsGiveNull(([list, key], ctx) => {
      const groups: { key: unknown; items: unknown[] }[] = [];
      for (const item of listArg(list, 'list', ctx)) {
        const k = (key as (x: unknown) => unknown)(item) ?? null;
        ctx.step(groups.length);
        const group = groups.find((g) => equal(g.key, k, ctx.timeZone));
        if (group) group.items.push(item);
        else groups.push({ key: k, items: [item] });
      }
      return groups;
    }),
    description: 'The items of a list in groups of one picked value: a list of { key, items }, in the order the keys first come.',
    example: 'map(groupBy(rows, r => r.city), g => g.key + ": " + text(count(g.items)))',
  },
  {
    name: 'flatten',
    category: 'list',
    params: [param('list', LIST)],
    returns: (args) => {
      const inner = itemOf(args[0]);
      return listOf(inner.name === 'list' ? inner.item : ANY);
    },
    run: nullsGiveNull(([list], ctx) => {
      const flat = listArg(list, 'list', ctx).flatMap((item) => (Array.isArray(item) ? item : [item]));
      ctx.checkList(flat.length);
      return flat;
    }),
    description: 'The items of the lists in a list, as one list.',
    example: 'flatten(map(rows, r => r.lines))',
  },
  {
    name: 'concat',
    category: 'list',
    params: [param('lists', LIST, { rest: true })],
    returns: (args) => args.reduce<ExpressionType>((joined, t) => (t.name === 'null' ? joined : joinTypes(joined, nullable(t, false))), args[0] ? nullable(args[0], false) : listOf(ANY)),
    run: (args, ctx) => {
      const all = args.filter((l) => l !== null && l !== undefined).flatMap((l, k) => listArg(l, `list${k + 1}`, ctx));
      ctx.checkList(all.length);
      return all;
    },
    description: 'The items of the lists given, one list after the other; null ones left out.',
    example: 'concat(steps.a.rows, steps.b.rows)',
  },
  {
    name: 'range',
    category: 'list',
    params: [param('start', NUMBER_KIND), param('count', NUMBER_KIND)],
    returns: fixed(listOf(NUMBER)),
    run: ([start, count], ctx) => {
      const from = numberOf(start, 'start', ctx);
      const n = whole(count, 'count', ctx);
      if (n < 0) ctx.fail('count', n);
      ctx.checkList(n);
      ctx.step(n);
      return Array.from({ length: n }, (_, k) => from + k);
    },
    description: 'A list of so many numbers, one after the other, from a start.',
    example: 'range(1, 12)',
  },
];

function recordOf(value: unknown, name: string, ctx: RunContext): Record<string, unknown> {
  if (!isRecord(value)) ctx.fail(name, value);
  return value;
}

const OBJECT_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'keys',
    category: 'object',
    params: [param('object', ['object'])],
    returns: fixed(listOf(TEXT)),
    run: nullsGiveNull(([o], ctx) => Object.keys(recordOf(o, 'object', ctx))),
    description: 'The names of the fields of an object.',
    example: 'keys(steps.http.body)',
  },
  {
    name: 'values',
    category: 'object',
    params: [param('object', ['object'])],
    returns: fixed(listOf(ANY)),
    run: nullsGiveNull(([o], ctx) => Object.values(recordOf(o, 'object', ctx)).map((v) => v ?? null)),
    description: 'The values of the fields of an object.',
    example: 'values(item.totals)',
  },
  {
    name: 'get',
    category: 'object',
    params: [param('object', ['object']), param('name', TEXT_KIND)],
    returns: fixed(ANY),
    run: nullsGiveNull(([o, name], ctx) => own(recordOf(o, 'object', ctx), textOf(name, 'name', ctx))),
    description: 'The field of an object a text names; null when it has none.',
    example: 'get(item.prices, vars.currency)',
  },
  {
    name: 'has',
    category: 'object',
    params: [param('object', ['object']), param('name', TEXT_KIND)],
    returns: fixed(BOOLEAN),
    run: ([o, name], ctx) => (o === null || o === undefined ? false : Object.prototype.hasOwnProperty.call(recordOf(o, 'object', ctx), textOf(name, 'name', ctx))),
    description: 'Whether an object has a field of a name.',
    example: "has(steps.http.body, 'error')",
  },
];

/** A value as JSON: a day as YYYY-MM-DD, a moment as its time in UTC. */
const json = (value: unknown) => JSON.stringify(value ?? null);

const LOGIC_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'if',
    category: 'logic',
    params: [param('condition', ['boolean']), param('then', ['any']), param('else', ['any'])],
    returns: (args) => joinTypes(args[1] ?? ANY, args[2] ?? ANY),
    lazy: true,
    run: ([condition, then, otherwise], ctx) => {
      const c = (condition as () => unknown)();
      if (c !== null && c !== undefined && typeof c !== 'boolean') ctx.fail('condition', c);
      return c === true ? (then as () => unknown)() : (otherwise as () => unknown)();
    },
    description: 'One of two values, as a condition is true or not; only that one is worked out.',
    example: "if(item.vip, 'Değerli müşterimiz', 'Sayın müşterimiz')",
  },
  {
    name: 'coalesce',
    category: 'logic',
    params: [param('values', ['any'], { rest: true })],
    returns: (args) => args.reduce<ExpressionType>((joined, t) => joinTypes(joined, t), args[0] ?? ANY),
    lazy: true,
    run: (args) => {
      for (const value of args) {
        const v = (value as () => unknown)();
        if (v !== null && v !== undefined) return v;
      }
      return null;
    },
    description: 'The first of the values that is not null; those after it are not worked out.',
    example: 'coalesce(item.mobile, item.phone, "-")',
  },
  {
    name: 'bool',
    category: 'logic',
    params: [param('value', ['any'])],
    returns: fixed(nullable(BOOLEAN)),
    run: ([value]) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
      if (value === 1 || value === 0) return value === 1;
      return null;
    },
    description: "A value as true or false: a boolean, 'true' or 'false', 1 or 0; null for anything else.",
    example: 'bool(steps.http.body.active)',
  },
  {
    name: 'typeOf',
    category: 'logic',
    params: [param('value', ['any'])],
    returns: fixed(TEXT),
    run: ([value]) => kindOf(value),
    description: "The kind of a value: 'number', 'text', 'boolean', 'date', 'datetime', 'list', 'object' or 'null'.",
    example: "typeOf(steps.http.body) = 'list'",
  },
  {
    name: 'parseJson',
    category: 'logic',
    params: [param('text', TEXT_KIND)],
    returns: fixed(ANY),
    run: nullsGiveNull(([t], ctx) => {
      const text = textOf(t, 'text', ctx);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return ctx.fail('text', text.length > 40 ? `${text.slice(0, 40)}…` : text);
      }
    }),
    description: 'The value a JSON text writes.',
    example: 'parseJson(steps.http.text).items',
  },
  {
    name: 'toJson',
    category: 'logic',
    params: [param('value', ['any'])],
    returns: fixed(TEXT),
    run: ([value], ctx) => {
      const text = json(value);
      ctx.checkText(text.length);
      return text;
    },
    description: 'A value written as JSON.',
    example: 'toJson({ id: item.id, total: item.total })',
  },
  {
    name: 'isNull',
    category: 'logic',
    params: [param('value', ['any'])],
    returns: fixed(BOOLEAN),
    run: ([value]) => value === null || value === undefined,
    description: 'Whether a value is null.',
    example: 'isNull(item.closedAt)',
  },
];

/** The functions of the library that are not about days and moments. */
export const CORE_FUNCTIONS: ExpressionFunction[] = [...TEXT_FUNCTIONS, ...NUMBER_FUNCTIONS, ...LIST_FUNCTIONS, ...OBJECT_FUNCTIONS, ...LOGIC_FUNCTIONS];
