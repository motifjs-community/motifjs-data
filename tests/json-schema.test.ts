import { describe, expect, it } from 'vitest';
import { jsonSchema } from '../src';

const { check, defaults, matchesFormat, validate } = jsonSchema;

const settings: jsonSchema.JsonSchema = {
  type: 'object',
  title: 'Send an email',
  required: ['account', 'to', 'subject'],
  properties: {
    account: { type: 'string', title: 'Account', minLength: 1 },
    to: { type: 'array', title: 'To', items: { type: 'string', format: 'email' } },
    subject: { type: 'string', title: 'Subject', maxLength: 20, 'x-editor': 'template' },
    priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
    retries: { type: 'integer', minimum: 0, maximum: 5, default: 1 },
    code: { type: 'string', pattern: '^[A-Z]{2}\\d+$' },
    kind: { const: 'email' },
    sendOn: { type: ['string', 'null'], format: 'date' },
    site: { type: 'string', format: 'uri' },
    address: {
      type: 'object',
      required: ['city'],
      properties: { city: { type: 'string' }, zip: { type: 'string', default: '34000' } },
    },
    note: { type: 'object', properties: { text: { type: 'string' } } },
  },
};

/** The problems of a value as `code@path`. */
const problems = (value: unknown, schema: jsonSchema.JsonSchema = settings) => validate(schema, value).problems.map((p) => `${p.code}@${p.path.join('.')}`);

describe('JSON schema, values', () => {
  it('passes a value that fits', () => {
    const value = { account: 'sales', to: ['ada@example.com'], subject: 'Late orders', priority: 'high', retries: 2, code: 'TR42', kind: 'email', sendOn: null, site: 'mailto:ada@example.com', address: { city: 'İzmir' } };
    expect(validate(settings, value)).toEqual({ valid: true, problems: [] });
  });

  it('finds every problem, each where it is, with its text', () => {
    const value = {
      to: ['ada@example.com', 'not an address'],
      subject: 'A subject that is much too long',
      priority: 'urgent',
      retries: 7.5,
      code: 'tr42',
      kind: 'sms',
      sendOn: '2026-02-30',
      site: 'no scheme',
      address: {},
    };
    expect(problems(value)).toEqual([
      'required@account',
      'format@to.1',
      'maxLength@subject',
      'enum@priority',
      'type@retries',
      'pattern@code',
      'const@kind',
      'format@sendOn',
      'format@site',
      'required@address.city',
    ]);
    const texts = validate(settings, value).problems.map((p) => p.message);
    expect(texts).toContain('account is required.');
    expect(texts).toContain('The text is longer than 20 characters.');
    expect(texts).toContain("The value is not one of 'low', 'normal', 'high'.");
    expect(texts).toContain('The value is number; integer is wanted.');
    expect(texts).toContain("The value must be 'email'.");
    expect(texts).toContain('The text is not in the date format.');
  });

  it('reads the bounds, the type and a missing value as the subset says', () => {
    expect(problems({ zip: '1' }, settings.properties!.address)).toEqual(['required@city']);
    expect(problems(-1, { type: 'integer', minimum: 0 })).toEqual(['minimum@']);
    expect(problems(6, { maximum: 5 })).toEqual(['maximum@']);
    expect(problems('five', { minimum: 5 })).toEqual([]);
    expect(problems(null, { type: 'string' })).toEqual(['type@']);
    expect(problems(undefined, { type: 'string' })).toEqual(['type@']);
    expect(problems({ account: null, to: [], subject: '' })).toEqual(['type@account']);
    // Characters, not the units they are stored in.
    expect(problems('😀😀', { maxLength: 2 })).toEqual([]);
    expect(problems([1, 'a'], { type: 'array', items: { type: 'number' } })).toEqual(['type@1']);
    expect(problems({ a: [1, { b: 2 }] }, { const: { a: [1, { b: 2 }] } })).toEqual([]);
  });

  it('knows the formats', () => {
    expect(matchesFormat('date', '2024-02-29')).toBe(true);
    expect(matchesFormat('date', '2026-02-29')).toBe(false);
    expect(matchesFormat('date-time', '2026-01-31T09:30:00Z')).toBe(true);
    expect(matchesFormat('date-time', '2026-01-31T09:30:00.250+03:00')).toBe(true);
    expect(matchesFormat('date-time', '2026-01-31T09:30:00')).toBe(false);
    expect(matchesFormat('date-time', '2026-01-31T24:00:00Z')).toBe(false);
    expect(matchesFormat('email', 'ada@example.com')).toBe(true);
    expect(matchesFormat('email', 'ada@example')).toBe(false);
    expect(matchesFormat('uri', 'https://example.com/a?b=1')).toBe(true);
    expect(matchesFormat('uri', '/relative/path')).toBe(false);
  });
});

describe('JSON schema, the schema itself', () => {
  it('reports what it does not read, and what is not written as it should be', () => {
    const found = check({
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: 'text' as 'string', minLength: -1, 'x-editor': 'expression' },
        b: { oneOf: [] } as jsonSchema.JsonSchema,
        c: { type: 'array', items: { pattern: '(' } },
      },
    } as jsonSchema.JsonSchema);
    expect(found.map((p) => `${p.code}@${p.path.join('.')}`)).toEqual([
      'unsupportedKeyword@additionalProperties',
      'badKeyword@properties.a.type',
      'badKeyword@properties.a.minLength',
      'unsupportedKeyword@properties.b.oneOf',
      'badKeyword@properties.c.items.pattern',
    ]);
    expect(found[0].message).toBe('additionalProperties is not read; the value is not checked against it.');
    expect(found[2].message).toBe('minLength should be a whole number, 0 or more.');
    expect(check(settings)).toEqual([]);
  });
});

describe('JSON schema, the value it starts with', () => {
  it('takes the defaults and the constants, an object field only when it has one', () => {
    expect(defaults(settings)).toEqual({ priority: 'normal', retries: 1, kind: 'email', address: { zip: '34000' } });
    expect(defaults({ type: 'string' })).toBeUndefined();
    expect(defaults({ type: 'object', properties: { a: { type: 'string' } } })).toEqual({});
    const list = { default: [1, 2] };
    expect(defaults(list)).not.toBe(list.default);
  });
});
