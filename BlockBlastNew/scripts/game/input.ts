import { BANK_COUNT, BOARD_LAYER } from "./constants.js";
import { hud, liftedDragPoint, worldToCol, worldToRow } from "./hud.js";
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

function xy(value: unknown): Pointer {
	if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
		return { x: value[0], y: value[1] };
	}
	if (value !== null && typeof value === "object" && "x" in value && "y" in value) {
		const v = value as { x: unknown; y: unknown };
		if (typeof v.x === "number" && typeof v.y === "number") {
			return { x: v.x, y: v.y };
		}
	}
	return { x: 0, y: 0 };
}

/** Convert a Construct pointer/mouse event (client CSS px) to Board layer coords. */
export function layoutPosFromEvent(runtime: IRuntime, event?: unknown): Pointer {
	const e = event as { clientX?: number; clientY?: number } | undefined;
	const layer = runtime.layout.getLayer(BOARD_LAYER);
	if (layer?.cssPxToLayer && e && typeof e.clientX === "number" && typeof e.clientY === "number") {
		return xy(layer.cssPxToLayer(e.clientX, e.clientY));
	}
	return pollLayoutPos(runtime);
}

export function isPrimaryButton(event?: unknown): boolean {
	const button = (event as { button?: number } | undefined)?.button;
	return button === undefined || button === 0;
}

export function isMouseHeld(runtime: IRuntime): boolean {
	try {
		const mouse = runtimeMouse(runtime);
		return !!(mouse?.isMouseButtonDown && mouse.isMouseButtonDown(0));
	} catch {
		return false;
	}
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

export function instanceContains(
	inst: { x: number; y: number; width: number; height: number },
	x: number,
	y: number
): boolean {
	const hw = inst.width / 2;
	const hh = inst.height / 2;
	return x >= inst.x - hw && x <= inst.x + hw && y >= inst.y - hh && y <= inst.y + hh;
}

export function hitBankSlot(x: number, y: number): number | null {
	let best = -1;
	let bestDist = hud.bankHitRadius;
	for (let i = 0; i < BANK_COUNT; i++) {
		const dx = x - hud.bankX[i]!;
		const dy = y - hud.bankY[i]!;
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
	const cell = hud.cellSize;
	const w = shape.cols * cell;
	const h = shape.rows * cell;
	const p = liftedDragPoint(fingerX, fingerY, h);
	const left = p.x - w / 2;
	const top = p.y - h;
	return {
		col: worldToCol(left + cell / 2),
		row: worldToRow(top + cell / 2)
	};
}
