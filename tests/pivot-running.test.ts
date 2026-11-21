import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, pivotCells } = data;

type Sale = { id: number; region: string | null; city: string; day: string; amount: number | null };

const sales: Sale[] = [
  { id: 1, region: 'North', city: 'Oslo', day: '2023-11-02', amount: 100 },
  { id: 2, region: 'north', city: 'Bergen', day: '2024-01-15', amount: 50 },
  { id: 3, region: 'South', city: 'Rome', day: '2024-02-01', amount: 30 },
  { id: 4, region: 'South', city: 'Rome', day: '2024-07-04', amount: null },
  { id: 5, region: null, city: 'Nowhere', day: '2023-05-05', amount: 20 },
  { id: 6, region: 'South', city: 'Milan', day: '2023-12-31', amount: 10 },
  { id: 7, region: 'East', city: 'Kyiv', day: '2024-03-03', amount: 70 },
];
const region = { field: 'region' } as const;
const city = { field: 'city' } as const;
const year = { field: 'day', interval: 'year' } as const;
const sum = { type: 'sum', field: 'amount' } as const;

/** A backend that computes the parts of pivots but no running totals: the adapter adds them up. */
class Server extends ArrayAdapter<Sale, number> {
  readonly asked: string[] = [];
  constructor() {
    super({ data: sales, key: 'id', fields: { day: 'date' } });
  }
  protected override backendCapabilities(): data.Capabilities {
    return { ...super.backendCapabilities(), pivot: true, pivotWindow: true };
  }
  protected override async loadPivotMemberSlices(o: data.PivotMembersOptions<Sale>): Promise<unknown> {
    this.asked.push(`members ${JSON.stringify(o.slices[0].parent)}`);
    return JSON.parse(JSON.stringify(data.pivotMembers(sales, o, this.evaluateContext)));
  }
  protected override async loadPivotCellGroups(o: data.PivotCellsOptions<Sale>): Promise<unknown> {
    this.asked.push(`cells ${o.rowPaths.length}x${o.columnPaths.length}${o.running ? ' running' : ''}`);
    const r = pivotCells(sales, o, this.evaluateContext);
    return o.rowPaths.flatMap((rows) => o.columnPaths.filter((columns) => r.count(rows, columns) > 0).map((columns) => ({ rows, columns, count: r.count(rows, columns), values: r.values(rows, columns) })));
  }
}

const options = (running: data.PivotRunningTotal<Sale>[], rowPaths: unknown[][], columnPaths: unknown[][] = [[], [2024]]): data.PivotCellsOptions<Sale> => ({
  rows: [region, city],
  columns: [year],
  measures: [sum],
  rowPaths,
  columnPaths,
  running,
});

describe('running totals of pivot cells', () => {
  it("adds up a measure over a member's siblings in their order, up to it, where it crosses each column", async () => {
    const adapter = new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' } });
    const r = await adapter.loadPivotCells(options([{ measure: 0, axis: 'rows' }], [['South', 'Milan'], ['South', 'Rome'], ['north', 'Oslo'], ['South'], []]));
    const at = (row: unknown[], column: unknown[]) => r.running!(row, column)?.[0];
    // South: Milan 10, Rome 30 (none in 2024 for Milan); North: Bergen 50 (2024), Oslo 100 (2023).
    expect([at(['South', 'Milan'], []), at(['South', 'Rome'], []), at(['South', 'Milan'], [2024]), at(['South', 'Rome'], [2024])]).toEqual([10, 40, null, 30]);
    expect([at(['north', 'Oslo'], []), at(['North', 'Oslo'], [2024])]).toEqual([150, 50]);
    // The regions in their order, East, North, South, the empty one last; the grand total is its own value.
    expect([at(['South'], []), at(['South'], [2024]), at([], []), at([], [2024])]).toEqual([260, 150, 280, 150]);
    expect(r.values(['South'], [])).toEqual([40]);
  });

  it('adds up along the columns, and in the order of a measure', async () => {
    const adapter = new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' } });
    const across = await adapter.loadPivotCells(options([{ measure: 0, axis: 'columns' }], [['North']], [[2023], [2024], []]));
    expect([across.running!(['North'], [2023]), across.running!(['North'], [2024]), across.running!(['North'], [])]).toEqual([[100], [150], [150]]);
    // By the sum of the regions: the empty one 20, South 40, East 70, North 150.
    const bySum = await adapter.loadPivotCells(options([{ measure: 0, axis: 'rows', orders: [{ measure: 0 }] }], [['South'], ['North']], [[]]));
    expect([bySum.running!(['South'], [])?.[0], bySum.running!(['North'], [])?.[0]]).toEqual([60, 280]);
  });

  it('reads the siblings in order and their values where a backend gives no running totals', async () => {
    const server = new Server();
    const r = await server.loadPivotCells(options([{ measure: 0, axis: 'rows' }], [['South', 'Rome'], ['South']], [[2024]]));
    expect([r.running!(['South', 'Rome'], [2024]), r.running!(['South'], [2024])]).toEqual([[30], [150]]);
    expect(server.asked).toEqual(['cells 2x1 running', 'members ["South"]', 'members []', 'cells 2x1', 'cells 4x1']);
  });

  it('takes the running totals a backend gives, crossings no row falls in among them', async () => {
    class Answering extends Server {
      protected override async loadPivotCellGroups(o: data.PivotCellsOptions<Sale>): Promise<unknown> {
        this.asked.push(`cells ${o.rowPaths.length}x${o.columnPaths.length}${o.running ? ' running' : ''}`);
        return JSON.parse(JSON.stringify(data.pivotCellGroups(sales, o, this.evaluateContext)));
      }
    }
    const server = new Answering();
    const r = await server.loadPivotCells(options([{ measure: 0, axis: 'rows' }], [['South', 'Milan'], ['South', 'Rome']], [[2024]]));
    // Milan has no row in 2024: no value, and nothing added up yet.
    expect([r.values(['South', 'Milan'], [2024]), r.running!(['South', 'Milan'], [2024]), r.running!(['South', 'Rome'], [2024]), r.count(['South', 'Rome'], [2024])]).toEqual([undefined, [null], [30], 2]);
    expect(server.asked).toEqual(['cells 2x1 running']);
  });

  it('checks the running totals asked for', async () => {
    const adapter = new ArrayAdapter<Sale, number>({ data: sales, key: 'id' });
    await expect(adapter.loadPivotCells(options([{ measure: 1, axis: 'rows' }], [[]]))).rejects.toMatchObject({ code: 'MJD302' });
    await expect(adapter.loadPivotCells(options([{ measure: 0, axis: 'down' as 'rows' }], [[]]))).rejects.toMatchObject({ code: 'MJD302' });
  });
});
