/**
 * Classic Invisible Hand from `files/hand-classic.json`
 * (dump `inv-hand-classic.bytes`, “Super Easy (Better End Game)”).
 *
 * BRC advances by `brcValueOnClear` per clearing move (any line count), capped at `maxBrc`.
 * Curve time is `brc / maxBrc`, piecewise linear.
 *
 * Perfect fit: the board is at least `minimumCellsFilledPercentage` full
 * and a placement puts at least `minimumPerfectFitPercentage` of the
 * piece's cells on lines that clear (each cell counted once). Bonus is
 * `perfectFitModValue * perfectFitCurve`.
 *
 * A piece that is not a perfect fit is a terminator and gets
 * `terminatorMod * terminatorCurve`. That term is ~0 early and only
 * competes after the perfect-fit curve drops.
 *
 * Complementary adds the complementary curve when the chosen placement
 * clears a row or column that an earlier slot in this bank did not.
 * Cherry-pick is a weighted draw among scores within `cherryPickRange`
 * of the best. While any eligible piece fits, unplaceable pieces stay
 * out of the draw. Shape_15–17 are in the hand file and spawn only once
 * their matrices are in shapes.json.
 *
 * Each bank is a scripted trio when the board allows it. Slot 0 can be
 * placed without clearing. Slot 1 then fits beside it and clears a line
 * that still holds slot 0's cells. Slot 2 is the hard piece: it fits
 * after that clear, does not clear itself, and even its kindest spot
 * leaves fewer pieces placeable than before. The weighted draw is only
 * the fallback when no such trio exists.
 */
import { Board } from "./board.js";
import { BANK_COUNT, BOARD_SIZE } from "./constants.js";
import type { Shape } from "./shape.js";
import { getShapes } from "./shapes.js";

interface CurveKey {
	t: number;
	v: number;
}

interface HandShape {
	guid: string;
	modifier: number;
	edges: number;
	brc: number;
}

export interface HandFile {
	version: string;
	maxBrc: number;
	brcValueOnClear: number;
	perfectFitModValue: number;
	minimumPerfectFitPercentage: number;
	minimumCellsFilledPercentage: number;
	perfectFitComplexShapeBonus: number;
	complexShapeMultiplier: number;
	terminatorMod: number;
	cherryPickRange: number;
	curves: {
		perfectFit: CurveKey[];
		terminator: CurveKey[];
		complementary: CurveKey[];
		complex: CurveKey[];
	};
	shapes: HandShape[];
}

interface Read {
	ratio: number;
	lineCount: number;
	rows: number[];
	cols: number[];
}

interface Scored {
	shape: Shape;
	score: number;
	read: Read | null;
}

let config: HandFile | null = null;

export function applyHandJson(data: HandFile): void {
	if (!data.shapes?.length) {
		throw new Error("hand-classic.json has no shapes");
	}
	if (data.maxBrc <= 0) {
		throw new Error("hand-classic.json maxBrc must be positive");
	}
	config = {
		...data,
		curves: {
			perfectFit: data.curves.perfectFit.slice(),
			terminator: data.curves.terminator.slice(),
			complementary: data.curves.complementary.slice(),
			complex: data.curves.complex.slice()
		},
		shapes: data.shapes.slice()
	};
}

/** +brcValueOnClear once per clearing move; a multi-line clear still counts once. */
export function advanceBrc(brc: number, lineCount: number): number {
	const cfg = requireConfig();
	if (lineCount <= 0) return brc;
	const next = brc + cfg.brcValueOnClear;
	if (next < 0) return 0;
	return Math.min(cfg.maxBrc, next);
}

export function handCurveAt(name: keyof HandFile["curves"], brc: number): number {
	const cfg = requireConfig();
	return evalCurve(cfg.curves[name], brcTime(brc));
}

export function spawnBank(board: Board, brc: number, rng: () => number): Shape[] {
	const cfg = requireConfig();
	const catalog = new Map(getShapes().map((shape) => [shape.guid, shape]));
	const eligible: { shape: Shape; spec: HandShape }[] = [];
	for (const spec of cfg.shapes) {
		if (spec.brc > brc) continue;
		const shape = catalog.get(spec.guid);
		if (!shape) continue;
		eligible.push({ shape, spec });
	}
	if (eligible.length === 0) {
		throw new Error("classic hand produced an empty spawn pool");
	}
	const placeable = eligible.filter((item) => board.canPlaceAnywhere(item.shape));
	const source = placeable.length > 0 ? placeable : eligible;
	const scripted = scriptedTrio(
		board,
		eligible.map((item) => item.shape),
		source.map((item) => item.shape),
		rng
	);
	if (scripted) return scripted;
	const taken = new Set<string>();
	const fill = board.occupiedCount() / (BOARD_SIZE * BOARD_SIZE);
	const bank: Shape[] = [];
	for (let slot = 0; slot < BANK_COUNT; slot++) {
		const scored: Scored[] = [];
		for (const item of source) {
			scored.push(judge(board, item.shape, item.spec, brc, fill, taken));
		}
		const picked = pickWeighted(scored, cfg.cherryPickRange, rng);
		bank.push(picked.shape);
		if (picked.read) takeLines(picked.read, taken);
	}
	return bank;
}

interface Origin {
	col: number;
	row: number;
}

interface ComboPair {
	setup: Shape;
	finish: Shape;
	setupAt: Origin;
	finishAt: Origin;
}

/**
 * [setup, finisher, hard]. Setup does not clear. Finisher then clears a
 * line that still contains the setup's cells. Hard fits only after that
 * clear when possible, and its best non-clearing spot cuts future fits.
 */
function scriptedTrio(
	board: Board,
	pool: readonly Shape[],
	placeable: readonly Shape[],
	rng: () => number
): Shape[] | null {
	if (placeable.length < 2) return null;
	const pair = findComboPair(board, placeable, rng);
	if (!pair) return null;
	const after = board.clone();
	after.place(pair.setup, pair.setupAt.col, pair.setupAt.row);
	after.clearLines(after.findFullLines());
	after.place(pair.finish, pair.finishAt.col, pair.finishAt.row);
	after.clearLines(after.findFullLines());
	const hard = findHardPiece(board, after, pool, pair, rng);
	if (!hard) return null;
	return [pair.setup, pair.finish, hard];
}

function findComboPair(board: Board, placeable: readonly Shape[], rng: () => number): ComboPair | null {
	const setups = shuffle(placeable, rng);
	for (const setup of setups) {
		if (setup.cells.length < 3) continue;
		const spots = shuffle(listOrigins(board, setup), rng).slice(0, 8);
		for (const spot of spots) {
			const next = board.clone();
			next.place(setup, spot.col, spot.row);
			const planted = cellsOf(setup, spot);
			const opened = next.findFullLines();
			if (hasLines(opened)) {
				for (const index of planted) {
					const col = index % BOARD_SIZE;
					const row = Math.floor(index / BOARD_SIZE);
					if (opened.rows.includes(row) || opened.cols.includes(col)) planted.delete(index);
				}
				next.clearLines(opened);
			}
			if (planted.size === 0) continue;
			const finish = findFinisher(next, placeable, setup.guid, planted, rng);
			if (!finish) continue;
			return { setup, finish: finish.shape, setupAt: spot, finishAt: finish.at };
		}
	}
	return null;
}

function findFinisher(
	board: Board,
	placeable: readonly Shape[],
	setupGuid: string,
	planted: ReadonlySet<number>,
	rng: () => number
): { shape: Shape; at: Origin } | null {
	const order = shuffle(
		placeable.filter((shape) => shape.guid !== setupGuid),
		rng
	);
	for (const shape of order) {
		const maxCol = BOARD_SIZE - shape.cols;
		const maxRow = BOARD_SIZE - shape.rows;
		for (let row = 0; row <= maxRow; row++) {
			for (let col = 0; col <= maxCol; col++) {
				if (!board.canPlace(shape, col, row)) continue;
				const next = board.clone();
				next.place(shape, col, row);
				const lines = next.findFullLines();
				if (!hasLines(lines)) continue;
				if (!cellsOnClearedLines(planted, lines)) continue;
				return { shape, at: { col, row } };
			}
		}
	}
	return null;
}

function findHardPiece(
	original: Board,
	afterClear: Board,
	pool: readonly Shape[],
	pair: ComboPair,
	rng: () => number
): Shape | null {
	const used = new Set([pair.setup.guid, pair.finish.guid]);
	const before = countPlaceable(afterClear, pool);
	let best: { shape: Shape; score: number } | null = null;
	for (const shape of shuffle(pool, rng)) {
		if (used.has(shape.guid)) continue;
		const spots = listOrigins(afterClear, shape);
		if (spots.length === 0) continue;
		let bestMobility = -1;
		let quiet = 0;
		let scored = 0;
		for (const spot of spots) {
			const next = afterClear.clone();
			next.place(shape, spot.col, spot.row);
			if (hasLines(next.findFullLines())) continue;
			quiet++;
			if (scored >= 4) continue;
			scored++;
			const mobility = countPlaceable(next, pool);
			if (mobility > bestMobility) bestMobility = mobility;
		}
		if (quiet === 0 || bestMobility < 0) continue;
		const lockedUntilClear = !original.canPlaceAnywhere(shape);
		// Few legal spots, and the kindest of them still removes future pieces.
		const scarcity = Math.max(0, 6 - quiet);
		const score =
			scarcity * 8 +
			(before - bestMobility) * 4 +
			(lockedUntilClear ? 10 : 0) +
			rng() * 3;
		if (!best || score > best.score) best = { shape, score };
	}
	return best?.shape ?? null;
}

function listOrigins(board: Board, shape: Shape): Origin[] {
	const found: Origin[] = [];
	const maxCol = BOARD_SIZE - shape.cols;
	const maxRow = BOARD_SIZE - shape.rows;
	for (let row = 0; row <= maxRow; row++) {
		for (let col = 0; col <= maxCol; col++) {
			if (board.canPlace(shape, col, row)) found.push({ col, row });
		}
	}
	return found;
}

function cellsOf(shape: Shape, at: Origin): Set<number> {
	const cells = new Set<number>();
	for (const cell of shape.cells) {
		cells.add((at.row + cell.row) * BOARD_SIZE + (at.col + cell.col));
	}
	return cells;
}

function cellsOnClearedLines(cells: ReadonlySet<number>, lines: { rows: number[]; cols: number[] }): boolean {
	const rows = new Set(lines.rows);
	const cols = new Set(lines.cols);
	for (const index of cells) {
		const col = index % BOARD_SIZE;
		const row = Math.floor(index / BOARD_SIZE);
		if (rows.has(row) || cols.has(col)) return true;
	}
	return false;
}

function hasLines(lines: { rows: number[]; cols: number[] }): boolean {
	return lines.rows.length > 0 || lines.cols.length > 0;
}

function countPlaceable(board: Board, shapes: readonly Shape[]): number {
	let n = 0;
	for (const shape of shapes) {
		if (board.canPlaceAnywhere(shape)) n++;
	}
	return n;
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
	const out = items.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const swap = out[i]!;
		out[i] = out[j]!;
		out[j] = swap;
	}
	return out;
}

function requireConfig(): HandFile {
	if (!config) throw new Error("classic hand is not loaded");
	return config;
}

function brcTime(brc: number): number {
	const cfg = requireConfig();
	return Math.min(1, Math.max(0, brc / cfg.maxBrc));
}

function evalCurve(keys: readonly CurveKey[], time: number): number {
	if (keys.length === 0) return 0;
	const first = keys[0]!;
	if (time <= first.t) return first.v;
	const last = keys[keys.length - 1]!;
	if (time >= last.t) return last.v;
	for (let i = 1; i < keys.length; i++) {
		const next = keys[i]!;
		if (time > next.t) continue;
		const prev = keys[i - 1]!;
		const span = next.t - prev.t;
		if (span <= 0) return next.v;
		const u = (time - prev.t) / span;
		return prev.v + (next.v - prev.v) * u;
	}
	return last.v;
}

function judge(
	board: Board,
	shape: Shape,
	spec: HandShape,
	brc: number,
	fill: number,
	taken: ReadonlySet<string>
): Scored {
	const cfg = requireConfig();
	const time = brcTime(brc);
	const allowPerfect = fill >= cfg.minimumCellsFilledPercentage;
	const read = chooseRead(
		placementReads(board, shape),
		taken,
		allowPerfect,
		cfg.minimumPerfectFitPercentage
	);
	const perfect = allowPerfect && !!read && read.ratio >= cfg.minimumPerfectFitPercentage;
	let score = spec.modifier;
	const complex = spec.edges > 4;
	if (complex) {
		score += cfg.complexShapeMultiplier * evalCurve(cfg.curves.complex, time);
	}
	if (perfect) {
		score += cfg.perfectFitModValue * evalCurve(cfg.curves.perfectFit, time);
		if (complex) score += cfg.perfectFitComplexShapeBonus;
	} else {
		score += cfg.terminatorMod * evalCurve(cfg.curves.terminator, time);
	}
	if (read && touchesNew(read, taken)) {
		score += evalCurve(cfg.curves.complementary, time);
	}
	return { shape, score, read };
}

function placementReads(board: Board, shape: Shape): Read[] {
	const reads: Read[] = [];
	const cellCount = shape.cells.length;
	if (cellCount === 0) return reads;
	const maxCol = BOARD_SIZE - shape.cols;
	const maxRow = BOARD_SIZE - shape.rows;
	for (let row = 0; row <= maxRow; row++) {
		for (let col = 0; col <= maxCol; col++) {
			const lines = touchedLines(shape, col, row, board.wouldClear(shape, col, row));
			const lineCount = lines.rows.length + lines.cols.length;
			if (lineCount === 0) continue;
			reads.push({
				ratio: cellsOnLines(shape, col, row, lines) / cellCount,
				lineCount,
				rows: lines.rows,
				cols: lines.cols
			});
		}
	}
	return reads;
}

function touchedLines(
	shape: Shape,
	originCol: number,
	originRow: number,
	lines: { rows: number[]; cols: number[] }
): { rows: number[]; cols: number[] } {
	const rows = new Set<number>();
	const cols = new Set<number>();
	for (const cell of shape.cells) {
		rows.add(originRow + cell.row);
		cols.add(originCol + cell.col);
	}
	return {
		rows: lines.rows.filter((row) => rows.has(row)),
		cols: lines.cols.filter((col) => cols.has(col))
	};
}

function cellsOnLines(
	shape: Shape,
	originCol: number,
	originRow: number,
	lines: { rows: number[]; cols: number[] }
): number {
	const rows = new Set(lines.rows);
	const cols = new Set(lines.cols);
	let n = 0;
	for (const cell of shape.cells) {
		if (rows.has(originRow + cell.row) || cols.has(originCol + cell.col)) n++;
	}
	return n;
}

function chooseRead(
	reads: readonly Read[],
	taken: ReadonlySet<string>,
	allowPerfect: boolean,
	minRatio: number
): Read | null {
	if (reads.length === 0) return null;
	const perfect: Read[] = [];
	if (allowPerfect) {
		for (const read of reads) {
			if (read.ratio >= minRatio) perfect.push(read);
		}
	}
	const pool = perfect.length > 0 ? perfect : reads;
	const fresh: Read[] = [];
	for (const read of pool) {
		if (touchesNew(read, taken)) fresh.push(read);
	}
	const pickFrom = fresh.length > 0 ? fresh : pool;
	let best = pickFrom[0]!;
	for (let i = 1; i < pickFrom.length; i++) {
		const read = pickFrom[i]!;
		if (read.ratio > best.ratio || (read.ratio === best.ratio && read.lineCount > best.lineCount)) {
			best = read;
		}
	}
	return best;
}

function touchesNew(read: Read, taken: ReadonlySet<string>): boolean {
	for (const row of read.rows) {
		if (!taken.has(rowKey(row))) return true;
	}
	for (const col of read.cols) {
		if (!taken.has(colKey(col))) return true;
	}
	return false;
}

function takeLines(read: Read, taken: Set<string>): void {
	for (const row of read.rows) taken.add(rowKey(row));
	for (const col of read.cols) taken.add(colKey(col));
}

function rowKey(row: number): string {
	return `r${row}`;
}

function colKey(col: number): string {
	return `c${col}`;
}

function pickWeighted(items: readonly Scored[], range: number, rng: () => number): Scored {
	let best = 0;
	for (const item of items) {
		if (item.score > best) best = item.score;
	}
	const window: Scored[] = [];
	for (const item of items) {
		if (best - item.score <= range) window.push(item);
	}
	const pool = window.length > 0 ? window : items;
	let total = 0;
	for (const item of pool) total += item.score;
	if (!(total > 0)) {
		const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
		return pool[i]!;
	}
	let roll = rng() * total;
	for (const item of pool) {
		roll -= item.score;
		if (roll < 0) return item;
	}
	return pool[pool.length - 1]!;
}
