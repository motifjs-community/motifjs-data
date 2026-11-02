import { Disposable, DisposableStore, Emitter, type Event as MotifEvent } from '@motifx/core';
import type { DataAdapter } from '../adapter/data-adapter';
import { splitLoad } from '../adapter/load-split';
import type { PushedChange } from '../adapter/pushed-change';
import { DataError, isAbortError } from '../errors/data-error';
import { and, or, where } from '../query/filter-builders';
import type { FilterExpression } from '../query/filter-expression';
import type { GroupItem } from '../query/group-item';
import { queryArray } from '../query/local-query';
import type { EvaluateContext } from '../query/evaluate-context';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { RowGroup } from '../query/row-group';
import { createRowFilter } from '../query/row-filter';
import { sortRows } from '../query/sort';
import { summarize } from '../query/summaries';
import type { SortItem } from '../query/sort-item';
import type { SummaryItem } from '../query/summary-item';
import type { DataSourceChange } from './data-source-change';
import type { DataSourceOptions } from './data-source-options';
import type { DataSourceQuery } from './data-source-query';
import type { DataSourceStatus } from './data-source-status';
import type { LoadMode } from './load-mode';
import type { LoadRangeOptions } from './load-range-options';
import { RowBlocks } from './row-blocks';

/**
 * The rows a component shows (a grid, a combo box, a lookup), loaded through an adapter: all at once,
 * a page at a time, or in blocks where the view is. It holds the query (filter, sort, search, groups,
 * summaries), applies changes the adapter reports to the loaded rows, and tells every change through
 * `onChanged`. Loads never reject: a failure sets `status` to `'error'` and `error`.
 */
export class DataSource<T = Record<string, unknown>, K = unknown> extends Disposable {
  readonly adapter: DataAdapter<T, K>;
  readonly loadMode: LoadMode;
  private readonly options: DataSourceOptions<T, K>;
  private readonly disposables = new DisposableStore();
  private readonly changedEmitter = this.disposables.add(new Emitter<DataSourceChange<T>>());
  private readonly blocks: RowBlocks<T> | null;
  private currentFilter: FilterExpression | null;
  private currentSort: readonly SortItem[];
  private currentGroup: readonly GroupItem[];
  private currentSearch = '';
  private currentParams: Readonly<Record<string, unknown>> | undefined;
  private currentStatus: DataSourceStatus = 'idle';
  private lastError: DataError | null = null;
  /** `'all'` and `'page'`: the loaded rows. */
  private loaded: T[] = [];
  private page = 0;
  /** Rows of a page or a block; 0 in `'page'`: one page with every row. */
  private size: number;
  /** `'page'`: the page whose rows `loaded` holds. */
  private loadedPage = -1;
  /** `'all'`: the rows are those of the query before, kept while the new ones load. */
  private rowsOutOfDate = false;
  private totalCount: number | undefined;
  private loadedGroups: RowGroup<T>[] = [];
  private loadedGroupCount: number | undefined;
  /** `'page'` with a query the adapter cannot do all of: every matching row, loaded once per row set. */
  private matchingRows: T[] | null = null;
  private matchingLoad: Promise<T[]> | undefined;
  private matchingController: AbortController | undefined;
  private summaryValues: unknown[] = [];
  private summaryGeneration = 0;
  private summaryController: AbortController | undefined;
  private generation = 0;
  private controller: AbortController | undefined;
  /** Rows found with `byKey` that were not loaded. */
  private readonly found = new Map<string, T>();
  private keyIndex: Map<string, { row: T; index: number }> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onChanged: MotifEvent<DataSourceChange<T>> = this.changedEmitter.event;

  constructor(options: DataSourceOptions<T, K>) {
    super();
    this.options = options;
    this.adapter = options.adapter;
    this.loadMode = options.loadMode ?? 'page';
    this.size = Math.max(1, Math.floor(options.pageSize ?? (this.loadMode === 'blocks' ? 50 : 20)));
    this.currentFilter = options.filter ?? null;
    this.currentSort = [...(options.sort ?? [])];
    this.currentGroup = [...(options.group ?? [])];
    this.currentParams = options.params;
    this.checkGroup(this.currentGroup);
    this.blocks =
      this.loadMode === 'blocks'
        ? new RowBlocks<T>({
            blockSize: this.pageSize,
            cacheBlocks: Math.max(4, options.cacheBlocks ?? 40),
            scrollStopMs: options.scrollStopMs ?? 120,
            jumpRows: Math.max(0, options.jumpRows ?? this.pageSize),
            nearBlocks: Math.max(0, Math.floor(options.nearBlocks ?? 1)),
            count: options.count !== false,
            load: (skip, take, count, signal) => this.adapter.load({ ...this.loadOptions(), skip, take, count, signal }),
            loaded: () => this.blockLoaded(),
            failed: (error, beforeTotal) => this.blockFailed(error, beforeTotal),
          })
        : null;
    this.disposables.add(this.adapter.onChanged((e) => this.applyChanges(e.changes)));
  }

  get status(): DataSourceStatus {
    return this.currentStatus;
  }

  /** Rows of a page (`'page'`) or of a block (`'blocks'`); 0: one page with every row. */
  get pageSize(): number {
    return this.size;
  }

  get error(): DataError | null {
    return this.lastError;
  }

  /** Rows matching the query; `undefined` until known. */
  get total(): number | undefined {
    return this.blocks ? this.blocks.total : this.totalCount;
  }

  /** `'all'`: every row; `'page'`: the rows of the page; with `group`, in group order. `'blocks'` reads rows with `rowAt`. */
  get rows(): readonly T[] {
    return this.loaded;
  }

  /** With `group`: the groups of every row (`'all'`) or of the page (`'page'`). */
  get groups(): readonly RowGroup<T>[] {
    return this.loadedGroups;
  }

  /** With `group`: the number of top-level groups. */
  get groupCount(): number | undefined {
    return this.loadedGroupCount;
  }

  /** Values of the `summary` option, in order, over every matching row. */
  get summary(): readonly unknown[] {
    return this.summaryValues;
  }

  /** `'page'`: the page asked for; its rows are in `rows` once `loadedPageIndex` is the same. */
  get pageIndex(): number {
    return this.page;
  }

  /** `'page'`: the page whose rows `rows` holds, or -1 before one arrives. */
  get loadedPageIndex(): number {
    return this.loadedPage;
  }

  /** `undefined` while the total is not known. Grouped pages count top-level groups. */
  get pageCount(): number | undefined {
    const total = this.currentGroup.length ? this.loadedGroupCount : this.total;
    if (total === undefined) return undefined;
    return this.size > 0 ? Math.max(1, Math.ceil(total / this.size)) : 1;
  }

  get isLastPage(): boolean {
    const count = this.pageCount;
    if (count === undefined) return this.size === 0 || this.loaded.length < this.size;
    return this.page >= count - 1;
  }

  get filter(): FilterExpression | null {
    return this.currentFilter;
  }

  get sort(): readonly SortItem[] {
    return this.currentSort;
  }

  get group(): readonly GroupItem[] {
    return this.currentGroup;
  }

  get searchText(): string {
    return this.currentSearch;
  }

  get params(): Readonly<Record<string, unknown>> | undefined {
    return this.currentParams;
  }

  /** `'blocks'`: blocks that failed after the first answer; `retry()` loads them again. */
  get failedBlocks(): number {
    return this.blocks?.failed ?? 0;
  }

  /** The row at `index` of the whole result, or `undefined` while it is not loaded. */
  rowAt(index: number): T | undefined {
    if (this.blocks) return this.blocks.rowAt(index);
    return this.loaded[index - this.pageOffset()];
  }

  /** `'blocks'`: whether the block of `index` failed. */
  isFailed(index: number): boolean {
    return this.blocks?.isFailed(index) ?? false;
  }

  /** `'blocks'`: the view shows rows `first` to `end - 1`; missing blocks are loaded. `immediate` skips the wait after a jump. */
  ensure(first: number, end: number, immediate = false) {
    this.blocks?.ensure(first, end, immediate);
  }

  /** `'blocks'`: the view shows these runs of rows, `[first, end)` each, with rows between them it does not show (a list with collapsed parts). */
  ensureRanges(ranges: readonly (readonly [number, number])[], immediate = false) {
    this.blocks?.ensureRanges(ranges, immediate);
  }

  /** `'blocks'`: keeps the block of `index` (the focused row) in memory; `-1` lets it go. */
  pin(index: number) {
    this.blocks?.pin(index);
  }

  /** Every loaded row with its index in the whole result. */
  forEachLoaded(fn: (row: T, index: number) => void) {
    if (this.blocks) this.blocks.forEachRow(fn);
    else {
      const offset = this.pageOffset();
      this.loaded.forEach((row, i) => fn(row, offset + i));
    }
  }

  /** Loads the rows of the current query: all, the current page, or the blocks the view needs. */
  load(): Promise<void> {
    const summary = this.summaryWanted() ? this.loadOwnSummary() : undefined;
    if (!this.blocks) return Promise.all([this.loadRows(), summary]).then(() => undefined);
    if (this.currentStatus !== 'loading' && (this.currentStatus !== 'ready' || this.blocks.isEmpty)) this.setLoading();
    this.blocks.reload();
    return Promise.all([this.blocks.whenIdle(), summary]).then(() => undefined);
  }

  /**
   * Rows of the current query (filter, search, sort, params) from `skip`, without groups and without
   * touching the rows the source holds: for an export or a print that goes through every page.
   * Unlike `load()`, a failure rejects.
   */
  loadRange(options: LoadRangeOptions = {}): Promise<LoadResult<T>> {
    const query = this.loadOptions(false);
    const { skip, take, count, signal } = options;
    return this.adapter.load({ ...query, filter: and(query.filter, options.filter), sort: options.sort ?? query.sort, skip, take, count, signal });
  }

  /**
   * The groups of the current query (filter, search, params) by `group`: their keys and counts in every
   * level, without rows, from the adapter (which groups every matching row in memory when its backend
   * cannot). For a view that loads the rows of the groups apart, in `groupOrder`. `groupSummary` asks
   * for other summaries of each group than the source's own. A failure rejects.
   */
  async loadGroups(group: readonly GroupItem[], options: { signal?: AbortSignal; groupSummary?: readonly SummaryItem[] } = {}): Promise<RowGroup<T>[]> {
    if (!group.length) return [];
    const { filter, params, expand } = this.loadOptions(false);
    const groupSummary = options.groupSummary ?? this.options.groupSummary;
    const result = await this.adapter.load({ filter, params, expand, group, groupsOnly: true, groupSummary, signal: options.signal });
    return result.groups ?? [];
  }

  /**
   * Summary values of the current query (filter, search, params) over every matching row, for these
   * items rather than the source's own, from the adapter (which loads every matching row and computes
   * them in memory when its backend cannot). The rows the source holds stay as they are. A failure rejects.
   */
  async loadSummary(items: readonly SummaryItem[], options: { signal?: AbortSignal } = {}): Promise<unknown[]> {
    if (!items.length) return [];
    const { filter, params, expand } = this.loadOptions(false);
    const result = await this.adapter.load({ filter, params, expand, summary: items, take: 0, signal: options.signal });
    return result.summary ?? [];
  }

  /** Loads the rows again, keeping the page or the view. Until they arrive, `'all'` and `'page'` keep the old ones. */
  reload(): Promise<void> {
    this.dropMatching();
    this.found.clear();
    this.keyIndex = null;
    this.blocks?.clear(false);
    this.fire('reload');
    return this.load();
  }

  /** Loads what failed again. */
  retry(): Promise<void> {
    if (!this.blocks || this.currentStatus === 'error') return this.reload();
    this.blocks.retry();
    return this.blocks.whenIdle();
  }

  /** `'page'`: goes to a page and loads it. */
  setPage(index: number): Promise<void> {
    const count = this.pageCount;
    const page = Math.max(0, Math.min(Math.floor(index), count === undefined ? Infinity : count - 1));
    if (this.loadMode !== 'page' || (page === this.page && this.currentStatus === 'ready')) return Promise.resolve();
    this.page = page;
    return this.loadRows();
  }

  /**
   * `'page'`: another page size, 0 for one page with every row; the rows held go, and the first
   * page loads. `'all'` keeps the number for whoever pages its rows. A block size is fixed.
   */
  setPageSize(size: number): Promise<void> {
    if (this.loadMode === 'blocks') throw DataError.create('MJD302', { operation: 'load' }, 'the size of a block is fixed');
    const next = Math.max(0, Math.floor(size));
    if (next === this.size) return Promise.resolve();
    this.size = next;
    if (this.loadMode !== 'page') return Promise.resolve();
    this.page = 0;
    if (this.currentStatus === 'idle') return Promise.resolve();
    this.clearRows();
    this.fire('cleared');
    return this.loadRows();
  }

  setGroup(group: readonly GroupItem[]): Promise<void> {
    return this.setQuery({ group });
  }

  setFilter(filter: FilterExpression | null): Promise<void> {
    return this.setQuery({ filter });
  }

  setSort(sort: readonly SortItem[]): Promise<void> {
    return this.setQuery({ sort });
  }

  /** Keeps the rows where one of `searchFields` holds the text (`searchOperator`); an empty text keeps every row. */
  search(text: string): Promise<void> {
    return this.setQuery({ searchText: text });
  }

  setParams(params: Readonly<Record<string, unknown>> | undefined): Promise<void> {
    return this.setQuery({ params });
  }

  /** Changes several parts of the query, then loads once from the start. */
  setQuery(query: DataSourceQuery): Promise<void> {
    if ('searchText' in query && query.searchText && !this.options.searchFields?.length) {
      throw DataError.create('MJD302', { operation: 'load' }, 'search needs the searchFields option');
    }
    if (query.group) this.checkGroup(query.group);
    if ('filter' in query) this.currentFilter = query.filter ?? null;
    if (query.sort) this.currentSort = query.sort.map((s) => ({ ...s }));
    if (query.group) this.currentGroup = query.group.map((g) => ({ ...g }));
    if ('searchText' in query) this.currentSearch = query.searchText ?? '';
    if ('params' in query) this.currentParams = query.params;
    // Sort and groups keep the same rows.
    if ('filter' in query || 'searchText' in query || 'params' in query) this.dropMatching();
    this.page = 0;
    this.fire('query');
    if (this.loadMode === 'all' && this.options.keepRowsWhileLoading !== false) {
      this.rowsOutOfDate = this.currentStatus !== 'idle';
    } else {
      this.clearRows();
      this.blocks?.clear(true);
      this.fire('cleared');
    }
    return this.load();
  }

  /** The row with this key: among the loaded rows, the rows found before, or from the adapter. */
  async byKey(key: K): Promise<T | undefined> {
    const known = this.rowByKey(key);
    if (known) return known;
    const row = await this.adapter.byKey(key);
    if (row) this.found.set(this.adapter.keyString(key), row);
    return row;
  }

  /** The row with this key among the loaded rows and the rows found before, without a request. */
  rowByKey(key: K): T | undefined {
    const id = this.adapter.keyString(key);
    return this.loadedByKey().get(id)?.row ?? this.found.get(id);
  }

  /** Index of the loaded row with this key in the whole result, or -1. */
  indexOfKey(key: K): number {
    return this.loadedByKey().get(this.adapter.keyString(key))?.index ?? -1;
  }

  override dispose() {
    this.generation++;
    this.controller?.abort();
    this.summaryController?.abort();
    this.matchingController?.abort();
    clearTimeout(this.reloadTimer);
    this.blocks?.dispose();
    this.disposables.dispose();
    super.dispose();
  }

  private async loadRows(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.setLoading();
    const paged = this.loadMode === 'page';
    const page = this.page;
    const size = this.size;
    const skip = page * size;
    const count = paged && this.options.count !== false;
    try {
      // A page asks for its rows, and `'all'` gets the summaries with them. A page that would bring
      // every matching row waits for the kept ones; once those are here, every page comes from them.
      const scope = paged ? { skip, take: size > 0 ? size : undefined, count } : { summary: this.options.summary };
      const options = { ...this.loadOptions(), ...scope };
      const matching = this.matchingRows ?? (this.needsEveryRow(options) ? await this.matching() : null);
      const result = matching ? null : await this.adapter.load({ ...options, signal: controller.signal });
      if (generation !== this.generation) return;
      this.controller = undefined;
      if (matching) this.showMatching(matching);
      else if (result) {
        this.loaded = result.rows;
        this.loadedPage = paged ? page : -1;
        this.loadedGroups = result.groups ?? [];
        this.loadedGroupCount = paged ? result.groupCount : result.groups?.length;
        if (this.loadMode === 'all' && this.options.summary?.length) this.summaryValues = result.summary ?? [];
        this.keyIndex = null;
        // Without a count, a short page still tells where the end is.
        this.totalCount = !paged || size === 0 ? (count ? result.total : result.rows.length) : count ? result.total : result.rows.length < size ? skip + result.rows.length : undefined;
      }
      this.rowsOutOfDate = false;
      this.currentStatus = 'ready';
      this.lastError = null;
      this.fire('loaded');
    } catch (error) {
      if (generation !== this.generation || isAbortError(error)) return;
      this.controller = undefined;
      // Rows kept from the query before do not stay next to its error.
      if (this.rowsOutOfDate) this.clearRows();
      this.currentStatus = 'error';
      this.lastError = DataError.from(error, 'load');
      this.fire('failed');
    }
  }

  private clearRows() {
    this.rowsOutOfDate = false;
    this.loaded = [];
    this.loadedPage = -1;
    this.totalCount = undefined;
    this.loadedGroups = [];
    this.loadedGroupCount = undefined;
    this.keyIndex = null;
  }

  private blockLoaded() {
    this.keyIndex = null;
    this.currentStatus = 'ready';
    this.lastError = null;
    this.fire('loaded');
  }

  private blockFailed(error: unknown, beforeTotal: boolean) {
    if (beforeTotal || this.currentStatus === 'loading') {
      this.currentStatus = 'error';
      this.lastError = DataError.from(error, 'load');
    }
    this.fire('failed');
  }

  private setLoading() {
    this.currentStatus = 'loading';
    this.fire('loading');
  }

  private loadOptions(withGroups = true): LoadOptions {
    const options: LoadOptions = { filter: this.queryFilter(), sort: this.currentSort };
    if (withGroups && this.currentGroup.length) {
      options.group = this.currentGroup;
      if (this.options.groupSummary?.length) options.groupSummary = this.options.groupSummary;
    }
    if (this.options.select) options.select = this.options.select;
    if (this.options.expand) options.expand = this.options.expand;
    if (this.currentParams) options.params = this.currentParams;
    return options;
  }

  private queryFilter(): FilterExpression | null {
    const fields = this.options.searchFields ?? [];
    if (!this.currentSearch || !fields.length) return this.currentFilter;
    const operator = this.options.searchOperator ?? 'contains';
    return and(this.currentFilter, or(...fields.map((field) => where(field, operator, this.currentSearch))));
  }

  private loadedByKey(): Map<string, { row: T; index: number }> {
    if (!this.keyIndex) {
      const index = new Map<string, { row: T; index: number }>();
      this.forEachLoaded((row, at) => index.set(this.adapter.keyString(this.adapter.keyOf(row)), { row, index: at }));
      this.keyIndex = index;
    }
    return this.keyIndex;
  }

  // Changes the adapter saved or was told about (`push`), applied to the loaded rows.
  private applyChanges(changes: readonly PushedChange<T, K>[]) {
    if (this.currentStatus === 'idle') return;
    // Without keys the rows cannot be matched.
    if (!this.adapter.keys.isSet) {
      this.reloadSoon();
      return;
    }
    if (this.matchingRows) {
      this.applyToMatching(this.matchingRows, changes);
      return;
    }
    // In blocks, a row coming or going moves every later row: the blocks load again.
    if (this.blocks && changes.some((c) => c.type !== 'update')) this.reloadSoon();
    const changed: T[] = [];
    let reshaped = false;
    for (const change of changes) {
      const id = this.adapter.keyString(change.key);
      if (change.type === 'update') {
        const row = this.loadedByKey().get(id)?.row ?? this.found.get(id);
        if (!row) continue;
        if (change.data && change.data !== row) Object.assign(row as object, change.data);
        changed.push(row);
      } else if (change.type === 'remove') {
        this.found.delete(id);
        if (!this.blocks) reshaped = this.removeLoaded(id) || reshaped;
      } else if (!this.blocks && change.data) {
        reshaped = this.insertLoaded(change.data as T) || reshaped;
      }
    }
    if (!changed.length && !reshaped) return;
    if (this.currentGroup.length || this.options.summary?.length) {
      if (this.loadMode === 'all') this.regroup();
      else this.reloadSoon();
    }
    this.fire('rows', changed);
  }

  // Every matching row is here: changes go into them and the page is made again, without a request.
  private applyToMatching(rows: T[], changes: readonly PushedChange<T, K>[]) {
    const matches = createRowFilter<T>(this.queryFilter(), this.context());
    const changed: T[] = [];
    let reshaped = false;
    for (const change of changes) {
      const id = this.adapter.keyString(change.key);
      const at = rows.findIndex((row) => this.adapter.keyString(this.adapter.keyOf(row)) === id);
      if (change.type === 'update') {
        if (at < 0) continue;
        if (change.data && change.data !== rows[at]) Object.assign(rows[at] as object, change.data);
        changed.push(rows[at]);
      } else if (change.type === 'remove') {
        this.found.delete(id);
        if (at >= 0) rows.splice(at, 1);
        reshaped = reshaped || at >= 0;
      } else if (at < 0 && change.data && matches(change.data as T)) {
        rows.push(change.data as T);
        reshaped = true;
      }
    }
    if (!changed.length && !reshaped) return;
    this.showMatching(rows);
    if (this.options.summary?.length) this.summaryValues = summarize(rows, this.options.summary, this.context());
    this.fire('rows', changed);
  }

  private removeLoaded(id: string): boolean {
    const at = this.loaded.findIndex((row) => this.adapter.keyString(this.adapter.keyOf(row)) === id);
    if (at < 0) return false;
    this.loaded.splice(at, 1);
    if (this.totalCount !== undefined) this.totalCount--;
    this.keyIndex = null;
    return true;
  }

  // `'all'`: a new row that matches the query takes its place in the order. `'page'`: only the total changes.
  private insertLoaded(row: T): boolean {
    const context = this.context();
    if (!createRowFilter<T>(this.queryFilter(), context)(row)) return false;
    if (this.totalCount !== undefined) this.totalCount++;
    if (this.loadMode === 'all') {
      this.loaded.push(row);
      if (this.currentSort.length && !this.currentGroup.length) this.loaded = sortRows(this.loaded, this.currentSort, context);
      this.keyIndex = null;
    }
    return true;
  }

  private reloadSoon() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.reload(), 0);
  }

  // Totals of `'page'` and `'blocks'` load apart, once per query: a page change does not ask again.
  private summaryWanted(): boolean {
    return this.loadMode !== 'all' && !!this.options.summary?.length;
  }

  private async loadOwnSummary(): Promise<void> {
    this.summaryController?.abort();
    const controller = new AbortController();
    this.summaryController = controller;
    const generation = ++this.summaryGeneration;
    try {
      const options = { ...this.loadOptions(false), summary: this.options.summary, take: 0 };
      const rows = this.matchingRows ?? (this.needsEveryRow(options) ? await this.matching() : null);
      const values = rows ? summarize(rows, this.options.summary!, this.context()) : ((await this.adapter.load({ ...options, signal: controller.signal })).summary ?? []);
      if (generation !== this.summaryGeneration) return;
      this.summaryValues = values;
      this.fire('summary');
    } catch (error) {
      if (generation !== this.summaryGeneration || isAbortError(error)) return;
      this.summaryValues = [];
      this.lastError = DataError.from(error, 'load');
      this.fire('failed');
    }
  }

  // `'page'`: the adapter cannot do all of this load (filter, sort, paging, groups, summaries), so it
  // would bring every matching row and page them in memory.
  private needsEveryRow(options: LoadOptions): boolean {
    return this.loadMode === 'page' && splitLoad(options, this.adapter.capabilities).local.take !== undefined;
  }

  // Every matching row, loaded once per row set: sort, groups and pages change without a request.
  private matching(): Promise<T[]> {
    if (this.matchingLoad) return this.matchingLoad;
    const controller = new AbortController();
    this.matchingController = controller;
    // Groups and summaries may need fields the selection leaves out; the order is made in memory.
    const options = this.loadOptions(false);
    delete options.select;
    delete options.sort;
    const load = this.adapter.load({ ...options, signal: controller.signal }).then(
      (result) => {
        if (this.matchingLoad === load) this.matchingRows = result.rows;
        return result.rows;
      },
      (error: unknown) => {
        if (this.matchingLoad === load) this.matchingLoad = undefined;
        throw error;
      },
    );
    this.matchingLoad = load;
    return load;
  }

  private dropMatching() {
    this.matchingController?.abort();
    this.matchingLoad = undefined;
    this.matchingRows = null;
  }

  // A page made from every matching row.
  private showMatching(rows: readonly T[]) {
    const { sort, group, groupSummary, select } = this.loadOptions();
    const options = { sort, group, groupSummary, select, skip: this.page * this.size, take: this.size > 0 ? this.size : undefined, count: true };
    const result = queryArray(rows, options, this.context());
    this.loaded = result.rows;
    this.loadedPage = this.page;
    this.loadedGroups = result.groups ?? [];
    this.loadedGroupCount = result.groupCount;
    this.totalCount = result.total;
    this.keyIndex = null;
  }

  // `'all'`: groups and summaries follow the loaded rows after a change.
  private regroup() {
    const result = queryArray(
      this.loaded,
      { sort: this.currentSort, group: this.currentGroup.length ? this.currentGroup : undefined, groupSummary: this.options.groupSummary, summary: this.options.summary, count: true },
      this.context(),
    );
    this.loaded = result.rows;
    this.loadedGroups = result.groups ?? [];
    this.loadedGroupCount = result.groupCount;
    if (this.options.summary?.length) this.summaryValues = result.summary ?? [];
    this.keyIndex = null;
  }

  // A grouped page starts at a group, not at a row number.
  private pageOffset(): number {
    return this.loadMode === 'page' && !this.currentGroup.length ? Math.max(0, this.loadedPage) * this.size : 0;
  }

  private context(): EvaluateContext {
    return this.adapter.evaluateContext;
  }

  private checkGroup(group: readonly GroupItem[]) {
    if (group.length && this.loadMode === 'blocks') throw DataError.create('MJD302', { operation: 'load' }, 'group works in the all and page load modes');
  }

  private fire(reason: DataSourceChange<T>['reason'], rows?: readonly T[]) {
    this.changedEmitter.fire(rows ? { reason, rows } : { reason });
  }
}
