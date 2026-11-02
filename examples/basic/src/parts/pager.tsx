import type { data } from '@motifx-community/data';
import type { Follow } from '../follow';

/** Previous / next for a `DataSource` in `'page'` mode. */
export function Pager(props: { source: data.DataSource<never, never>; follow: Follow }) {
  const { source, follow } = props;
  return (
    <div class="demo-pager">
      <button type="button" class="demo-chip" disabled={() => follow.read(() => source.pageIndex === 0)} onclick={() => void source.setPage(source.pageIndex - 1)}>
        ‹ Previous
      </button>
      <span>{() => follow.read(() => `Page ${source.pageIndex + 1} of ${source.pageCount ?? '…'}`)}</span>
      <button type="button" class="demo-chip" disabled={() => follow.read(() => source.isLastPage)} onclick={() => void source.setPage(source.pageIndex + 1)}>
        Next ›
      </button>
    </div>
  );
}
