import { isAbortError } from '../errors/data-error';
import type { LoadResult } from '../query/load-result';

interface Block<T> {
  index: number;
  state: 'loading' | 'ready' | 'error';
  rows: T[];
  controller?: AbortController;
  used: number;
  done: Promise<void>;
}

/**
 * Rows loaded in blocks of `blockSize`, only where the view is. Nothing the size of the whole result is
 * allocated. A move of more than one block waits until scrolling stops, so the rows passed over are never
 * requested; a block that leaves the view while loading is aborted.
 */
export class RowBlocks<T> {
  total: number | undefined;
  /** Blocks that failed after the total was known. */
  failed = 0;
  private readonly blocks = new Map<number, Block<T>>();
  // The total is asked for again after a clear; until it comes, the old one stays.
  private countWanted = true;
  private generation = 0;
  /** The rows the view shows, as ranges (`first` inclusive, `end` exclusive). */
  private wanted: { first: number; end: number }[] = [];
  private lastFirst = -1;
  private waitingForScrollStop = false;
  private pinned = -1;
  private useCounter = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly settings: {
      blockSize: number;
      cacheBlocks: number;
      scrollStopMs: number;
      /** A move of more rows than this waits until scrolling stops. */
      jumpRows: number;
      /** Blocks this close to the view keep loading and stay in the cache. */
      nearBlocks: number;
      /** Ask the first block for the total; without it a short block tells where the rows end. */
      count: boolean;
      load: (skip: number, take: number, count: boolean, signal: AbortSignal) => Promise<LoadResult<T>>;
      loaded: () => void;
      failed: (error: unknown, beforeTotal: boolean) => void;
    },
  ) {}

  /** No block is loaded or loading (after a clear). */
  get isEmpty(): boolean {
    return this.blocks.size === 0;
  }

  rowAt(index: number): T | undefined {
    const block = this.blocks.get(Math.floor(index / this.settings.blockSize));
    return block?.state === 'ready' ? block.rows[index - block.index * this.settings.blockSize] : undefined;
  }

  isFailed(index: number): boolean {
    return this.blocks.get(Math.floor(index / this.settings.blockSize))?.state === 'error';
  }

  forEachRow(fn: (row: T, index: number) => void) {
    for (const block of this.blocks.values()) {
      if (block.state === 'ready') block.rows.forEach((row, i) => fn(row, block.index * this.settings.blockSize + i));
    }
  }

  /** The view shows rows `first` to `end - 1`. `immediate` skips the wait after a jump (a jump made in code). */
  ensure(first: number, end: number, immediate = false) {
    this.ensureRanges([[first, end]], immediate);
  }

  /** The view shows these runs of rows, `[first, end)` each (rows apart, with others between them not shown). */
  ensureRanges(ranges: readonly (readonly [number, number])[], immediate = false) {
    const wanted: { first: number; end: number }[] = [];
    for (const [from, to] of ranges) {
      const first = Math.max(0, Math.floor(from));
      let end = Math.max(first + 1, Math.ceil(to));
      if (this.total !== undefined) end = Math.min(end, Math.max(first + 1, this.total));
      wanted.push({ first, end });
    }
    if (!wanted.length) return;
    this.wanted = wanted;
    const first = wanted[0].first;

    const moved = this.lastFirst < 0 ? 0 : Math.abs(first - this.lastFirst);
    const jump = !immediate && moved > this.settings.jumpRows;
    this.lastFirst = first;
    this.clearTimer();
    if (jump || (this.waitingForScrollStop && !immediate)) {
      // Each call restarts the wait, so a drag loads only where it stops.
      this.waitingForScrollStop = true;
      this.abortBlocksOutsideView();
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.waitingForScrollStop = false;
        this.loadWanted();
      }, this.settings.scrollStopMs);
    } else {
      this.waitingForScrollStop = false;
      this.loadWanted();
    }
  }

  /** Keeps the block of `index` (the focused row) in memory; `-1` lets it go. */
  pin(index: number) {
    this.pinned = index;
  }

  /** Drops every block. `fromStart` forgets the total and the view too (a new query). */
  clear(fromStart: boolean) {
    this.generation++;
    this.clearTimer();
    for (const block of this.blocks.values()) block.controller?.abort();
    this.blocks.clear();
    this.failed = 0;
    this.waitingForScrollStop = false;
    this.countWanted = true;
    if (fromStart) {
      this.total = undefined;
      this.wanted = [];
      this.lastFirst = -1;
    }
  }

  /** Loads the wanted rows again; with nothing wanted yet, the first block. */
  reload() {
    if (!this.wanted.length) this.wanted = [{ first: 0, end: this.settings.blockSize }];
    this.loadWanted();
  }

  retry() {
    for (const [index, block] of this.blocks) if (block.state === 'error') this.blocks.delete(index);
    this.failed = 0;
    this.loadWanted();
  }

  /** Settles when no block is loading. */
  async whenIdle(): Promise<void> {
    let loading = [...this.blocks.values()].filter((b) => b.state === 'loading');
    while (loading.length) {
      await Promise.all(loading.map((b) => b.done));
      loading = [...this.blocks.values()].filter((b) => b.state === 'loading');
    }
  }

  dispose() {
    this.clear(true);
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The blocks of the wanted rows, in order. */
  private wantedBlocks(): number[] {
    const size = this.settings.blockSize;
    const out = new Set<number>();
    for (const { first, end } of this.wanted) for (let b = Math.floor(first / size); b <= Math.floor((end - 1) / size); b++) out.add(b);
    return [...out].sort((a, b) => a - b);
  }

  /** Whether a block is wanted or at most `nearBlocks` away from one that is. */
  private nearView(): (index: number) => boolean {
    const wanted = this.wantedBlocks();
    const near = this.settings.nearBlocks;
    return (index) => wanted.some((b) => Math.abs(b - index) <= near);
  }

  private loadWanted() {
    for (const b of this.wantedBlocks()) {
      // The first block always loads: it brings the total again after a clear.
      if (b > 0 && this.total !== undefined && b * this.settings.blockSize >= this.total) break;
      const block = this.blocks.get(b);
      if (block) block.used = ++this.useCounter;
      else this.loadBlock(b);
    }
    this.abortBlocksOutsideView();
  }

  private abortBlocksOutsideView() {
    const near = this.nearView();
    const pinnedBlock = this.pinned >= 0 ? Math.floor(this.pinned / this.settings.blockSize) : -1;
    for (const [index, block] of this.blocks) {
      if (block.state !== 'loading' || index === pinnedBlock) continue;
      if (!near(index)) {
        block.controller?.abort();
        this.blocks.delete(index);
      }
    }
  }

  // Blocks far from the view go first, the ones used longest ago before the others.
  private discard() {
    if (this.blocks.size <= this.settings.cacheBlocks) return;
    const near = this.nearView();
    const pinnedBlock = this.pinned >= 0 ? Math.floor(this.pinned / this.settings.blockSize) : -1;
    const candidates = [...this.blocks.values()]
      .filter((b) => b.state !== 'loading' && !near(b.index) && b.index !== pinnedBlock)
      .sort((a, b) => a.used - b.used);
    for (const block of candidates) {
      if (this.blocks.size <= this.settings.cacheBlocks) break;
      this.blocks.delete(block.index);
    }
  }

  /** Where the rows end when block `index` came back with `count` rows and no total; `undefined` while that is not known. */
  private endFrom(index: number, count: number): number | undefined {
    const size = this.settings.blockSize;
    if (count >= size) return undefined;
    // An empty block ends the rows only right after a full one (or at the start).
    if (count === 0 && index > 0) {
      const before = this.blocks.get(index - 1);
      if (before?.state !== 'ready' || before.rows.length < size) return undefined;
    }
    return index * size + count;
  }

  private loadBlock(index: number) {
    const size = this.settings.blockSize;
    const controller = new AbortController();
    const generation = this.generation;
    const block: Block<T> = { index, state: 'loading', rows: [], controller, used: ++this.useCounter, done: Promise.resolve() };
    this.blocks.set(index, block);
    const current = () => generation === this.generation && this.blocks.get(index) === block;

    block.done = this.settings.load(index * size, size, this.countWanted && this.settings.count, controller.signal).then(
      (result) => {
        if (!current() || controller.signal.aborted) return;
        block.rows = result.rows;
        block.state = 'ready';
        block.controller = undefined;
        if (result.total !== undefined) {
          this.total = result.total;
          this.countWanted = false;
        } else if (this.total === undefined) this.total = this.endFrom(index, result.rows.length);
        this.discard();
        this.settings.loaded();
      },
      (error) => {
        if (!current()) return;
        if (controller.signal.aborted || isAbortError(error)) {
          this.blocks.delete(index);
          return;
        }
        block.state = 'error';
        block.controller = undefined;
        // Before the first answer: no total and no block loaded yet.
        const beforeTotal = this.total === undefined && ![...this.blocks.values()].some((b) => b.state === 'ready');
        if (!beforeTotal) this.failed++;
        this.settings.failed(error, beforeTotal);
      },
    );
  }
}
