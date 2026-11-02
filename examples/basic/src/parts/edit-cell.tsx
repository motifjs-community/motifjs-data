import type { data } from '@motifx-community/data';
import type { Follow } from '../follow';

/** An input for one field of a row, through a `ChangeTracker`; the row is committed when the value is left. */
export function EditCell<T>(props: {
  tracker: () => data.ChangeTracker<T, never>;
  row: T;
  field: string;
  follow: Follow;
  type?: 'text' | 'number';
  leave: (row: T) => void;
}) {
  const { row, field, follow } = props;
  const read = () => follow.read(() => props.tracker().getValue(row, field));
  const write = (text: string) => props.tracker().setValue(row, field, props.type === 'number' ? (text === '' ? null : Number(text)) : text);
  return (
    <span class="demo-cell">
      <input
        class={() => follow.read(() => (props.tracker().isChanged(row, field) ? 'demo-cell-input is-changed' : 'demo-cell-input'))}
        type={props.type ?? 'text'}
        value={() => String(read() ?? '')}
        oninput={(e) => write((e.target as HTMLInputElement).value)}
        onchange={() => props.leave(row)}
      />
      <small class="is-error">{() => follow.read(() => props.tracker().errorOf(row, field))}</small>
    </span>
  );
}
