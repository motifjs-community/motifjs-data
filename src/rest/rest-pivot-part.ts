import type { PivotBlocksOptions } from '../query/pivot-blocks-options';
import type { PivotCellsOptions } from '../query/pivot-cells-options';
import type { PivotCountsOptions } from '../query/pivot-counts-options';
import type { PivotMembersOptions } from '../query/pivot-members-options';

/** A part of a pivot a view loads as it scrolls, as a pivot endpoint is asked for it (`kind` in the body). */
export type RestPivotPart = 'members' | 'counts' | 'cells' | 'blocks';

/** The options of a part: `loadPivotMembers`, `loadPivotCounts`, `loadPivotCells` or `loadPivotBlocks`. */
export type RestPivotPartOptions<T> = PivotMembersOptions<T> | PivotCountsOptions<T> | PivotCellsOptions<T> | PivotBlocksOptions<T>;
