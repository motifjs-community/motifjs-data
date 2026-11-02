/** `name=value&…` with `%20` for spaces; `$ , / : @` stay readable (`$orderby=name desc,date`). */
export function queryString(query: URLSearchParams): string {
  const parts: string[] = [];
  query.forEach((value, name) => parts.push(`${encode(name)}=${encode(value)}`));
  return parts.join('&');
}

function encode(text: string): string {
  return encodeURIComponent(text).replace(/%(24|2C|2F|3A|40)/g, (match) => decodeURIComponent(match));
}
