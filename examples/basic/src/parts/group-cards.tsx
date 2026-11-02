import type { data } from '@motifx-community/data';

/** Groups as cards: the key, the row count, the group summary and the first rows. */
export function GroupCards<T>(props: {
  groups: () => readonly data.RowGroup<T>[];
  summary: (group: data.RowGroup<T>) => string;
  row: (row: T) => string;
  rowKey: (row: T) => string | number;
}) {
  const shown = 3;
  return (
    <div class="demo-groups">
      {() =>
        props.groups().map((group) => (
          <section key={String(group.key)} class="demo-group-card">
            <h3>
              <span>{group.key === null ? '(empty)' : String(group.key)}</span>
              <span class="demo-muted">{`${group.count.toLocaleString('en-US')} rows · ${props.summary(group)}`}</span>
            </h3>
            <ul>
              {(group.items ?? []).slice(0, shown).map((row) => (
                <li key={props.rowKey(row)}>{props.row(row)}</li>
              ))}
            </ul>
            <p class="demo-muted" x-wait={() => group.count <= shown}>{`+ ${(group.count - shown).toLocaleString('en-US')} more`}</p>
          </section>
        ))
      }
    </div>
  );
}

