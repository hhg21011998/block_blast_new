import {
	BOARD_CLEAR_BONUS,
	LINE_CLEAR_SCORES,
	RESET_STREAK_AFTER_BOARD_CLEAR,
	RESET_STREAK_AFTER_NON_CLEARS,
	SCORE_PER_CELL,
	STREAK_START_AFTER_CLEARS
} from "./constants.js";

export interface ScoreState {
	score: number;
	combo: number;
	consecutiveClears: number;
	nonClearStreak: number;
	nonClearLimit: number;
}

export function createScoreState(): ScoreState {
	return {
		score: 0,
		combo: 0,
		consecutiveClears: 0,
		nonClearStreak: 0,
		nonClearLimit: RESET_STREAK_AFTER_NON_CLEARS
	};
}

export function scoreForPlace(cellCount: number): number {
	return cellCount * SCORE_PER_CELL;
}

export function scoreForLines(lineCount: number, boardClear: boolean): number {
	if (lineCount <= 0) return 0;
	const idx = Math.min(lineCount, LINE_CLEAR_SCORES.length) - 1;
	let total = LINE_CLEAR_SCORES[idx] ?? 0;
	if (boardClear) total += BOARD_CLEAR_BONUS;
	return total;
}

export function notePlace(state: ScoreState, cellCount: number): number {
	const delta = scoreForPlace(cellCount);
	state.score += delta;
	return delta;
}

export function noteClear(state: ScoreState, lineCount: number, boardClear: boolean): number {
	state.consecutiveClears += 1;
	state.nonClearStreak = 0;
	if (state.consecutiveClears >= STREAK_START_AFTER_CLEARS) {
		state.combo = state.consecutiveClears;
	}
	state.nonClearLimit = boardClear
		? RESET_STREAK_AFTER_BOARD_CLEAR
		: RESET_STREAK_AFTER_NON_CLEARS;
	const delta = scoreForLines(lineCount, boardClear);
	state.score += delta;
	return delta;
}

export function noteNonClear(state: ScoreState): void {
	state.consecutiveClears = 0;
	state.nonClearStreak += 1;
	if (state.nonClearStreak >= state.nonClearLimit) {
		state.combo = 0;
		state.nonClearStreak = 0;
		state.nonClearLimit = RESET_STREAK_AFTER_NON_CLEARS;
	}
}
