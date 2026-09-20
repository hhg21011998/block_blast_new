import { animationFor } from "./colors.js";
import {
	BANK_COUNT,
	BANK_LAYER,
	BANK_SCALE,
	BANK_X,
	BANK_Y,
	BOARD_LAYER,
	BOARD_SIZE,
	CELL_SIZE,
	CELL_STRIDE,
	DRAG_LAYER,
	DRAG_OFFSET_Y,
	HIT_STOP_AFTER_LINES,
	HIT_STOP_MS,
	PREVIEW_OPACITY,
	UNPLACEABLE_OPACITY,
	cellCenterX,
	cellCenterY
} from "./constants.js";
import { hitBankSlot, instanceContains, snapOrigin } from "./input.js";
import { Session } from "./session.js";
import type { Shape } from "./shape.js";

export class GameApp {
	readonly session: Session;
	private readonly runtime: IRuntime;
	private readonly grid: IWorldInstance[] = [];
	private filled: IWorldInstance[] = [];
	private bankSprites: IWorldInstance[][] = [[], [], []];
	private ghost: IWorldInstance[] = [];
	private preview: IWorldInstance[] = [];
	private drag: { slot: number; shape: Shape } | null = null;
	private dragging = false;

	constructor(runtime: IRuntime, rng?: () => number) {
		this.runtime = runtime;
		this.session = new Session(rng);
	}

	start(): void {
		this.destroyAllDynamic();
		this.ensureGrid();
		this.session.start();
		this.renderBank();
		this.renderFilled();
	}

	dispose(): void {
		this.destroyAllDynamic();
		for (const inst of this.grid) inst.destroy();
		this.grid.length = 0;
	}

	isDragging(): boolean {
		return this.dragging;
	}

	pointerDown(x: number, y: number): void {
		if (this.session.lost) return;
		const slot = this.hitBank(x, y);
		if (slot === null) return;
		const shape = this.session.bank[slot];
		if (!shape) return;
		this.drag = { slot, shape };
		this.dragging = true;
		this.setBankVisible(slot, false);
		this.syncGhost(x, y, true);
	}

	pointerMove(x: number, y: number): void {
		if (!this.dragging || !this.drag) return;
		this.syncGhost(x, y, false);
	}

	pointerUp(x: number, y: number): void {
		if (!this.dragging || !this.drag) return;
		const { slot, shape } = this.drag;
		this.dragging = false;
		const origin = snapOrigin(shape, x, y);
		const result = this.session.tryPlace(slot, origin.col, origin.row);
		this.clearGhost();
		if (result.ok) {
			this.renderFilled();
			this.renderBank();
			if (result.lines >= HIT_STOP_AFTER_LINES) {
				this.hitStop();
			}
		} else {
			this.setBankVisible(slot, true);
		}
		this.drag = null;
	}

	cancelDrag(): void {
		if (!this.drag) return;
		this.setBankVisible(this.drag.slot, true);
		this.dragging = false;
		this.drag = null;
		this.clearGhost();
	}

	private ensureGrid(): void {
		if (this.grid.length > 0) return;
		const gridType = this.runtime.objects.Grid;
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const inst = gridType.createInstance(
					BOARD_LAYER,
					cellCenterX(col),
					cellCenterY(row)
				);
				inst.width = CELL_SIZE;
				inst.height = CELL_SIZE;
				inst.opacity = 1;
				this.grid.push(inst);
			}
		}
	}

	private renderFilled(): void {
		for (const inst of this.filled) inst.destroy();
		this.filled = [];
		const board = this.session.board;
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const color = board.get(col, row);
				if (color === 0) continue;
				this.filled.push(
					this.spawn(
						BOARD_LAYER,
						cellCenterX(col),
						cellCenterY(row),
						CELL_SIZE,
						animationFor(color),
						1
					)
				);
			}
		}
	}

	private renderBank(): void {
		for (let slot = 0; slot < BANK_COUNT; slot++) {
			for (const inst of this.bankSprites[slot]!) inst.destroy();
			this.bankSprites[slot] = [];
			const shape = this.session.bank[slot];
			if (!shape) continue;
			const unplaceable = !this.session.slotPlaceable(slot);
			this.bankSprites[slot] = this.spawnShape(
				shape,
				BANK_LAYER,
				BANK_X[slot]!,
				BANK_Y,
				BANK_SCALE,
				unplaceable ? UNPLACEABLE_OPACITY : 1
			);
		}
	}

	private hitBank(x: number, y: number): number | null {
		for (let slot = 0; slot < BANK_COUNT; slot++) {
			if (!this.session.bank[slot]) continue;
			for (const inst of this.bankSprites[slot] ?? []) {
				if (instanceContains(inst, x, y)) return slot;
			}
		}
		return hitBankSlot(x, y);
	}

	private syncGhost(fingerX: number, fingerY: number, recreate: boolean): void {
		if (!this.drag) return;
		const { shape } = this.drag;
		const origin = snapOrigin(shape, fingerX, fingerY);
		const valid = this.session.board.canPlace(shape, origin.col, origin.row);
		const h = shape.rows * CELL_STRIDE;
		const cx = fingerX;
		const cy = fingerY - DRAG_OFFSET_Y - h / 2;
		const opacity = valid ? 0.95 : 0.45;
		if (recreate || this.ghost.length === 0) {
			this.clearGhost();
			this.ghost = this.spawnShape(shape, DRAG_LAYER, cx, cy, 1, opacity);
		} else {
			this.positionShape(this.ghost, shape, cx, cy, 1);
			for (const inst of this.ghost) inst.opacity = opacity;
		}
		this.syncPreview(shape, origin, valid);
	}

	private syncPreview(
		shape: Shape,
		origin: { col: number; row: number },
		valid: boolean
	): void {
		if (!valid) {
			for (const inst of this.preview) inst.destroy();
			this.preview = [];
			return;
		}
		const anim = animationFor(shape.color);
		if (this.preview.length !== shape.cells.length) {
			for (const inst of this.preview) inst.destroy();
			this.preview = shape.cells.map((cell) =>
				this.spawn(
					BOARD_LAYER,
					cellCenterX(origin.col + cell.col),
					cellCenterY(origin.row + cell.row),
					CELL_SIZE,
					anim,
					PREVIEW_OPACITY
				)
			);
			return;
		}
		for (let i = 0; i < shape.cells.length; i++) {
			const cell = shape.cells[i]!;
			const inst = this.preview[i]!;
			inst.x = cellCenterX(origin.col + cell.col);
			inst.y = cellCenterY(origin.row + cell.row);
		}
	}

	private positionShape(
		insts: IWorldInstance[],
		shape: Shape,
		centerX: number,
		centerY: number,
		scale: number
	): void {
		const stride = CELL_SIZE * scale;
		const originX = centerX - (shape.cols * stride) / 2 + stride / 2;
		const originY = centerY - (shape.rows * stride) / 2 + stride / 2;
		for (let i = 0; i < shape.cells.length; i++) {
			const cell = shape.cells[i]!;
			const inst = insts[i];
			if (!inst) continue;
			inst.x = originX + cell.col * stride;
			inst.y = originY + cell.row * stride;
		}
	}

	private clearGhost(): void {
		for (const inst of this.ghost) inst.destroy();
		this.ghost = [];
		for (const inst of this.preview) inst.destroy();
		this.preview = [];
	}

	private setBankVisible(slot: number, visible: boolean): void {
		for (const inst of this.bankSprites[slot] ?? []) {
			inst.opacity = visible
				? this.session.slotPlaceable(slot)
					? 1
					: UNPLACEABLE_OPACITY
				: 0;
		}
	}

	private spawnShape(
		shape: Shape,
		layer: string,
		centerX: number,
		centerY: number,
		scale: number,
		opacity: number
	): IWorldInstance[] {
		const size = CELL_SIZE * scale;
		const stride = CELL_SIZE * scale;
		const originX = centerX - (shape.cols * stride) / 2 + stride / 2;
		const originY = centerY - (shape.rows * stride) / 2 + stride / 2;
		const anim = animationFor(shape.color);
		const out: IWorldInstance[] = [];
		for (const cell of shape.cells) {
			out.push(
				this.spawn(
					layer,
					originX + cell.col * stride,
					originY + cell.row * stride,
					size,
					anim,
					opacity
				)
			);
		}
		return out;
	}

	private spawn(
		layer: string,
		x: number,
		y: number,
		size: number,
		animation: string,
		opacity: number
	): IWorldInstance {
		const inst = this.runtime.objects.Block.createInstance(layer, x, y);
		inst.width = size;
		inst.height = size;
		inst.opacity = opacity;
		inst.setAnimation(animation);
		inst.moveToTop?.();
		return inst;
	}

	private hitStop(): void {
		this.runtime.timeScale = 0;
		setTimeout(() => {
			this.runtime.timeScale = 1;
		}, HIT_STOP_MS);
	}

	private destroyAllDynamic(): void {
		this.clearGhost();
		for (const inst of this.filled) inst.destroy();
		this.filled = [];
		for (const slot of this.bankSprites) {
			for (const inst of slot) inst.destroy();
		}
		this.bankSprites = [[], [], []];
		this.drag = null;
		this.dragging = false;
	}
}
