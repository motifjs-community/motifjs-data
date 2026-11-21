import type { BatchResult } from '../adapter/batch-result';
import type { ByKeyOptions } from '../adapter/by-key-options';
import type { Capabilities } from '../adapter/capabilities';
import type { Change } from '../adapter/change';
import type { OperationOptions } from '../adapter/operation-options';
import type { WriteOptions } from '../adapter/write-options';
import { DataError } from '../errors/data-error';
import { withValidValues } from '../errors/with-valid-values';
import { absoluteUrl } from '../http/absolute-url';
import { HttpAdapter } from '../http/http-adapter';
import type { HttpRequest } from '../http/http-request';
import type { HttpRequestInit } from '../http/http-request-init';
import { queryString } from '../http/query-string';
import { requestParams } from '../http/request-params';
import type { FieldType } from '../query/field-type';
import { or, where } from '../query/filter-builders';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { FilterExpression } from '../query/filter-expression';
import { mayBeEmpty, PivotAxis, type PivotDepth, pivotDepths, readKey, readValue } from '../query/pivot';
import type { PivotCellsOptions } from '../query/pivot-cells-options';
import type { PivotCountsOptions } from '../query/pivot-counts-options';
import type { PivotGroup } from '../query/pivot-group';
import type { PivotKeep } from '../query/pivot-keep';
import type { PivotLevel } from '../query/pivot-level';
import type { PivotLoadOptions } from '../query/pivot-load-options';
import type { PivotMeasure } from '../query/pivot-measure';
import type { PivotMembersOptions } from '../query/pivot-members-options';
import { bySummary, inLevelOrder } from '../query/pivot-window';
import { fieldTypeOf, getField, isObject } from '../query/values';
import type { BatchRequestPart } from './batch-request-part';
import type { BatchResponsePart } from './batch-response-part';
import { readBatch, writeBatch } from './multipart-batch';
import type { ODataAdapterOptions } from './odata-adapter-options';
import { intervalPath, toODataFilter } from './odata-filter';
import { dayText, odataExpand, odataLiteral, odataPath } from './odata-syntax';

// Sent with writes only: a read with no custom header needs no CORS preflight.
const ODATA_HEADERS = { 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' };
const AGGREGATE = { count: '', countDistinct: 'countdistinct', sum: 'sum', min: 'min', max: 'max', avg: 'average' } as const;
// The members one request names in its filter, as text; more go in another request, so that its address stays short.
const PATHS_TEXT = 1500;

/** A member of a slice as the service lists it. */
type Listed = { key: unknown; count: number; values: unknown[]; childCount?: number };

/** Members a measure orders, one part of their order: its filter on the measure, its `$orderby`, and which values it holds. */
type SummaryGroup = { filter: string | null; orderby: string; byValue: boolean; role: 'any' | 'none' | 'above' | 'zero' | 'below' };

/** A level a pivot request groups by, with the name its value has in the answer when it is computed. */
type GroupedLevel<T> = { level: PivotLevel<T>; alias: string };

/**
 * An OData v4 entity set. Filtering, sorting, paging, counting, `$select` and `$expand` run on the
 * service, summaries and pivots too with `aggregation`; updates and removes send the `@odata.etag`
 * of the `original` row as `If-Match`.
 */
export class ODataAdapter<T = Record<string, unknown>, K = unknown> extends HttpAdapter<T, K> {
  private readonly odata: ODataAdapterOptions<T, K>;
  private readonly url: string;
  private readonly serviceRoot: string;

  constructor(options: ODataAdapterOptions<T, K>) {
    super(options);
    this.odata = options;
    this.url = options.url.replace(/\/+$/, '');
    this.serviceRoot = this.url.replace(/[^/]*$/, '');
    if (options.batch) this.saveBatch = (changes, operation) => this.sendBatch(changes, operation);
  }

  protected backendCapabilities(): Capabilities {
    const aggregation = !!this.odata.aggregation;
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary: aggregation, pivot: aggregation, pivotWindow: aggregation, insert: true, update: true, remove: true };
  }

  protected override pivotRemotely(options: PivotLoadOptions<T>): boolean {
    const compute = this.aggregationOptions.compute === true;
    const levels = [...(options.rows ?? []), ...(options.columns ?? [])];
    // A kept member is told by OData's date functions in a filter, without `compute`; no function tells the day of the week.
    const keep = (options.keep ?? []).every((k) => !(k.intervals ?? []).includes('dayOfWeek'));
    return super.pivotRemotely(options) && keep && levels.every((level) => level.interval === undefined || (compute && level.interval !== 'dayOfWeek'));
  }

  // One `$apply` per pair of depths of the axes, e.g. rows by year and country under 2024, columns at their total:
  // `filter(…)/compute(year(OrderDate) as _r0)/filter(_r0 eq 2024)/groupby((_r0,ShipCountry),aggregate($count as _n,Freight with sum as _m0))`.
  protected override async loadPivotGroups(options: PivotLoadOptions<T>): Promise<unknown> {
    const pairs = withValidValues('load', () =>
      pivotDepths(options.rows ?? [], options.expandedRows).flatMap((r) =>
        pivotDepths(options.columns ?? [], options.expandedColumns).map((c) => ({ rows: r.depth, columns: c.depth, apply: this.pivotApply(options, r, c) })),
      ),
    );
    const bodies = await this.readApplied(
      pairs.map((p) => ({ $apply: p.apply })),
      options,
    );
    return bodies.flatMap((body, i) => recordsOf(body).map((record) => this.pivotGroup(record, options, pairs[i].rows, pairs[i].columns)));
  }

  // The members of each slice: `filter(…)/filter(Region eq 'East')/filter(City ne null)/groupby((Region,City),aggregate(…))`
  // with `$orderby`, `$skip`, `$top` and `$count`, and the empty member on its own, last. A service orders empty values
  // its own way, so they never reach `$orderby`: ordered by a measure, the members come in groups the measure's value
  // tells apart (above, at and below 0 for a sum; with and without one for the others), counted first and paged after,
  // and the empty member takes its place among them by its value. Ordered by a measure in a member of the other axis,
  // every member of the parent comes and they are ordered here. With `nonEmpty`, every read filters the members on their
  // measures after it aggregates them: `…/groupby((Region,City),aggregate(…))/filter(_m0 ne null or _m1 ne null)`.
  protected override async loadPivotMemberSlices(o: PivotMembersOptions<T>): Promise<unknown> {
    const [answer, found] = await Promise.all([this.memberSlices(o), o.find?.length ? this.findPlaces(o) : undefined]);
    return found ? { ...answer, found } : answer;
  }

  // The places of members among their parent's children, as the slices order them: in value order, the members before
  // each counted on the service (the empty member is last); by a measure, its value first, then the members of its
  // group before it, after the groups before; by a measure in a member of the other axis, from the parent's ordered list.
  private async findPlaces(o: PivotMembersOptions<T>): Promise<number[]> {
    const find = o.find!;
    const depth = o.slices[0].parent.length;
    const grouped = o.levels.slice(0, depth + 1).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
    const member = groupedText(grouped[depth]);
    const measures = o.measures ?? [];
    const values = valuesText(measures);
    const dir = o.levels[depth].dir === 'desc' ? 'desc' : 'asc';
    const filled = nonEmptyText(o);
    const groupby = `groupby((${grouped.map(groupedText).join(',')}),aggregate(${values}))${filled}`;
    const sort = o.sortBySummary;
    const ctx = this.evaluateContext;
    const axis = new PivotAxis<T>(o.levels.slice(0, depth + 1), ctx);
    const level = o.levels[depth];
    const parentOf = (path: readonly unknown[]) => path.slice(0, depth);
    const under = (parent: readonly unknown[]) => (parent.length ? [`filter(${this.pathText(grouped, parent)})`] : []);
    const listedOf = (parent: readonly unknown[]) => [...this.partSteps(o, grouped), ...under(parent), `filter(${member} ne null)`, groupby].join('/');
    const emptyOf = (parent: readonly unknown[]) => [...this.partSteps(o, grouped), ...under(parent), `filter(${member} eq null)`, `aggregate(${values})${filled}`].join('/');
    const literal = (key: unknown) => odataLiteral(key, keyType(level, key, this.fields));
    const isEmpty = (key: unknown) => key === null || key === undefined;
    const counted = { $count: 'true', $top: '0' };
    if (sort?.path?.length) {
      const parents = [...new Map(find.map((path) => [axis.idOf(parentOf(path)), parentOf(path)])).values()];
      const answer = await this.memberSlices({ ...o, slices: parents.map((parent) => ({ parent })), childCounts: false });
      return find.map((path) => {
        const at = parents.findIndex((parent) => axis.idOf(parent) === axis.idOf(parentOf(path)));
        const id = axis.idOf(path);
        return answer.slices[at].members.findIndex((m) => axis.idOf([...parentOf(path), readKey(m.key, level, this.fields)]) === id);
      });
    }
    if (!sort) {
      const before = dir === 'asc' ? 'lt' : 'gt';
      const reads = find.flatMap((path) => {
        const listed = listedOf(parentOf(path));
        const key = path[depth];
        if (isEmpty(key)) return [{ $apply: listed, ...counted }, { $apply: emptyOf(parentOf(path)) }];
        return [
          { $apply: `${listed}/filter(${member} ${before} ${literal(key)})`, ...counted },
          { $apply: `${listed}/filter(${member} eq ${literal(key)})`, ...counted },
        ];
      });
      const bodies = await this.readApplied(reads, o);
      return find.map((path, i) => {
        const there = isEmpty(path[depth]) ? Number(recordsOf(bodies[2 * i + 1])[0]?._n ?? 0) > 0 : countOf(bodies[2 * i + 1]) > 0;
        return there ? countOf(bodies[2 * i]) : -1;
      });
    }
    // By a measure: first the member's value, the groups' numbers and the empty member of each parent.
    const groups = this.summaryGroups(measures, sort.measure, member, dir);
    const measure = measures[sort.measure];
    const sorted = measure.type === 'count' ? '_n' : `_m${sort.measure}`;
    const valueOf = (record: Record<string, unknown> | undefined) => rankOf(readValue(recordValues(record ?? {}, measures)[sort.measure], measure));
    const first: Record<string, string>[] = [];
    const at = find.map((path) => {
      const parent = parentOf(path);
      const listed = listedOf(parent);
      const n = first.length;
      for (const g of groups) first.push({ $apply: g.filter ? `${listed}/filter(${g.filter})` : listed, ...counted });
      first.push({ $apply: emptyOf(parent) });
      first.push({ $apply: isEmpty(path[depth]) ? emptyOf(parent) : `${listed}/filter(${member} eq ${literal(path[depth])})` });
      return n;
    });
    const firstBodies = await this.readApplied(first, o);
    // Then the members of its group before it: by value, and on a tie by their order (the empty member after them all).
    const second: Record<string, string>[] = [];
    const plans = find.map((path, i) => {
      const n = at[i];
      const sizes = groups.map((_, g) => countOf(firstBodies[n + g]));
      const blank = recordsOf(firstBodies[n + groups.length])[0];
      const empty = blank && Number(blank._n ?? 0) > 0 ? valueOf(blank) : undefined;
      const own = recordsOf(firstBodies[n + groups.length + 1])[0];
      const key = path[depth];
      const there = isEmpty(key) ? empty !== undefined : !!own && Number(own._n ?? 0) > 0;
      if (!there) return null;
      const v = isEmpty(key) ? (empty as number | null) : valueOf(own);
      const home = this.summaryHome(groups, v);
      const g = groups[home];
      const listed = listedOf(parentOf(path));
      const offset = sizes.slice(0, home).reduce((a, b) => a + b, 0);
      // The empty member stands before a member of a group before, or of the same group with a better value.
      const emptyHome = empty === undefined ? -1 : this.summaryHome(groups, empty);
      const emptyBefore = !isEmpty(key) && empty !== undefined && (emptyHome < home || (emptyHome === home && g.byValue && empty !== v && summaryBefore(empty, v, dir)));
      if (isEmpty(key) && !g.byValue) return { at: -1, base: offset + sizes[home] };
      const better = dir === 'desc' ? 'gt' : 'lt';
      const tie = isEmpty(key) ? `${sorted} eq ${v}` : `${sorted} eq ${v} and ${member} ${better} ${literal(key)}`;
      const within = !g.byValue ? `${member} ${better} ${literal(key)}` : `${sorted} ${better} ${v} or (${tie})`;
      const filters = [g.filter, within].filter((f): f is string => !!f).map((f) => `filter(${f})`);
      second.push({ $apply: [listed, ...filters].join('/'), ...counted });
      return { at: second.length - 1, base: offset + (emptyBefore ? 1 : 0) };
    });
    const secondBodies = second.length ? await this.readApplied(second, o) : [];
    return plans.map((p) => (p === null ? -1 : p.base + (p.at < 0 ? 0 : countOf(secondBodies[p.at]))));
  }

  // The members of each slice, without `find`.
  private async memberSlices(o: PivotMembersOptions<T>): Promise<{ slices: { total: number; members: Listed[] }[] }> {
    const depth = o.slices[0].parent.length;
    const grouped = o.levels.slice(0, depth + 1).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
    const member = groupedText(grouped[depth]);
    const measures = o.measures ?? [];
    const values = valuesText(measures);
    const dir = o.levels[depth].dir === 'desc' ? 'desc' : 'asc';
    const filled = nonEmptyText(o);
    const groupby = `groupby((${grouped.map(groupedText).join(',')}),aggregate(${values}))${filled}`;
    const aggregated = `aggregate(${values})${filled}`;
    const sort = o.sortBySummary;
    const columns = (sort?.levels ?? []).slice(0, sort?.path?.length ?? 0).map((level, j): GroupedLevel<T> => ({ level, alias: `_c${j}` }));
    const next = depth + 1 < o.levels.length && o.childCounts ? o.levels.slice(0, depth + 2).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` })) : null;
    const groups = sort && !columns.length ? this.summaryGroups(measures, sort.measure, member, dir) : [];
    const ctx = this.evaluateContext;
    const keyOf = (record: Record<string, unknown>) => recordKey(record, grouped[depth]);
    const toMember = (record: Record<string, unknown>): Listed => ({ key: keyOf(record), count: Number(record._n ?? 0), values: recordValues(record, measures) });
    const valueOf = (m: Listed) => (sort ? rankOf(readValue(m.values[sort.measure], measures[sort.measure])) : null);

    // First round: whole answers, and the numbers of the groups ordered by a measure.
    const first: Record<string, string>[] = [];
    const plans = o.slices.map((slice) => {
      const steps = this.partSteps(o, grouped);
      const under = slice.parent.length ? `filter(${this.pathText(grouped, slice.parent)})` : '';
      if (under) steps.push(under);
      const listed = [...steps, `filter(${member} ne null)`, groupby].join('/');
      const plan = { at: first.length, counts: -1, listed };
      const skip = slice.skip ?? 0;
      if (!sort) {
        first.push({ $apply: listed, $orderby: `${member} ${dir}`, $count: 'true', ...pageOf(skip, slice.take === undefined ? Infinity : skip + slice.take) });
        first.push({ $apply: [...steps, `filter(${member} eq null)`, aggregated].join('/') });
      } else if (columns.length) {
        const measure = measures[sort.measure];
        const one = measure.type === 'count' ? '$count as _s' : `${odataPath((measure as { field: string }).field)} with ${AGGREGATE[measure.type as keyof typeof AGGREGATE]} as _s`;
        first.push({ $apply: [...steps, groupby].join('/') });
        const both = this.partSteps(o, [...grouped, ...columns]);
        first.push({ $apply: [...both, ...(under ? [under] : []), `filter(${this.pathText(columns, sort.path!)})`, `groupby((${grouped.map(groupedText).join(',')}),aggregate(${one}))`].join('/') });
      } else {
        for (const g of groups) first.push({ $apply: g.filter ? `${listed}/filter(${g.filter})` : listed, $count: 'true', $top: '0' });
        first.push({ $apply: [...steps, `filter(${member} eq null)`, aggregated].join('/') });
      }
      if (next) {
        plan.counts = first.length;
        const counted = this.partSteps(o, next);
        first.push({ $apply: [...counted, ...(under ? [under] : []), countedText(next, o), `groupby((${grouped.map(groupedText).join(',')}),aggregate($count as _c))`].join('/') });
      }
      return plan;
    });
    const firstBodies = await this.readApplied(first, o);

    // Second round, ordered by a measure: the pages of the groups the slices reach.
    const second: Record<string, string>[] = [];
    const placed = o.slices.map((slice, i) => {
      if (!sort || columns.length) return null;
      const plan = plans[i];
      const sizes = groups.map((_, g) => countOf(firstBodies[plan.at + g]));
      const blank = recordsOf(firstBodies[plan.at + groups.length])[0];
      const empty = blank && Number(blank._n ?? 0) > 0 ? { ...toMember(blank), key: null } : null;
      const home = empty ? this.summaryHome(groups, valueOf(empty)) : -1;
      const skip = slice.skip ?? 0;
      const end = slice.take === undefined ? Infinity : skip + slice.take;
      const parts: { group: number; at: number; from: number; to: number; local: [number, number] }[] = [];
      let offset = 0;
      groups.forEach((g, n) => {
        const size = sizes[n] + (home === n ? 1 : 0);
        const from = Math.max(skip - offset, 0);
        const to = Math.min(end - offset, size);
        offset += size;
        if (from >= to) return;
        // Placed by its value, the empty member may stand before the part: one member more is read in front.
        const read: [number, number] = home === n && g.byValue ? [Math.max(0, from - 1), Math.min(to, sizes[n])] : [from, Math.min(to, sizes[n])];
        parts.push({ group: n, at: second.length, from, to, local: read });
        if (read[0] < read[1]) second.push({ $apply: g.filter ? `${plan.listed}/filter(${g.filter})` : plan.listed, $orderby: g.orderby, ...pageOf(read[0], read[1]) });
        else parts[parts.length - 1].at = -1;
      });
      return { sizes, empty, home, parts, total: offset };
    });
    const secondBodies = second.length ? await this.readApplied(second, o) : [];

    return {
      slices: o.slices.map((slice, i) => {
        const plan = plans[i];
        const skip = slice.skip ?? 0;
        const end = slice.take === undefined ? Infinity : skip + slice.take;
        let total: number;
        let members: Listed[];
        if (!sort) {
          const list = firstBodies[plan.at];
          const blank = recordsOf(firstBodies[plan.at + 1]).filter((r) => Number(r._n ?? 0) > 0);
          const listed = countOf(list);
          total = listed + blank.length;
          members = [...recordsOf(list).map(toMember), ...blank.map((r) => ({ ...toMember(r), key: null })).slice(Math.max(0, skip - listed), Math.max(0, end - listed))];
        } else if (columns.length) {
          const all = inLevelOrder(recordsOf(firstBodies[plan.at]).map(toMember), o.levels.slice(0, depth + 1), ctx);
          const measure = measures[sort.measure];
          const at = new Map(recordsOf(firstBodies[plan.at + 1]).map((r) => [keyText(keyOf(r)), readValue(r._s, measure)]));
          const ordered = bySummary(all, (m) => at.get(keyText(m.key)), o.levels[depth].dir);
          total = ordered.length;
          members = ordered.slice(skip, end);
        } else {
          const p = placed[i]!;
          total = p.total;
          members = [];
          for (const part of p.parts) {
            const read = part.at < 0 ? [] : recordsOf(secondBodies[part.at]).map(toMember);
            if (p.home !== part.group) {
              members.push(...read);
              continue;
            }
            // The empty member's place in its group: after the members before it by value, ties included.
            const g = groups[part.group];
            const v = valueOf(p.empty!);
            const before = (m: Listed) => !g.byValue || summaryBefore(valueOf(m), v, dir);
            let place = read.findIndex((m) => !before(m));
            place = place < 0 ? (part.local[1] === p.sizes[part.group] ? p.sizes[part.group] : Infinity) : part.local[0] + place;
            const merged: { index: number; m: Listed }[] = read.map((m, k) => ({ index: part.local[0] + k + (part.local[0] + k >= place ? 1 : 0), m }));
            if (place !== Infinity) merged.push({ index: place, m: p.empty! });
            members.push(...merged.filter((e) => e.index >= part.from && e.index < part.to).sort((a, b) => a.index - b.index).map((e) => e.m));
          }
        }
        if (next) {
          const counts = new Map(recordsOf(firstBodies[plan.counts]).map((r) => [keyText(keyOf(r)), Number(r._c ?? 0)]));
          members = members.map((m) => ({ ...m, childCount: counts.get(keyText(m.key)) ?? 0 }));
        }
        return { total, members };
      }),
    };
  }

  // The groups of members a measure orders, in their order, each with its filter on the measure and its own order: a sum
  // above, at and below 0 (an empty sum is 0); another measure with a value, then without; a count in one group. A
  // measure of a field declared as text or a date has no value to order by, as in memory.
  private summaryGroups(measures: readonly PivotMeasure<T>[], at: number, member: string, dir: 'asc' | 'desc'): SummaryGroup[] {
    const measure = measures[at];
    const sorted = measure.type === 'count' ? '_n' : `_m${at}`;
    const byValue = { orderby: `${sorted} ${dir},${member} ${dir}`, byValue: true };
    const byMember = { orderby: `${member} ${dir}`, byValue: false };
    if (measure.type === 'count' || measure.type === 'countDistinct') return [{ filter: null, role: 'any', ...byValue }];
    if (measure.type === 'sum') {
      const above: SummaryGroup = { filter: `${sorted} gt 0`, role: 'above', ...byValue };
      const zero: SummaryGroup = { filter: `${sorted} eq 0 or ${sorted} eq null`, role: 'zero', ...byMember };
      const below: SummaryGroup = { filter: `${sorted} lt 0`, role: 'below', ...byValue };
      return dir === 'desc' ? [above, zero, below] : [below, zero, above];
    }
    const type = measure.type === 'custom' ? undefined : this.fields[measure.field!];
    if (measure.type !== 'avg' && type !== undefined && type !== 'number') return [{ filter: null, role: 'none', ...byMember }];
    return [
      { filter: `${sorted} ne null`, role: 'any', ...byValue },
      { filter: `${sorted} eq null`, role: 'none', ...byMember },
    ];
  }

  // The group the empty member's value puts it in.
  private summaryHome(groups: readonly SummaryGroup[], value: number | null): number {
    const role = groups.some((g) => g.role === 'above') ? (value === null || value === 0 ? 'zero' : value > 0 ? 'above' : 'below') : value === null ? 'none' : 'any';
    const home = groups.findIndex((g) => g.role === role);
    return home < 0 ? groups.length - 1 : home;
  }

  // The number of children of members, by the depth of their paths: `filter(…)/groupby((Region,City))/groupby((Region),aggregate($count as _c))`;
  // with `nonEmpty`, the children filtered on their measures first: `groupby((Region,City),aggregate(…))/filter(_m0 ne null)/…`.
  protected override async loadPivotChildCounts(o: PivotCountsOptions<T>): Promise<unknown> {
    const reads: { query: Record<string, string>; depth: number }[] = [];
    for (const [depth, paths] of byLength(o.paths)) {
      const grouped = o.levels.slice(0, depth + 1).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
      const steps = this.partSteps(o, grouped);
      const last = depth ? `groupby((${grouped.slice(0, depth).map(groupedText).join(',')}),aggregate($count as _c))` : 'aggregate($count as _c)';
      for (const part of depth ? this.pathChunks(grouped, paths) : [null]) {
        reads.push({ depth, query: { $apply: [...steps, ...(part ? [`filter(${part})`] : []), countedText(grouped, o), last].join('/') } });
      }
    }
    const bodies = await this.readApplied(
      reads.map((r) => r.query),
      o,
    );
    return {
      counts: bodies.flatMap((body, i) => {
        const depth = reads[i].depth;
        const grouped = o.levels.slice(0, depth).map((level, k): GroupedLevel<T> => ({ level, alias: `_r${k}` }));
        return recordsOf(body).map((record) => ({ path: grouped.map((g) => recordKey(record, g)), count: Number(record._c ?? 0) }));
      }),
    };
  }

  // One `$apply` per pair of depths asked for, the members named in a filter: `filter((Region eq 'East') or (…))/…`;
  // a long list goes in several reads.
  protected override async loadPivotCellGroups(o: PivotCellsOptions<T>): Promise<unknown> {
    const values = valuesText(o.measures);
    const reads: { query: Record<string, string>; rows: number; columns: number }[] = [];
    for (const [rowDepth, rowPaths] of byLength(o.rowPaths)) {
      for (const [columnDepth, columnPaths] of byLength(o.columnPaths)) {
        const rows = o.rows.slice(0, rowDepth).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
        const columns = o.columns.slice(0, columnDepth).map((level, j): GroupedLevel<T> => ({ level, alias: `_c${j}` }));
        const grouped = [...rows, ...columns];
        const steps = this.partSteps(o, grouped);
        const last = grouped.length ? `groupby((${grouped.map(groupedText).join(',')}),aggregate(${values}))` : `aggregate(${values})`;
        for (const rowPart of rowDepth ? this.pathChunks(rows, rowPaths) : [null]) {
          for (const columnPart of columnDepth ? this.pathChunks(columns, columnPaths) : [null]) {
            const where = [rowPart, columnPart].filter((text): text is string => !!text).map((text) => `filter(${text})`);
            reads.push({ rows: rowDepth, columns: columnDepth, query: { $apply: [...steps, ...where, last].join('/') } });
          }
        }
      }
    }
    const bodies = await this.readApplied(
      reads.map((r) => r.query),
      o,
    );
    const asked = { rows: o.rows, columns: o.columns, measures: o.measures };
    return bodies.flatMap((body, i) => recordsOf(body).map((record) => this.pivotGroup(record, asked, reads[i].rows, reads[i].columns)));
  }

  protected async loadRows(options: LoadOptions): Promise<LoadResult<T>> {
    const query = withValidValues('load', () => this.loadQuery(options));
    // Only summaries asked for: no rows to load.
    const rowsWanted = options.take !== 0 || options.count;
    const [result, summary] = await Promise.all([
      rowsWanted ? this.loadAllPages(query, options) : { rows: [] },
      options.summary?.length ? this.loadSummary(options) : undefined,
    ]);
    return summary ? { ...result, summary } : result;
  }

  private async loadAllPages(query: HttpRequestInit['query'], options: LoadOptions): Promise<LoadResult<T>> {
    const first = await this.loadPage(this.url, query, options.signal);
    const rows = [...first.rows];
    let next = first.nextLink;
    while (this.odata.followNextLink !== false && typeof next === 'string' && (options.take === undefined || rows.length < options.take)) {
      const page = await this.loadPage(this.linkUrl(next), undefined, options.signal);
      rows.push(...page.rows);
      next = page.nextLink;
    }
    if (options.take !== undefined && rows.length > options.take) rows.length = options.take;

    const readRow = this.odata.readRow;
    const result = readRow ? rows.map((row) => readRow(row as Record<string, unknown>)) : (rows as T[]);
    return first.total === undefined ? { rows: result } : { rows: result, total: Number(first.total) };
  }

  protected override async findRow(key: K, options: ByKeyOptions): Promise<T | undefined> {
    const url = withValidValues('byKey', () => this.itemUrl(key));
    const query = { $select: selectText(options.select), $expand: expandText(options.expand), ...requestParams(options) };
    try {
      const response = await this.send({ operation: 'byKey', method: 'GET', url, query, signal: options.signal });
      return isObject(response.body) ? this.readEntity(response.body) : undefined;
    } catch (error) {
      if (error instanceof DataError && error.code === 'MJD204') return undefined;
      throw error;
    }
  }

  protected override async insertRow(values: Partial<T>, options: OperationOptions): Promise<Partial<T> | void> {
    const response = await this.send({
      operation: 'insert',
      method: 'POST',
      url: this.url,
      query: requestParams(options),
      headers: this.writeHeaders(undefined, true),
      data: this.writeValues(values),
      signal: options.signal,
    });
    return this.readSaved(response.body, response.headers);
  }

  protected override async updateRow(key: K, changes: Partial<T>, options: WriteOptions<T>): Promise<Partial<T> | void> {
    const url = withValidValues('update', () => this.itemUrl(key));
    const response = await this.send({
      operation: 'update',
      method: this.odata.updateMethod ?? 'PATCH',
      url,
      query: requestParams(options),
      headers: this.writeHeaders(options.original, true),
      data: this.writeValues(changes),
      signal: options.signal,
    });
    return this.readSaved(response.body, response.headers);
  }

  protected override async removeRow(key: K, options: WriteOptions<T>): Promise<void> {
    const url = withValidValues('remove', () => this.itemUrl(key));
    await this.send({ operation: 'remove', method: 'DELETE', url, query: requestParams(options), headers: this.writeHeaders(options.original, false), signal: options.signal });
  }

  private async sendBatch(changes: readonly Change<T, K>[], options: OperationOptions): Promise<BatchResult<T>[]> {
    const settings = typeof this.odata.batch === 'object' ? this.odata.batch : {};
    const url = settings.url ?? `${this.serviceRoot}$batch`;
    const requests = withValidValues('save', () => changes.map((change) => this.batchRequest(change)));
    const boundary = `batch_${randomText()}`;
    const changeset = settings.allOrNothing ? `changeset_${randomText()}` : undefined;

    const response = await this.send({
      operation: 'save',
      method: 'POST',
      url,
      query: requestParams(options),
      headers: {
        ...ODATA_HEADERS,
        Accept: 'multipart/mixed',
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
        // Without a change set every change is tried, as `save` promises.
        ...(changeset ? {} : { Prefer: 'odata.continue-on-error' }),
      },
      body: writeBatch(requests, boundary, changeset),
      signal: options.signal,
    });

    let answers: BatchResponsePart[];
    try {
      answers = readBatch(typeof response.body === 'string' ? response.body : '', response.headers.get('content-type') ?? '');
    } catch (error) {
      throw DataError.create('MJD104', { operation: 'save', details: response.body, cause: error }, (error as Error).message);
    }
    // A failed change set answers once for all of its changes.
    if (answers.length === 1 && changes.length > 1 && answers[0].status >= 400) answers = changes.map(() => answers[0]);
    const byId = new Map(answers.filter((a) => a.contentId).map((a) => [a.contentId, a]));

    const results: BatchResult<T>[] = [];
    for (let i = 0; i < changes.length; i++) {
      const answer = byId.get(String(i + 1)) ?? answers[i];
      if (!answer) break;
      results.push(this.batchResult(answer, changes[i], response.request));
    }
    return results;
  }

  private batchRequest(change: Change<T, K>): BatchRequestPart {
    const json = { 'Content-Type': 'application/json' };
    if (change.type === 'insert') {
      return { method: 'POST', url: absoluteUrl(this.url), headers: { ...json, ...this.writeHeaders(undefined, true) }, body: JSON.stringify(this.writeValues(change.data)) };
    }
    // Some services take only full addresses inside a batch.
    const url = absoluteUrl(this.itemUrl(change.key));
    if (change.type === 'update') {
      const headers = { ...json, ...this.writeHeaders(change.original, true) };
      return { method: this.odata.updateMethod ?? 'PATCH', url, headers, body: JSON.stringify(this.writeValues(change.data)) };
    }
    return { method: 'DELETE', url, headers: this.writeHeaders(change.original, false) };
  }

  private batchResult(answer: BatchResponsePart, change: Change<T, K>, request: HttpRequest): BatchResult<T> {
    if (answer.status >= 200 && answer.status < 300) return { ok: true, row: this.readSaved(answer.body, answer.headers) };
    const error = this.readError({
      request: { ...request, operation: change.type },
      status: answer.status,
      statusText: answer.statusText,
      headers: answer.headers,
      body: answer.body,
      durationMs: 0,
    });
    return { ok: false, error };
  }

  private loadQuery(o: LoadOptions): HttpRequestInit['query'] {
    const filter = this.filterText(o);
    return {
      $filter: filter === 'true' ? undefined : filter,
      $orderby: o.sort?.length ? o.sort.map((s) => `${odataPath(s.field)}${s.dir === 'desc' ? ' desc' : ''}`).join(',') : undefined,
      $skip: o.skip || undefined,
      $top: o.take,
      $count: o.count || undefined,
      $select: selectText(o.select),
      $expand: expandText(o.expand),
      ...requestParams(o),
    };
  }

  /** Whether the service applies this filter: not one on the day of the week, which OData has no function for. */
  override canFilter(filter: FilterExpression | null | undefined): boolean {
    if (!filter) return true;
    try {
      this.filterText({ filter });
      return true;
    } catch {
      return false;
    }
  }

  private filterText(o: LoadOptions): string {
    return o.filter ? toODataFilter(o.filter, { fields: this.fields, locale: this.locale, ignoreCase: this.odata.ignoreCase, collections: this.odata.collections }) : 'true';
  }

  private async loadPage(url: string, query: HttpRequestInit['query'], signal: AbortSignal | undefined) {
    const response = await this.send({ operation: 'load', method: 'GET', url, query, signal });
    const body = response.body as Record<string, unknown> | null;
    if (!Array.isArray(body?.value)) throw DataError.create('MJD104', { operation: 'load', details: body }, 'no "value" array');
    return { rows: body.value as unknown[], total: body['@odata.count'], nextLink: body['@odata.nextLink'] };
  }

  // `$apply=filter(…)/aggregate(Freight with sum as s0, $count as s1)`: one row of values.
  private async loadSummary(options: LoadOptions): Promise<unknown[]> {
    const items = options.summary!;
    const apply = withValidValues('load', () => {
      const values = items.map((item, i) => (item.type === 'count' ? `$count as s${i}` : `${odataPath(item.field!)} with ${AGGREGATE[item.type]} as s${i}`));
      const filter = this.filterText(options);
      return `${filter === 'true' ? '' : `filter(${filter})/`}aggregate(${values.join(',')})`;
    });
    const response = await this.send({ operation: 'load', method: 'GET', url: this.url, query: { $apply: apply, ...requestParams(options) }, signal: options.signal });
    const row = (response.body as { value?: Record<string, unknown>[] } | null)?.value?.[0] ?? {};
    return items.map((item, i) => {
      const value = row[`s${i}`] ?? null;
      if (item.type === 'count' || item.type === 'countDistinct' || item.type === 'sum') return Number(value ?? 0);
      return item.type === 'avg' && value !== null ? Number(value) : value;
    });
  }

  private get aggregationOptions() {
    return typeof this.odata.aggregation === 'object' ? this.odata.aggregation : {};
  }

  private pivotApply(o: PivotLoadOptions<T>, r: PivotDepth, c: PivotDepth): string {
    const rows = (o.rows ?? []).slice(0, r.depth).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
    const columns = (o.columns ?? []).slice(0, c.depth).map((level, j): GroupedLevel<T> => ({ level, alias: `_c${j}` }));
    const grouped = [...rows, ...columns];
    const steps = this.partSteps(o, grouped);
    const under = [this.parentsText(rows, r.parents), this.parentsText(columns, c.parents)].filter((text) => text !== '');
    if (under.length) steps.push(`filter(${under.length === 1 ? under[0] : under.map((text) => `(${text})`).join(' and ')})`);
    const aggregate = `aggregate(${valuesText(o.measures ?? [])})`;
    steps.push(grouped.length ? `groupby((${grouped.map((g) => groupedText(g)).join(',')}),${aggregate})` : aggregate);
    return steps.join('/');
  }

  // The rows a pivot reads, before it groups them: its filter, the members it keeps, the values of the levels it computes.
  private partSteps(o: { filter?: FilterExpression | null; keep?: readonly PivotKeep<T>[] }, grouped: readonly GroupedLevel<T>[]): string[] {
    const steps: string[] = [];
    const filter = this.filterText({ filter: o.filter });
    if (filter !== 'true') steps.push(`filter(${filter})`);
    const kept = (o.keep ?? []).map((k) => this.keepText(k));
    if (kept.length) steps.push(`filter(${kept.length === 1 ? kept[0] : kept.map((text) => `(${text})`).join(' and ')})`);
    const computed = grouped.filter((g) => g.level.interval !== undefined);
    if (computed.length) steps.push(`compute(${computed.map((g) => `${intervalText(g.level)} as ${g.alias}`).join(',')})`);
    return steps;
  }

  // `Region eq 'East' and City eq 'Ankara'`: the rows of one member, its keys on the levels grouped from the top.
  private pathText(grouped: readonly GroupedLevel<T>[], path: readonly unknown[]): string {
    return path.map((key, k) => `${groupedText(grouped[k])} eq ${odataLiteral(key, keyType(grouped[k].level, key, this.fields))}`).join(' and ');
  }

  // The rows of some members, `(…) or (…)`, in parts short enough for a request's address.
  private pathChunks(grouped: readonly GroupedLevel<T>[], paths: readonly (readonly unknown[])[]): string[] {
    const out: string[] = [];
    let part: string[] = [];
    let size = 0;
    for (const path of paths) {
      const text = this.pathText(grouped, path);
      if (part.length && size + text.length > PATHS_TEXT) {
        out.push(part.length === 1 ? part[0] : part.map((one) => `(${one})`).join(' or '));
        part = [];
        size = 0;
      }
      part.push(text);
      size += text.length + 8;
    }
    if (part.length) out.push(part.length === 1 ? part[0] : part.map((one) => `(${one})`).join(' or '));
    return out;
  }

  // Reads with `$apply` and the query options given; in one `$batch` with `aggregation.batch`. The answers in their order.
  private readApplied(queries: readonly Record<string, string>[], options: OperationOptions): Promise<unknown[]> {
    const read = async (query: Record<string, string>) => (await this.send({ operation: 'load', method: 'GET', url: this.url, query: { ...query, ...requestParams(options) }, signal: options.signal })).body;
    return this.aggregationOptions.batch && queries.length > 1 ? this.sendReads(queries, options) : Promise.all(queries.map(read));
  }

  // `(year(OrderDate) eq 2024 and (month(OrderDate) add 2) div 3 eq 2) or (…)`, or `not (…)`: the rows `keep` keeps. Without
  // intervals the keys are compared as a filter compares them (case, collections). Its `filter` joins them with `or`.
  private keepText(keep: PivotKeep<T>): string {
    const intervals = keep.intervals ?? [];
    let any: string;
    if (!keep.paths.length) any = 'false';
    else if (!intervals.length) {
      const keys = keep.paths.filter((path) => path.length === 1).map((path) => path[0]);
      const given = keys.filter((key) => key !== null && key !== undefined);
      const one = (key: unknown) => where(keep.field, '=', key);
      any = this.filterText({ filter: or(...given.map(one), given.length < keys.length ? where(keep.field, 'isblank') : null) });
      if (any === 'true') any = 'false';
    } else {
      const levels = intervals.map((interval): PivotLevel<T> => ({ field: keep.field, interval }));
      const one = (path: readonly unknown[]) =>
        path
          .slice(0, levels.length)
          .map((key, k) => (key === null || key === undefined ? `${odataPath(keep.field)} eq null` : `${intervalText(levels[k])} eq ${odataLiteral(key, keyType(levels[k], key, this.fields))}`))
          .join(' and ');
      const paths = keep.paths.filter((path) => path.length);
      any = paths.length === 1 ? one(paths[0]) : paths.map((path) => `(${one(path)})`).join(' or ');
    }
    const also = keep.filter ? this.filterText({ filter: keep.filter }) : 'false';
    if (also === 'true') any = 'true';
    else if (also !== 'false') any = any === 'false' ? also : `(${any}) or (${also})`;
    return keep.type === 'exclude' ? `not (${any})` : any;
  }

  // `(_r0 eq 2024 and ShipCountry eq 'France') or (…)`: the rows under the members whose children a depth holds.
  private parentsText(grouped: readonly GroupedLevel<T>[], parents: PivotDepth['parents']): string {
    if (!parents) return '';
    return parents.length === 1 ? this.pathText(grouped, parents[0]) : parents.map((path) => `(${this.pathText(grouped, path)})`).join(' or ');
  }

  private pivotGroup(record: Record<string, unknown>, o: Pick<PivotLoadOptions<T>, 'rows' | 'columns' | 'measures'>, rows: number, columns: number): PivotGroup {
    return {
      rows: (o.rows ?? []).slice(0, rows).map((level, i) => recordKey(record, { level, alias: `_r${i}` })),
      columns: (o.columns ?? []).slice(0, columns).map((level, j) => recordKey(record, { level, alias: `_c${j}` })),
      count: Number(record._n ?? 0),
      values: recordValues(record, o.measures ?? []),
    };
  }

  // Reads in one `$batch`, answers in their order; one that failed fails them all.
  private async sendReads(queries: readonly Record<string, string>[], options: OperationOptions): Promise<unknown[]> {
    const url = (typeof this.odata.batch === 'object' ? this.odata.batch.url : undefined) ?? `${this.serviceRoot}$batch`;
    const boundary = `batch_${randomText()}`;
    const requests = queries.map((given): BatchRequestPart => {
      const query = new URLSearchParams(given);
      for (const [name, value] of Object.entries(requestParams(options) ?? {})) if (value !== undefined && value !== null) query.set(name, String(value));
      return { method: 'GET', url: absoluteUrl(`${this.url}?${queryString(query)}`), headers: { Accept: 'application/json' } };
    });
    const response = await this.send({
      operation: 'load',
      method: 'POST',
      url,
      headers: { ...ODATA_HEADERS, Accept: 'multipart/mixed', 'Content-Type': `multipart/mixed; boundary=${boundary}` },
      body: writeBatch(requests, boundary),
      signal: options.signal,
    });
    let answers: BatchResponsePart[];
    try {
      answers = readBatch(typeof response.body === 'string' ? response.body : '', response.headers.get('content-type') ?? '');
    } catch (error) {
      throw DataError.create('MJD104', { operation: 'load', details: response.body, cause: error }, (error as Error).message);
    }
    const byId = new Map(answers.filter((a) => a.contentId).map((a) => [a.contentId, a]));
    return queries.map((_, i) => {
      const answer = byId.get(String(i + 1)) ?? answers[i];
      if (!answer) throw DataError.create('MJD104', { operation: 'load', details: response.body }, `no answer to read ${i + 1} of the batch`);
      if (answer.status < 200 || answer.status >= 300) {
        throw this.readError({ request: response.request, status: answer.status, statusText: answer.statusText, headers: answer.headers, body: answer.body, durationMs: 0 });
      }
      return answer.body;
    });
  }

  // A relative link is relative to the service root.
  private linkUrl(link: string): string {
    return /^([a-z][a-z\d+.-]*:|\/)/i.test(link) ? link : this.serviceRoot + link;
  }

  private itemUrl(key: K): string {
    if (this.odata.itemUrl) return this.odata.itemUrl(key);
    const fields = this.keys.fields;
    if (!fields?.length) throw new TypeError('a function key needs the itemUrl option');
    const literal = (field: string, value: unknown) => encodeURIComponent(odataLiteral(value, this.fields[field] ?? fieldTypeOf(value)));
    const parts = fields.length === 1 ? literal(fields[0], key) : fields.map((f) => `${f}=${literal(f, (key as Record<string, unknown>)?.[f])}`).join(',');
    return `${this.url}(${parts})`;
  }

  private writeHeaders(original: unknown, returnRow: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...ODATA_HEADERS };
    const etag = isObject(original) ? original['@odata.etag'] : undefined;
    if (typeof etag === 'string') headers['If-Match'] = etag;
    if (returnRow && this.odata.returnSavedRow !== false) headers.Prefer = 'return=representation';
    return headers;
  }

  // Annotations stay out of the body; `date` fields go as days.
  private writeValues(values: Partial<T>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith('@odata.')) continue;
      out[name] = this.fields[name] === 'date' && value instanceof Date ? dayText(value) : value;
    }
    return out;
  }

  private readSaved(body: unknown, headers: Headers): Partial<T> | void {
    if (isObject(body)) return this.readEntity(body);
    // An answer without a body still carries the new version.
    const etag = headers.get('ETag');
    return etag ? ({ '@odata.etag': etag } as unknown as Partial<T>) : undefined;
  }

  private readEntity(body: Record<string, unknown>): T {
    const row = { ...body };
    delete row['@odata.context'];
    return this.odata.readRow ? this.odata.readRow(row) : (row as T);
  }
}

function selectText(fields: readonly string[] | undefined): string | undefined {
  return fields?.length ? fields.map(odataPath).join(',') : undefined;
}

function expandText(paths: readonly string[] | undefined): string | undefined {
  return paths?.length ? odataExpand(paths) : undefined;
}

function randomText(): string {
  return Math.random().toString(36).slice(2, 12);
}

// A level with an interval is grouped by the name `compute` gave its value.
function groupedText(g: GroupedLevel<any>): string {
  return g.level.interval === undefined ? odataPath(g.level.field) : g.alias;
}

// `$count as _n,Freight with sum as _m0`: the rows and the measures of a group.
function valuesText(measures: readonly PivotMeasure<any>[]): string {
  const values = ['$count as _n'];
  measures.forEach((m, k) => {
    if (m.type !== 'count' && m.type !== 'custom') values.push(`${odataPath(m.field!)} with ${AGGREGATE[m.type]} as _m${k}`);
  });
  return values.join(',');
}

// `/filter(_m0 ne null or _m1 ne null)`, after an aggregate: with `nonEmpty`, the groups whose measures are not all
// empty; nothing when none is left out (a count, a distinct count or a sum always has a value).
function nonEmptyText<T>(o: { measures?: readonly PivotMeasure<T>[]; nonEmpty?: boolean }): string {
  const measures = o.measures ?? [];
  return o.nonEmpty && mayBeEmpty(measures) ? `/filter(${measures.map((_, k) => `_m${k} ne null`).join(' or ')})` : '';
}

// The groups of the levels, to count them: `groupby((Region,City))`; with `nonEmpty`, those whose measures are not all
// empty: `groupby((Region,City),aggregate(…))/filter(_m0 ne null)`.
function countedText<T>(grouped: readonly GroupedLevel<T>[], o: { measures?: readonly PivotMeasure<T>[]; nonEmpty?: boolean }): string {
  const by = grouped.map(groupedText).join(',');
  const filled = nonEmptyText(o);
  return filled ? `groupby((${by}),aggregate(${valuesText(o.measures ?? [])}))${filled}` : `groupby((${by}))`;
}

// A level's key in an answer: under the field's path, or under its alias when the level computes it.
function recordKey(record: Record<string, unknown>, g: GroupedLevel<any>): unknown {
  return g.level.interval === undefined ? getField(record, g.level.field) : record[g.alias];
}

function recordValues(record: Record<string, unknown>, measures: readonly PivotMeasure<any>[]): unknown[] {
  return measures.map((m, k) => (m.type === 'count' ? record._n : (record[`_m${k}`] ?? null)));
}

function recordsOf(body: unknown): Record<string, unknown>[] {
  const value = (body as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) throw DataError.create('MJD104', { operation: 'load', details: body }, 'no "value" array');
  return value;
}

function countOf(body: unknown): number {
  const count = Number((body as Record<string, unknown> | null)?.['@odata.count']);
  if (!Number.isFinite(count)) throw DataError.create('MJD104', { operation: 'load', details: body }, 'no "@odata.count"');
  return count;
}

// A key as one answer writes it, to find the same member in another answer.
function keyText(key: unknown): string {
  return JSON.stringify(key ?? null);
}

// `$skip` and `$top` of the members from `from` up to `to`.
function pageOf(from: number, to: number): Record<string, string> {
  return { ...(from > 0 ? { $skip: String(from) } : {}), ...(to !== Infinity ? { $top: String(to - from) } : {}) };
}

// A value a measure orders by, as memory ranks it: numbers and dates; anything else has none.
function rankOf(value: unknown): number | null {
  return typeof value === 'number' ? value : value instanceof Date ? value.getTime() : null;
}

// Whether a member of value `m` comes before the empty member of value `v`: by value, and before it on a tie.
function summaryBefore(m: number | null, v: number | null, dir: 'asc' | 'desc'): boolean {
  if (m === null || v === null) return false;
  return m === v || (dir === 'desc' ? m > v : m < v);
}

function byLength(paths: readonly (readonly unknown[])[]): Map<number, (readonly unknown[])[]> {
  const out = new Map<number, (readonly unknown[])[]>();
  for (const path of paths) {
    const list = out.get(path.length);
    if (list) list.push(path);
    else out.set(path.length, [path]);
  }
  return out;
}

function intervalText(level: PivotLevel<any>): string {
  if (level.interval === undefined) throw new TypeError('no OData function groups without an interval');
  return intervalPath(odataPath(level.field), level.interval);
}

function keyType(level: PivotLevel<any>, key: unknown, fields: Readonly<Record<string, FieldType>>): FieldType {
  if (level.interval === 'date') return 'date';
  if (level.interval !== undefined) return 'number';
  return fields[level.field] ?? fieldTypeOf(key);
}
