export const BOARD_SIZE = 8;

export const LAYOUT_WIDTH = 1080;
export const LAYOUT_HEIGHT = 1920;

/** Design-time portrait defaults. Live playfield geom is `hud` in hud.ts. */
export const CELL_STRIDE = 120;
export const CELL_SIZE = CELL_STRIDE;
export const BOARD_PIXEL = BOARD_SIZE * CELL_STRIDE;
export const BOARD_LEFT = (LAYOUT_WIDTH - BOARD_PIXEL) / 2;
export const BOARD_TOP = 340;

export const BOARD_LAYER = "Board";
export const BANK_LAYER = "Bank";
export const DRAG_LAYER = "Drag";

export const EMPTY_CELL_OPACITY = 0.22;
export const UNPLACEABLE_OPACITY = 0.32;
export const PREVIEW_OPACITY = 0.45;

export const BANK_COUNT = 3;

export const BANK_Y = 1640;
export const BANK_X: readonly number[] = [220, 540, 860];
export const BANK_HIT_RADIUS = 150;


export const HOVER_SCALE = 1.0;

export let SCORE_PER_CELL = 1;
export let LINE_CLEAR_SCORES: number[] = [10, 20, 60, 100, 150, 250];
export let BOARD_CLEAR_BONUS = 300;

export let STREAK_START_AFTER_CLEARS = 2;
export let RESET_STREAK_AFTER_NON_CLEARS = 3;
export let RESET_STREAK_AFTER_BOARD_CLEAR = 7;

export let LOSE_DELAY_MS = 500;
export let HIT_STOP_MS = 200;
export let HIT_STOP_AFTER_LINES = 3;

export let DRAG_OFFSET_Y = 125;
export let BANK_SCALE = 0.5;

export interface ClassicFile {
	score: {
		perCell: number;
		lineClears: number[];
		boardClear: number;
		streakStartAfterClears: number;
		resetStreakAfterNonClears: number;
		resetStreakAfterBoardClear: number;
	};
	feel: {
		dragOffsetY: number;
		bankScale: number;
		loseDelayMs: number;
		hitStopMs: number;
		hitStopAfterLines: number;
	};
}

export function applyClassicConfig(data: ClassicFile): void {
	SCORE_PER_CELL = data.score.perCell;
	LINE_CLEAR_SCORES = data.score.lineClears.slice();
	BOARD_CLEAR_BONUS = data.score.boardClear;
	STREAK_START_AFTER_CLEARS = data.score.streakStartAfterClears;
	RESET_STREAK_AFTER_NON_CLEARS = data.score.resetStreakAfterNonClears;
	RESET_STREAK_AFTER_BOARD_CLEAR = data.score.resetStreakAfterBoardClear;
	DRAG_OFFSET_Y = data.feel.dragOffsetY;
	BANK_SCALE = data.feel.bankScale;
	LOSE_DELAY_MS = data.feel.loseDelayMs;
	HIT_STOP_MS = data.feel.hitStopMs;
	HIT_STOP_AFTER_LINES = data.feel.hitStopAfterLines;
}


