import type { data } from '@motifx-community/data';
import type { Follow } from '../follow';

/** A column header that sorts: none → ascending → descending → none. */
export function SortHeader(props: { source: data.DataSource<never, never>; follow: Follow; field: string; title: string; numeric?: boolean }) {
  const { source, follow, field } = props;
  const dir = () => follow.read(() => source.sort.find((s) => s.field === field)?.dir);
  const toggle = () => {
    const next = dir() === undefined ? 'asc' : dir() === 'asc' ? 'desc' : null;
    void source.setSort(next ? [{ field, dir: next }] : []);
  };
  return (
    <th class={props.numeric ? 'is-number' : ''} aria-sort={() => (dir() === 'asc' ? 'ascending' : dir() === 'desc' ? 'descending' : 'none')}>
      <button type="button" class="demo-sort" onclick={toggle}>
        {props.title}
        <span aria-hidden="true">{() => (dir() === 'asc' ? ' ▲' : dir() === 'desc' ? ' ▼' : '')}</span>
      </button>
    </th>
  );
}
