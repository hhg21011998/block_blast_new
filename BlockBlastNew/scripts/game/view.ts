import { animationFor } from "./colors.js";
import {
	BANK_COUNT,
	BANK_LAYER,
	BOARD_LAYER,
	BOARD_SIZE,
	DRAG_LAYER,
	HIT_STOP_AFTER_LINES,
	HIT_STOP_MS,
	PREVIEW_OPACITY
} from "./constants.js";
import { cellCenterX, cellCenterY, hud, liftedDragPoint } from "./hud.js";
import { hitBankSlot, instanceContains, snapOrigin } from "./input.js";
import { Session } from "./session.js";
import type { Shape } from "./shape.js";
import { getHighScore, submitScore } from "./storage.js";
import { GameUi } from "./ui.js";

/** Opacity of board + bank while the game-over overlay is up. */
const GAME_OVER_DIM = 0.3;

/** Construct's WorldInstance has no setAnimation; Block sprites do. */
type BlockSprite = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	setAnimation(name: string): void;
	destroy(): void;
	moveToTop?(): void;
};

export class GameApp {
	readonly session: Session;
	private readonly runtime: IRuntime;
	private readonly grid: IWorldInstance[] = [];
	private filled: (BlockSprite | null)[] = emptyFilled();
	private highlighted: number[] = [];
	private hintKey = "";
	private bankSprites: BlockSprite[][] = [[], [], []];
	private ghost: BlockSprite[] = [];
	private preview: BlockSprite[] = [];
	private drag: { slot: number; shape: Shape } | null = null;
	private dragging = false;
	private readonly ui: GameUi;
	/** Replay button was pressed; fire on release inside it. */
	private replayArmed = false;
	/** Stored best when this run began; decides "NEW BEST!" on game over. */
	private bestAtStart = 0;

	constructor(runtime: IRuntime, rng?: () => number) {
		this.runtime = runtime;
		this.session = new Session(rng);
		this.ui = new GameUi(runtime);
		this.session.events.on("score", ({ score }) => this.updateHud(score));
		this.session.events.on("lose", ({ score }) => this.onLose(score));
	}

	start(): void {
		this.saveBest();
		this.ui.hideGameOver();
		this.replayArmed = false;
		this.bestAtStart = getHighScore();
		this.destroyAllDynamic();
		this.ensureGrid();
		this.setBoardDim(false);
		// Core board first; the HUD is optional and fail-safe (see ui.ts).
		this.session.start();
		this.renderBank();
		this.renderFilled();
		this.ui.create();
		this.updateHud(this.session.score.score);
	}

	/** New run on the same layout (game-over replay button). */
	replay(): void {
		this.start();
	}

	relayout(): void {
		if (this.dragging) this.cancelDrag();
		this.repositionGrid();
		this.renderFilled();
		this.renderBank();
		this.ui.layout();
		if (this.session.lost) this.setBoardDim(true);
	}

	dispose(): void {
		this.saveBest();
		this.session.dispose();
		this.ui.dispose();
		this.destroyAllDynamic();
		for (const inst of this.grid) inst.destroy();
		this.grid.length = 0;
	}

	/** Layout already ended (Construct destroyed the instances): only stop timers/listeners. */
	detach(): void {
		this.saveBest();
		this.session.dispose();
		// Drops the HUD tick listener; destroying dead instances is caught in ui.ts.
		this.ui.dispose();
	}

	isDragging(): boolean {
		return this.dragging;
	}

	pointerDown(x: number, y: number): void {
		if (this.ui.isGameOverVisible()) {
			this.replayArmed = this.ui.hitReplay(x, y);
			return;
		}
		if (this.dragging || this.session.lost) return;
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
		if (this.ui.isGameOverVisible()) {
			const fire = this.replayArmed && this.ui.hitReplay(x, y);
			this.replayArmed = false;
			if (fire) this.replay();
			return;
		}
		if (!this.dragging || !this.drag) return;
		const { slot, shape } = this.drag;
		this.dragging = false;
		const origin = snapOrigin(shape, x, y);
		this.clearGhost();
		const result = this.session.tryPlace(slot, origin.col, origin.row);
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
		if (this.grid.length > 0) {
			this.repositionGrid();
			return;
		}
		const gridType = this.runtime.objects.Grid;
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const inst = gridType.createInstance(
					BOARD_LAYER,
					cellCenterX(col),
					cellCenterY(row)
				);
				inst.width = hud.cellSize;
				inst.height = hud.cellSize;
				inst.opacity = 1;
				this.grid.push(inst);
			}
		}
	}

	private repositionGrid(): void {
		if (this.grid.length === 0) {
			this.ensureGrid();
			return;
		}
		let i = 0;
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const inst = this.grid[i++];
				if (!inst) continue;
				inst.x = cellCenterX(col);
				inst.y = cellCenterY(row);
				inst.width = hud.cellSize;
				inst.height = hud.cellSize;
			}
		}
	}

	private renderFilled(): void {
		for (const inst of this.filled) inst?.destroy();
		this.filled = emptyFilled();
		this.highlighted = [];
		this.hintKey = "";
		const board = this.session.board;
		for (let row = 0; row < BOARD_SIZE; row++) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				const color = board.get(col, row);
				if (color === 0) continue;
				this.filled[cellIndex(col, row)] = this.spawn(
					BOARD_LAYER,
					cellCenterX(col),
					cellCenterY(row),
					hud.cellSize,
					animationFor(color),
					1
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
			this.bankSprites[slot] = this.spawnShape(
				shape,
				BANK_LAYER,
				hud.bankX[slot]!,
				hud.bankY[slot]!,
				hud.bankScale,
				1
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
		const h = shape.rows * hud.cellSize;
		const p = liftedDragPoint(fingerX, fingerY, h);
		const cx = p.x;
		const cy = p.y - h / 2;
		if (recreate || this.ghost.length === 0) {
			this.clearGhost();
			this.ghost = this.spawnShape(shape, DRAG_LAYER, cx, cy, 1, 1);
		} else {
			this.positionShape(this.ghost, shape, cx, cy, 1);
			for (const inst of this.ghost) inst.opacity = 1;
		}
		this.syncPreview(shape, origin, valid);
		this.syncClearHint(shape, origin, valid);
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
					hud.cellSize,
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
			inst.opacity = PREVIEW_OPACITY;
		}
	}

	private positionShape(
		insts: BlockSprite[],
		shape: Shape,
		centerX: number,
		centerY: number,
		scale: number
	): void {
		const stride = hud.cellSize * scale;
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

	private syncClearHint(
		shape: Shape,
		origin: { col: number; row: number },
		valid: boolean
	): void {
		const key = valid ? `${origin.col},${origin.row},${shape.guid}` : "";
		if (key === this.hintKey) return;
		this.clearClearHint();
		this.hintKey = key;
		if (!valid) return;
		const lines = this.session.board.wouldClear(shape, origin.col, origin.row);
		if (lines.rows.length + lines.cols.length === 0) return;
		const anim = animationFor(shape.color);
		const marked = new Set<number>();
		for (const row of lines.rows) {
			for (let col = 0; col < BOARD_SIZE; col++) {
				marked.add(cellIndex(col, row));
			}
		}
		for (const col of lines.cols) {
			for (let row = 0; row < BOARD_SIZE; row++) {
				marked.add(cellIndex(col, row));
			}
		}
		for (const i of marked) {
			const inst = this.filled[i];
			if (!inst) continue;
			inst.setAnimation(anim);
			this.highlighted.push(i);
		}
	}

	private clearClearHint(): void {
		for (const i of this.highlighted) {
			const inst = this.filled[i];
			if (!inst) continue;
			const col = i % BOARD_SIZE;
			const row = (i / BOARD_SIZE) | 0;
			const color = this.session.board.get(col, row);
			if (color !== 0) inst.setAnimation(animationFor(color));
		}
		this.highlighted = [];
		this.hintKey = "";
	}

	private clearGhost(): void {
		this.clearClearHint();
		for (const inst of this.ghost) inst.destroy();
		this.ghost = [];
		for (const inst of this.preview) inst.destroy();
		this.preview = [];
	}

	private setBankVisible(slot: number, visible: boolean): void {
		for (const inst of this.bankSprites[slot] ?? []) {
			inst.opacity = visible ? 1 : 0;
		}
	}

	private spawnShape(
		shape: Shape,
		layer: string,
		centerX: number,
		centerY: number,
		scale: number,
		opacity: number
	): BlockSprite[] {
		const out: BlockSprite[] = [];
		const size = hud.cellSize * scale;
		const stride = hud.cellSize * scale;
		const originX = centerX - (shape.cols * stride) / 2 + stride / 2;
		const originY = centerY - (shape.rows * stride) / 2 + stride / 2;
		const anim = animationFor(shape.color);
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
	): BlockSprite {
		const inst = this.runtime.objects.Block.createInstance(
			layer,
			x,
			y
		) as BlockSprite;
		inst.width = size;
		inst.height = size;
		inst.opacity = opacity;
		inst.setAnimation(animation);
		inst.moveToTop?.();
		return inst;
	}

	private updateHud(score: number): void {
		// Persist the record the moment it is beaten, so leaving mid-run keeps it.
		if (score > getHighScore()) submitScore(this.runtime, score);
		this.ui.setValues({
			score,
			combo: this.session.score.combo,
			best: getHighScore()
		});
	}

	private onLose(score: number): void {
		this.cancelDrag();
		submitScore(this.runtime, score);
		const newBest = score > this.bestAtStart;
		this.updateHud(score);
		this.setBoardDim(true);
		this.ui.showGameOver({ score, best: getHighScore(), newBest });
	}

	/** Idempotent: only writes when the current score beats the stored best. */
	private saveBest(): void {
		submitScore(this.runtime, this.session.score.score);
	}

	private setBoardDim(dim: boolean): void {
		const opacity = dim ? GAME_OVER_DIM : 1;
		for (const inst of this.grid) inst.opacity = opacity;
		for (const inst of this.filled) {
			if (inst) inst.opacity = opacity;
		}
		for (const slot of this.bankSprites) {
			for (const inst of slot) inst.opacity = opacity;
		}
	}

	private hitStop(): void {
		this.runtime.timeScale = 0;
		setTimeout(() => {
			this.runtime.timeScale = 1;
		}, HIT_STOP_MS);
	}

	private destroyAllDynamic(): void {
		this.clearGhost();
		for (const inst of this.filled) inst?.destroy();
		this.filled = emptyFilled();
		this.highlighted = [];
		this.hintKey = "";
		for (const slot of this.bankSprites) {
			for (const inst of slot) inst.destroy();
		}
		this.bankSprites = [[], [], []];
		this.drag = null;
		this.dragging = false;
	}
}

function emptyFilled(): (BlockSprite | null)[] {
	return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => null);
}

function cellIndex(col: number, row: number): number {
	return row * BOARD_SIZE + col;
}
