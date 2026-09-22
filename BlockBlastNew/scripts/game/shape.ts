export interface CellOffset {
	readonly col: number;
	readonly row: number;
}

export interface Shape {
	readonly guid: string;
	readonly rows: number;
	readonly cols: number;
	readonly color: number;
	/** Catalog gate from ShapeDatabase. Classic spawn uses hand-classic.json. */
	readonly brc: number;
	readonly cells: readonly CellOffset[];
}

export function shapeCellCount(shape: Shape): number {
	return shape.cells.length;
}
