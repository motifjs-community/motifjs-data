import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';

export function defaultLoadQuery(options: LoadOptions): Record<string, string | number | boolean | undefined> {
  return {
    skip: options.skip,
    take: options.take,
    count: options.count || undefined,
    sort: options.sort?.length ? options.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',') : undefined,
    filter: options.filter ? JSON.stringify(options.filter) : undefined,
    select: options.select?.length ? options.select.join(',') : undefined,
    expand: options.expand?.length ? options.expand.join(',') : undefined,
  };
}

export function defaultReadRows<T>(body: unknown, options: LoadOptions): LoadResult<T> {
  if (Array.isArray(body)) {
    // A plain array is the whole result only when no page was asked for.
    const whole = options.skip === undefined && options.take === undefined;
    return options.count && whole ? { rows: body, total: body.length } : { rows: body };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const rows = [b.rows, b.items, b.data, b.value].find(Array.isArray) as T[] | undefined;
  const total = [b.total, b.totalCount, b.count, b['@odata.count']].find((v) => typeof v === 'number') as number | undefined;
  return total === undefined ? { rows: rows ?? [] } : { rows: rows ?? [], total };
}

export function defaultReadSaved<T>(body: unknown): Partial<T> | void {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Partial<T>) : undefined;
}
