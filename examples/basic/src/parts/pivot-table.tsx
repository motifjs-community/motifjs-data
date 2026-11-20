import type { data } from '@motifx-community/data';

type Column = { member: data.PivotMember; total: boolean };

const keyOf = (member: data.PivotMember) => JSON.stringify(member.path);

/**
 * A pivot result as a table: row members down the side (indented by level), column members across the top in one or
 * two header rows, a cell per crossing, totals last. A member above the last level opens and closes with its button.
 */
export function PivotTable(props: {
  result: () => data.PivotLoadResult | null;
  rowLevels: number;
  /** One or two. */
  columnLevels: number;
  /** The measure shown in the cells, by its place in the pivot's `measures`. */
  measure: () => number;
  corner: string;
  keyText: (axis: 'row' | 'column', member: data.PivotMember) => string;
  valueText: (value: unknown) => string;
  onRow: (member: data.PivotMember) => void;
  onColumn: (member: data.PivotMember) => void;
}) {
  // The grand total has no key; a member of the last level does not open.
  const toggle = (axis: 'row' | 'column', member: data.PivotMember, levels: number) => {
    if (member.path.length === 0) return <span>Total</span>;
    const text = props.keyText(axis, member);
    if (member.path.length >= levels) return <span>{text}</span>;
    const open = !!member.children;
    return (
      <button type="button" class="demo-pivot-toggle" aria-expanded={String(open)} onclick={() => (axis === 'row' ? props.onRow(member) : props.onColumn(member))}>
        {`${open ? '▾' : '▸'} ${text}`}
      </button>
    );
  };

  const table = (result: data.PivotLoadResult) => {
    const rows: data.PivotMember[] = [];
    const walk = (list: readonly data.PivotMember[]) => {
      for (const member of list) {
        rows.push(member);
        if (member.children) walk(member.children);
      }
    };
    walk(result.rows.children ?? []);
    rows.push(result.rows);
    const tops = result.columns.children ?? [];
    const columns: Column[] = [];
    for (const member of tops) {
      for (const child of member.children ?? []) columns.push({ member: child, total: false });
      columns.push({ member, total: !!member.children });
    }
    columns.push({ member: result.columns, total: true });
    const two = props.columnLevels > 1;
    const measure = props.measure();
    return (
      <table class="demo-table demo-pivot">
        <thead>
          <tr>
            <th rowspan={two ? 2 : 1}>{props.corner}</th>
            {tops.map((member) => (
              <th key={keyOf(member)} colspan={member.children ? member.children.length + 1 : 1} rowspan={two && !member.children ? 2 : 1} class={member.children ? 'is-group' : 'is-number'}>
                {toggle('column', member, props.columnLevels)}
              </th>
            ))}
            <th rowspan={two ? 2 : 1} class="is-number">
              Total
            </th>
          </tr>
          {two ? (
            <tr>
              {columns
                .filter((c) => c.member.path.length === 2 || (c.total && c.member.path.length === 1))
                .map((c) => (
                  <th key={keyOf(c.member)} class="is-number">
                    {c.total ? `${props.keyText('column', c.member)} total` : props.keyText('column', c.member)}
                  </th>
                ))}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} class={row.path.length === 0 ? 'is-total' : row.children ? 'is-open' : ''}>
              <th scope="row" style={`padding-inline-start: ${0.5 + Math.max(0, row.path.length - 1)}rem`}>
                {toggle('row', row, props.rowLevels)}
                <span class="demo-muted">{` ${props.valueText(row.count)}`}</span>
              </th>
              {columns.map((c) => (
                <td key={keyOf(c.member)} class={c.total ? 'is-number is-total' : 'is-number'}>
                  {props.valueText(result.values(row, c.member)?.[measure])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  // A function call in a JSX child is bound as a method: the table is built again whenever the result or the measure changes.
  const drawn = (result: data.PivotLoadResult | null) => (result ? table(result) : null);
  return <div class="demo-pivot-wrap">{() => drawn(props.result())}</div>;
}
