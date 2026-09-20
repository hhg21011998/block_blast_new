import { BOARD_SIZE } from "./constants.js";
import type { Shape } from "./shape.js";

export type CellValue = number;

export interface LineClear {
	rows: number[];
	cols: number[];
}

export class Board {
	private readonly cells: Uint8Array;

	constructor() {
		this.cells = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
	}

	reset(): void {
		this.cells.fill(0);
	}

	clone(): Board {
		const b = new Board();
		b.cells.set(this.cells);
		return b;
	}

	inBounds(col: number, row: number): boolean {
		return col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE;
	}

	get(col: number, row: number): CellValue {
		if (!this.inBounds(col, row)) {
			throw new RangeError(`cell out of bounds: ${col},${row}`);
		}
		return this.cells[row * BOARD_SIZE + col]!;
	}

	set(col: number, row: number, value: CellValue): void {
		if (!this.inBounds(col, row)) {
			throw new RangeError(`cell out of bounds: ${col},${row}`);
		}
		this.cells[row * BOARD_SIZE + col] = value;
	}

	isEmpty(col: number, row: number): boolean {
		return this.get(col, row) === 0;
	}

	occupiedCount(): number {
		let n = 0;
		for (let i = 0; i < this.cells.length; i++) {
			if (this.cells[i] !== 0) n++;
		}
		return n;
	}

	isAllEmpty(): boolean {
		return this.occupiedCount() === 0;
	}

	canPlace(shape: Shape, originCol: number, originRow: number): boolean {
		for (const cell of shape.cells) {
			const c = originCol + cell.col;
			const r = originRow + cell.row;
			if (!this.inBounds(c, r) || this.get(c, r) !== 0) {
				return false;
			}
		}
		return true;
	}

	place(shape: Shape, originCol: number, originRow: number): void {
		if (!this.canPlace(shape, originCol, originRow)) {
			throw new Error(`cannot place ${shape.guid} at ${originCol},${originRow}`);
		}
		for (const cell of shape.cells) {
			this.set(originCol + cell.col, originRow + cell.row, shape.color);
		}
	}

	findAnyOrigin(shape: Shape): { col: number; row: number } | null {
		const maxCol = BOARD_SIZE - shape.cols;
		const maxRow = BOARD_SIZE - shape.rows;
		for (let row = 0; row <= maxRow; row++) {
			for (let col = 0; col <= maxCol; col++) {
				if (this.canPlace(shape, col, row)) {
					return { col, row };
				}
			}
		}
		return null;
	}

	canPlaceAnywhere(shape: Shape): boolean {
		return this.findAnyOrigin(shape) !== null;
	}

	/** Clone-place and return rows/cols that would clear. Empty if not placeable. */
	wouldClear(shape: Shape, originCol: number, originRow: number): LineClear {
		if (!this.canPlace(shape, originCol, originRow)) {
			return { rows: [], cols: [] };
		}
		const next = this.clone();
		next.place(shape, originCol, originRow);
		return next.findFullLines();
	}

	findFullLines(): LineClear {
		const rows: number[] = [];
		const cols: number[] = [];
		for (let row = 0; row < BOARD_SIZE; row++) {
			let full = true;
			for (let col = 0; col < BOARD_SIZE; col++) {
				if (this.get(col, row) === 0) {
					full = false;
					break;
				}
			}
			if (full) rows.push(row);
		}
		for (let col = 0; col < BOARD_SIZE; col++) {
			let full = true;
			for (let row = 0; row < BOARD_SIZE; row++) {
				if (this.get(col, row) === 0) {
					full = false;
					break;
				}
			}
			if (full) cols.push(col);
		}
		return { rows, cols };
	}

	/** Simultaneous row+col clear. Returns number of cells emptied. */
	clearLines(lines: LineClear): number {
		const doomed = new Set<number>();
		for (const row of lines.rows) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				doomed.add(row * BOARD_SIZE + col);
			}
		}
		for (const col of lines.cols) {
			for (let row = 0; row < BOARD_SIZE; row++) {
				doomed.add(row * BOARD_SIZE + col);
			}
		}
		for (const i of doomed) {
			this.cells[i] = 0;
		}
		return doomed.size;
	}
}
