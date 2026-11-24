/** The types whose values have no parts. */
export type PlainTypeName = 'number' | 'text' | 'boolean' | 'date' | 'datetime' | 'null' | 'any';

/**
 * The type of a value: a plain one, a list of items of one type, or an object of named fields (`open` when it may have
 * fields not named, as a reply of a service may). `nullable` when it may be `null`.
 */
export type ExpressionType =
  | { name: PlainTypeName; nullable?: boolean }
  | { name: 'list'; item: ExpressionType; nullable?: boolean }
  | { name: 'object'; fields: Record<string, ExpressionType>; open?: boolean; nullable?: boolean };

/** The names an expression is given and their types; a type may be written as text (see `type`). */
export type ExpressionSchema = Record<string, ExpressionType | string>;

export const ANY: ExpressionType = { name: 'any' };
export const NUMBER: ExpressionType = { name: 'number' };
export const TEXT: ExpressionType = { name: 'text' };
export const BOOLEAN: ExpressionType = { name: 'boolean' };
export const DATE: ExpressionType = { name: 'date' };
export const DATETIME: ExpressionType = { name: 'datetime' };
export const NULL: ExpressionType = { name: 'null' };

export const listOf = (item: ExpressionType): ExpressionType => ({ name: 'list', item });

/** The same type, that may be `null` or may not. */
export function nullable(type: ExpressionType, may = true): ExpressionType {
  if (type.name === 'any' || type.name === 'null') return type;
  if (!!type.nullable === may) return type;
  const copy = { ...type };
  if (may) copy.nullable = true;
  else delete copy.nullable;
  return copy;
}

/**
 * A type written as text: `number`, `text`, `boolean`, `date`, `datetime`, `any`, `list<…>`, an object
 * `{ id: number, email: text }` (`{ …, * }` when it may have other fields), each followed by `?` when it may be `null`.
 * Throws on a text that is not one.
 */
export function type(text: string): ExpressionType {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError(`Not a type at ${at}: ${text}`);
  };
  const space = () => {
    while (/\s/.test(text[at] ?? '')) at++;
  };
  const word = () => {
    space();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at));
    if (!m) fail();
    at += m![0].length;
    return m![0];
  };
  const take = (c: string) => {
    space();
    if (text[at] !== c) return false;
    at++;
    return true;
  };
  const read = (): ExpressionType => {
    let found: ExpressionType;
    space();
    if (take('{')) {
      const fields: Record<string, ExpressionType> = {};
      let open = false;
      while (!take('}')) {
        if (take('*')) open = true;
        else {
          const name = word();
          if (!take(':')) fail();
          fields[name] = read();
        }
        if (!take(',') && (space(), text[at] !== '}')) fail();
      }
      found = open ? { name: 'object', fields, open } : { name: 'object', fields };
    } else {
      const name = word();
      if (name === 'list') {
        if (!take('<')) fail();
        const item = read();
        if (!take('>')) fail();
        found = listOf(item);
      } else if (['number', 'text', 'boolean', 'date', 'datetime', 'any', 'null'].includes(name)) found = { name: name as PlainTypeName };
      else found = fail();
    }
    return take('?') ? nullable(found) : found;
  };
  const result = read();
  space();
  if (at < text.length) fail();
  return result;
}

/** A type as text, as `type` reads it. */
export function typeText(t: ExpressionType): string {
  const mark = t.nullable ? '?' : '';
  if (t.name === 'list') return `list<${typeText(t.item)}>${mark}`;
  if (t.name === 'object') {
    const fields = Object.entries(t.fields).map(([name, field]) => `${name}: ${typeText(field)}`);
    if (t.open) fields.push('*');
    return `{ ${fields.join(', ')} }${mark}`;
  }
  return `${t.name}${mark}`;
}

/** A type of a schema, read from its text when it is written as one. */
export const schemaType = (given: ExpressionType | string): ExpressionType => (typeof given === 'string' ? type(given) : given);

/**
 * The type of a value that is one of two: the same type (a list of their items' type), a moment of a day and a moment,
 * the other one that may be `null` of `null` and a type, else `any`.
 */
export function joinTypes(a: ExpressionType, b: ExpressionType): ExpressionType {
  const may = !!a.nullable || !!b.nullable;
  if (a.name === 'null') return nullable(b);
  if (b.name === 'null') return nullable(a);
  if (a.name === 'any' || b.name === 'any') return ANY;
  if (a.name === 'list' && b.name === 'list') return nullable(listOf(joinTypes(a.item, b.item)), may);
  if (a.name === b.name) return nullable(a, may);
  if ((a.name === 'date' && b.name === 'datetime') || (a.name === 'datetime' && b.name === 'date')) return nullable(DATETIME, may);
  return ANY;
}
