import { Board } from "./board.js";
import { BANK_COUNT, LOSE_DELAY_MS } from "./constants.js";
import { EventBus } from "./events.js";
import { advanceBrc, spawnBank } from "./hand.js";
import {
	createScoreState,
	noteClear,
	noteNonClear,
	notePlace,
	comboMultiplier,
	resetScoreState,
	type ScoreState
} from "./score.js";
import type { Shape } from "./shape.js";

export interface PlaceOk {
	ok: true;
	guid: string;
	cells: number;
	originCol: number;
	originRow: number;
	lines: number;
	rows: number[];
	cols: number[];
	boardClear: boolean;
	scoreDelta: number;
	score: number;
	combo: number;
	refilled: boolean;
	lost: boolean;
}

export interface PlaceFail {
	ok: false;
}

export type PlaceResult = PlaceOk | PlaceFail;

export class Session {
	readonly board = new Board();
	readonly events = new EventBus();
	readonly bank: (Shape | null)[] = [null, null, null];
	readonly score: ScoreState = createScoreState();
	/** Lines cleared this run, capped by the classic hand. */
	brc = 0;
	lost = false;
	/** Even refills use the hand. Odd refills try a full-board clear first. */
	private refillSerial = 0;
	private loseTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly rng: () => number;

	constructor(rng: () => number = Math.random) {
		this.rng = rng;
	}

	start(): void {
		this.lost = false;
		this.clearLoseTimer();
		this.board.reset();
		resetScoreState(this.score);
		this.brc = 0;
		this.refillSerial = 0;
		this.refillBank();
		this.events.emit("started", { score: 0 });
		this.events.emit("score", { score: 0 });
		this.emitUnplaceable();
	}

	slotPlaceable(slot: number): boolean {
		const shape = this.bank[slot];
		if (!shape || this.lost) return false;
		return this.board.canPlaceAnywhere(shape);
	}

	anyRemainingPlaceable(): boolean {
		for (let i = 0; i < BANK_COUNT; i++) {
			if (this.slotPlaceable(i)) return true;
		}
		return false;
	}

	tryPlace(slot: number, originCol: number, originRow: number): PlaceResult {
		if (this.lost) return { ok: false };
		const shape = this.bank[slot];
		if (!shape) return { ok: false };
		if (!this.board.canPlace(shape, originCol, originRow)) {
			return { ok: false };
		}

		this.board.place(shape, originCol, originRow);
		const cells = shape.cells.length;
		const placeDelta = notePlace(this.score, cells);
		let scoreDelta = placeDelta;

		const lines = this.board.findFullLines();
		const lineCount = lines.rows.length + lines.cols.length;
		let cellsRemoved = 0;
		let boardClear = false;
		let clearDelta = 0;
		if (lineCount > 0) {
			cellsRemoved = this.board.clearLines(lines);
			boardClear = this.board.isAllEmpty();
			// Line points x combo (after this move's +1) + board bonus; see score.ts.
			clearDelta = noteClear(this.score, lineCount, boardClear);
			scoreDelta += clearDelta;
			this.brc = advanceBrc(this.brc, lineCount);
		} else {
			noteNonClear(this.score);
		}

		this.bank[slot] = null;
		this.events.emit("placed", {
			guid: shape.guid,
			cells,
			originCol,
			originRow,
			scoreDelta: placeDelta,
			score: this.score.score
		});

		if (lineCount > 0) {
			this.events.emit("cleared", {
				lineCount,
				rows: lines.rows.slice(),
				cols: lines.cols.slice(),
				cellsRemoved,
				boardClear,
				combo: this.score.combo,
				multiplier: comboMultiplier(this.score.combo),
				scoreDelta: clearDelta,
				score: this.score.score
			});
		}

		this.events.emit("score", { score: this.score.score });

		let refilled = false;
		if (this.bank.every((s) => s === null)) {
			this.refillBank();
			refilled = true;
		}

		this.emitUnplaceable();
		const lost = this.checkLose();

		return {
			ok: true,
			guid: shape.guid,
			cells,
			originCol,
			originRow,
			lines: lineCount,
			rows: lines.rows,
			cols: lines.cols,
			boardClear,
			scoreDelta,
			score: this.score.score,
			combo: this.score.combo,
			refilled,
			lost
		};
	}

	private refillBank(): void {
		const sweep = this.refillSerial % 2 === 1;
		this.refillSerial++;
		const picked = spawnBank(this.board, this.brc, this.rng, sweep);
		for (let i = 0; i < BANK_COUNT; i++) {
			this.bank[i] = picked[i] ?? null;
		}
		this.events.emit("bankRefill", {
			guids: this.bank.map((s) => s?.guid ?? "")
		});
	}

	private emitUnplaceable(): void {
		for (let i = 0; i < BANK_COUNT; i++) {
			const shape = this.bank[i];
			const unplaceable = !!shape && !this.board.canPlaceAnywhere(shape);
			this.events.emit("unplaceable", { slot: i, unplaceable });
		}
	}

	private checkLose(): boolean {
		if (this.lost) return true;
		if (this.anyRemainingPlaceable()) {
			this.clearLoseTimer();
			return false;
		}
		this.scheduleLose();
		return true;
	}

	private scheduleLose(): void {
		this.clearLoseTimer();
		this.loseTimer = setTimeout(() => {
			if (this.lost || this.anyRemainingPlaceable()) return;
			this.lost = true;
			this.events.emit("lose", { score: this.score.score });
		}, LOSE_DELAY_MS);
		this.events.emit("loseStart", { delayMs: LOSE_DELAY_MS, score: this.score.score });
	}

	/** Stop pending timers and drop listeners. Call when the view/layout goes away. */
	dispose(): void {
		this.clearLoseTimer();
		this.events.clear();
	}

	private clearLoseTimer(): void {
		if (this.loseTimer !== null) {
			clearTimeout(this.loseTimer);
			this.loseTimer = null;
		}
	}
}
