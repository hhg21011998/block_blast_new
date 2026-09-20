export interface CellOffset {
	readonly col: number;
	readonly row: number;
}

export interface Shape {
	readonly guid: string;
	readonly rows: number;
	readonly cols: number;
	readonly color: number;
	/** Unlock BRC. 0 = normal spawn. Shape_0 is 300 (revive). */
	readonly brc: number;
	readonly cells: readonly CellOffset[];
}

export function shapeCellCount(shape: Shape): number {
	return shape.cells.length;
}
