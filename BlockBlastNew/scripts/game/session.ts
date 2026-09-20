import { Board } from "./board.js";
import { BANK_COUNT, LOSE_DELAY_MS, RESET_STREAK_AFTER_NON_CLEARS } from "./constants.js";
import { EventBus } from "./events.js";
import {
	createScoreState,
	noteClear,
	noteNonClear,
	notePlace,
	scoreForLines,
	scoreForPlace,
	type ScoreState
} from "./score.js";
import type { Shape } from "./shape.js";
import { getSpawnShapes } from "./shapes.js";

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
	lost = false;
	private loseTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly rng: () => number;

	constructor(rng: () => number = Math.random) {
		this.rng = rng;
	}

	start(): void {
		this.lost = false;
		this.clearLoseTimer();
		this.board.reset();
		this.score.score = 0;
		this.score.combo = 0;
		this.score.consecutiveClears = 0;
		this.score.nonClearStreak = 0;
		this.score.nonClearLimit = RESET_STREAK_AFTER_NON_CLEARS;
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
		let scoreDelta = notePlace(this.score, cells);
		const placeDelta = scoreForPlace(cells);

		const lines = this.board.findFullLines();
		const lineCount = lines.rows.length + lines.cols.length;
		let cellsRemoved = 0;
		let boardClear = false;
		let clearDelta = 0;
		if (lineCount > 0) {
			cellsRemoved = this.board.clearLines(lines);
			boardClear = this.board.isAllEmpty();
			clearDelta = scoreForLines(lineCount, boardClear);
			scoreDelta += noteClear(this.score, lineCount, boardClear);
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
		const catalog = getSpawnShapes();
		const pool = catalog.filter((s) => this.board.canPlaceAnywhere(s));
		const source = pool.length > 0 ? pool : catalog;
		if (source.length === 0) {
			throw new Error("shapes.json produced an empty spawn catalog");
		}
		for (let i = 0; i < BANK_COUNT; i++) {
			this.bank[i] = pick(source, this.rng);
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
	}

	private clearLoseTimer(): void {
		if (this.loseTimer !== null) {
			clearTimeout(this.loseTimer);
			this.loseTimer = null;
		}
	}
}

function pick<T>(list: readonly T[], rng: () => number): T {
	const i = Math.min(list.length - 1, Math.floor(rng() * list.length));
	return list[i]!;
}
