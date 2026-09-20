import {
	BANK_COUNT,
	BANK_HIT_RADIUS,
	BANK_X,
	BANK_Y,
	BOARD_LAYER,
	CELL_STRIDE,
	DRAG_OFFSET_Y,
	worldToCol,
	worldToRow
} from "./constants.js";
import type { Shape } from "./shape.js";

export interface Pointer {
	x: number;
	y: number;
}

interface RuntimeMouse {
	getMouseX(layer?: string | number): number;
	getMouseY(layer?: string | number): number;
	isMouseButtonDown?(button: number): boolean;
}

interface RuntimeTouch {
	getTouchCount?(): number;
	getTouchX?(index: number, layer?: string | number): number;
	getTouchY?(index: number, layer?: string | number): number;
	touches?: ReadonlyArray<{ x: number; y: number }>;
}

function runtimeMouse(runtime: IRuntime): RuntimeMouse | undefined {
	return (runtime as IRuntime & { mouse?: RuntimeMouse }).mouse;
}

function runtimeTouch(runtime: IRuntime): RuntimeTouch | undefined {
	return (runtime as IRuntime & { touch?: RuntimeTouch }).touch;
}

/** True while left mouse is down or at least one touch is active. */
export function isPointerHeld(runtime: IRuntime): boolean {
	try {
		const touch = runtimeTouch(runtime);
		if (touch?.getTouchCount && touch.getTouchCount() > 0) return true;
		if (touch?.touches && touch.touches.length > 0) return true;
	} catch {
		/* ignore */
	}
	try {
		const mouse = runtimeMouse(runtime);
		if (mouse?.isMouseButtonDown && mouse.isMouseButtonDown(0)) return true;
	} catch {
		/* ignore */
	}
	return false;
}

/**
 * Layout-space cursor. Prefer Mouse/Touch plugins (already converted).
 * Do not use PointerEvent.clientX as layout x — letterbox makes that miss the bank.
 */
export function pollLayoutPos(runtime: IRuntime): Pointer {
	try {
		const touch = runtimeTouch(runtime);
		if (touch?.getTouchCount && touch.getTouchCount() > 0 && touch.getTouchX && touch.getTouchY) {
			return {
				x: touch.getTouchX(0, BOARD_LAYER),
				y: touch.getTouchY(0, BOARD_LAYER)
			};
		}
		const t0 = touch?.touches?.[0];
		if (t0 && typeof t0.x === "number" && typeof t0.y === "number") {
			return { x: t0.x, y: t0.y };
		}
	} catch {
		/* ignore */
	}
	try {
		const mouse = runtimeMouse(runtime);
		if (mouse) {
			try {
				return {
					x: mouse.getMouseX(BOARD_LAYER),
					y: mouse.getMouseY(BOARD_LAYER)
				};
			} catch {
				return { x: mouse.getMouseX(), y: mouse.getMouseY() };
			}
		}
	} catch {
		/* ignore */
	}
	return { x: 0, y: 0 };
}

export function instanceContains(inst: IWorldInstance, x: number, y: number): boolean {
	const hw = inst.width / 2;
	const hh = inst.height / 2;
	return x >= inst.x - hw && x <= inst.x + hw && y >= inst.y - hh && y <= inst.y + hh;
}

export function hitBankSlot(x: number, y: number): number | null {
	let best = -1;
	let bestDist = BANK_HIT_RADIUS;
	for (let i = 0; i < BANK_COUNT; i++) {
		const dx = x - BANK_X[i]!;
		const dy = y - BANK_Y;
		const d = Math.hypot(dx, dy);
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best >= 0 ? best : null;
}

/** Snap a dragged shape so its bounding box top-left maps to a grid origin. */
export function snapOrigin(shape: Shape, fingerX: number, fingerY: number): {
	col: number;
	row: number;
} {
	const w = shape.cols * CELL_STRIDE;
	const h = shape.rows * CELL_STRIDE;
	const left = fingerX - w / 2;
	const top = fingerY - DRAG_OFFSET_Y - h;
	return {
		col: worldToCol(left + CELL_STRIDE / 2),
		row: worldToRow(top + CELL_STRIDE / 2)
	};
}
