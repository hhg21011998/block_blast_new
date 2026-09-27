import {
	BOARD_CLEAR_BONUS,
	COMBO_MULTIPLIER_CAP,
	COMBO_SCORE_MULTIPLIER,
	LINE_CLEAR_SCORES,
	RESET_STREAK_AFTER_BOARD_CLEAR,
	RESET_STREAK_AFTER_NON_CLEARS,
	SCORE_PER_CELL,
	STREAK_START_AFTER_CLEARS
} from "./constants.js";

/**
 * Combo rule (Classic):
 * - Every clearing move adds 1 to `combo` (a multi-line clear still adds 1),
 *   so the first clearing move gives combo 1.
 * - `nonClearStreak` counts consecutive non-clearing placements. When it reaches
 *   `nonClearLimit` the combo drops to 0.
 * - A normal clear resets the miss count and sets the allowance to
 *   RESET_STREAK_AFTER_NON_CLEARS (3); a full-board clear sets it to
 *   RESET_STREAK_AFTER_BOARD_CLEAR (7).
 * - The combo FX shows from COMBO_FX_MIN (STREAK_START_AFTER_CLEARS, 2).
 *
 * Score per move (Classic):
 *   cells * perCell
 *   + lineClears[min(lines, len) - 1] * comboMultiplier(combo)   (combo after this move's +1)
 *   + boardClear bonus (not multiplied)
 * comboMultiplier = combo when `comboScoreMultiplier` (default true), capped by
 * `comboMultiplierCap` if > 0; otherwise 1. First clear = combo 1 = x1.
 */
export interface ScoreState {
	score: number;
	combo: number;
	nonClearStreak: number;
	nonClearLimit: number;
}

export function createScoreState(): ScoreState {
	return {
		score: 0,
		combo: 0,
		nonClearStreak: 0,
		nonClearLimit: RESET_STREAK_AFTER_NON_CLEARS
	};
}

/** Zero score, combo and miss counter (new run / replay / layout restart). */
export function resetScoreState(state: ScoreState): void {
	state.score = 0;
	state.combo = 0;
	state.nonClearStreak = 0;
	state.nonClearLimit = RESET_STREAK_AFTER_NON_CLEARS;
}

/** The combo FX shows when combo is at least this. */
export function comboFxMin(): number {
	return STREAK_START_AFTER_CLEARS;
}

export function scoreForPlace(cellCount: number): number {
	return cellCount * SCORE_PER_CELL;
}

/** Line-table points for one move before the combo multiplier. */
export function baseLineScore(lineCount: number): number {
	if (lineCount <= 0) return 0;
	const idx = Math.min(lineCount, LINE_CLEAR_SCORES.length) - 1;
	return LINE_CLEAR_SCORES[idx] ?? 0;
}

/** Multiplier for the line-clear part at this combo (1 when disabled). */
export function comboMultiplier(combo: number): number {
	if (!COMBO_SCORE_MULTIPLIER) return 1;
	let m = Math.max(1, Math.floor(combo));
	if (COMBO_MULTIPLIER_CAP > 0) m = Math.min(m, COMBO_MULTIPLIER_CAP);
	return m;
}

/**
 * Clear points for one move: base line points x combo multiplier, plus the
 * board-clear bonus (never multiplied). `combo` is the value after this move's +1.
 */
export function scoreForLines(lineCount: number, boardClear: boolean, combo = 1): number {
	if (lineCount <= 0) return 0;
	let total = baseLineScore(lineCount) * comboMultiplier(combo);
	if (boardClear) total += BOARD_CLEAR_BONUS;
	return total;
}

export function notePlace(state: ScoreState, cellCount: number): number {
	const delta = scoreForPlace(cellCount);
	state.score += delta;
	return delta;
}

export function noteClear(state: ScoreState, lineCount: number, boardClear: boolean): number {
	state.combo += 1;
	state.nonClearStreak = 0;
	state.nonClearLimit = boardClear
		? RESET_STREAK_AFTER_BOARD_CLEAR
		: RESET_STREAK_AFTER_NON_CLEARS;
	const delta = scoreForLines(lineCount, boardClear, state.combo);
	state.score += delta;
	return delta;
}

export function noteNonClear(state: ScoreState): void {
	if (state.combo === 0) {
		state.nonClearStreak = 0;
		return;
	}
	state.nonClearStreak += 1;
	if (state.nonClearStreak >= state.nonClearLimit) {
		state.combo = 0;
		state.nonClearStreak = 0;
		state.nonClearLimit = RESET_STREAK_AFTER_NON_CLEARS;
	}
}
