import {
	BANK_COUNT,
	BANK_SCALE,
	BOARD_LAYER,
	BOARD_SIZE,
	LAYOUT_HEIGHT,
	LAYOUT_WIDTH
} from "./constants.js";

export interface ViewRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface HudState {
	landscape: boolean;
	cellSize: number;
	boardLeft: number;
	boardTop: number;
	bankX: number[];
	bankY: number[];
	bankScale: number;
	bankHitRadius: number;
	dragOffsetY: number;
	/** Reserved strip on the left (PC landscape) for score/buttons later. */
	uiLeft: number;
	uiWidth: number;
}

export const hud: HudState = {
	landscape: false,
	cellSize: 120,
	boardLeft: (LAYOUT_WIDTH - BOARD_SIZE * 120) / 2,
	boardTop: 340,
	bankX: [220, 540, 860],
	bankY: [1640, 1640, 1640],
	bankScale: 0.5,
	bankHitRadius: 150,
	dragOffsetY: 125,
	uiLeft: 0,
	uiWidth: 0
};

export function applyHud(runtime: IRuntime): void {
	if (isHandheld(runtime)) {
		layoutMobileOriginal();
		return;
	}
	const view = readViewport(runtime);
	if (view.width <= 1 || view.height <= 1) return;
	if (view.width > view.height) {
		layoutLandscape(view);
	} else {
		layoutPortrait(view);
	}
}

/** Fingerprint of the CSS window — poll this to catch resizes Construct might skip. */
export function hudWindowKey(runtime: IRuntime): string {
	if (isHandheld(runtime)) return "mobile";
	const css = cssSize(runtime);
	return `pc:${Math.round(css.w)}x${Math.round(css.h)}`;
}

function isHandheld(runtime: IRuntime): boolean {
	const os = (
		runtime as IRuntime & { platformInfo?: { os?: string } }
	).platformInfo?.os;
	const name = (os ?? "").toLowerCase();
	return name.includes("android") || name.includes("ios") || name.includes("iphone");
}

function layoutMobileOriginal(): void {
	hud.landscape = false;
	hud.cellSize = 120;
	hud.boardLeft = (LAYOUT_WIDTH - BOARD_SIZE * 120) / 2;
	hud.boardTop = 340;
	hud.bankX = [220, 540, 860];
	hud.bankY = [1640, 1640, 1640];
	hud.bankScale = BANK_SCALE;
	hud.bankHitRadius = 150;
	hud.dragOffsetY = 125;
	hud.uiLeft = 0;
	hud.uiWidth = 0;
}

function layoutPortrait(view: ViewRect): void {
	hud.landscape = false;
	const marginX = Math.max(24, view.width * 0.04);
	const topHud = Math.min(340, view.height * 0.18);
	const bankBand = Math.min(360, view.height * 0.22);
	const availH = Math.max(120, view.height - topHud - bankBand);
	const cell = Math.max(
		24,
		Math.floor(Math.min((view.width - marginX * 2) / BOARD_SIZE, availH / BOARD_SIZE))
	);
	const boardPx = cell * BOARD_SIZE;
	hud.cellSize = cell;
	hud.boardLeft = view.left + (view.width - boardPx) / 2;
	hud.boardTop = view.top + topHud + Math.max(0, (availH - boardPx) / 2);
	const slotW = view.width / BANK_COUNT;
	const bankY = view.top + view.height - bankBand / 2;
	hud.bankX = [];
	hud.bankY = [];
	for (let i = 0; i < BANK_COUNT; i++) {
		hud.bankX.push(view.left + slotW * (i + 0.5));
		hud.bankY.push(bankY);
	}
	hud.bankScale = BANK_SCALE;
	hud.bankHitRadius = Math.max(120, cell * 1.25);
	hud.dragOffsetY = Math.round(cell * (125 / 120));
	hud.uiLeft = view.left;
	hud.uiWidth = 0;
}

function layoutLandscape(view: ViewRect): void {
	hud.landscape = true;
	const margin = Math.max(20, Math.min(view.width, view.height) * 0.03);
	const uiWidth = Math.max(220, Math.min(360, view.width * 0.16));
	const bankCol = Math.max(260, view.width * 0.18);
	const availW = view.width - uiWidth - bankCol - margin * 2;
	const availH = view.height - margin * 2;
	const cell = Math.max(24, Math.floor(Math.min(availW, availH) / BOARD_SIZE));
	const boardPx = cell * BOARD_SIZE;
	hud.cellSize = cell;
	hud.uiLeft = view.left;
	hud.uiWidth = uiWidth;
	hud.boardLeft = view.left + uiWidth;
	hud.boardTop = view.top + (view.height - boardPx) / 2;
	const bankLeft = hud.boardLeft + boardPx + margin;
	const bankRight = view.left + view.width - margin;
	const bankCx = (bankLeft + bankRight) / 2;
	const slotH = boardPx / BANK_COUNT;
	hud.bankX = [];
	hud.bankY = [];
	for (let i = 0; i < BANK_COUNT; i++) {
		hud.bankX.push(bankCx);
		hud.bankY.push(hud.boardTop + slotH * (i + 0.5));
	}
	const maxPiece = 5 * cell;
	hud.bankScale = Math.min(0.85, (slotH * 0.78) / Math.max(1, maxPiece));
	hud.bankHitRadius = Math.max(90, cell * hud.bankScale * 2.2);
	hud.dragOffsetY = Math.round(cell * (125 / 120));
}

function readViewport(runtime: IRuntime): ViewRect {
	const css = cssSize(runtime);
	const layer = runtime.layout.getLayer(BOARD_LAYER) as ILayer & {
		getViewport?: () => {
			x?: number;
			y?: number;
			left?: number;
			top?: number;
			right?: number;
			bottom?: number;
			width: number;
			height: number;
		};
	} | null;

	const fromApi = viewportFromLayer(layer);
	if (fromApi && css.w > css.h && fromApi.width <= fromApi.height + 1) {
		return scaleOuterVisible(runtime, css);
	}
	if (fromApi) return fromApi;

	const fromCss = viewportFromCssPx(layer, runtime, css);
	if (fromCss && css.w > css.h && fromCss.width <= fromCss.height + 1) {
		return scaleOuterVisible(runtime, css);
	}
	if (fromCss) return fromCss;

	return scaleOuterVisible(runtime, css);
}

function viewportFromLayer(
	layer: { getViewport?: () => { x?: number; y?: number; left?: number; top?: number; width: number; height: number } } | null
): ViewRect | null {
	if (!layer || typeof layer.getViewport !== "function") return null;
	try {
		const gv = layer.getViewport();
		if (!gv || typeof gv.width !== "number" || gv.width <= 1 || gv.height <= 1) {
			return null;
		}
		const left = gv.left ?? gv.x ?? 0;
		const top = gv.top ?? gv.y ?? 0;
		return { left, top, width: gv.width, height: gv.height };
	} catch {
		return null;
	}
}

function viewportFromCssPx(
	layer: ILayer | null,
	runtime: IRuntime,
	css: { w: number; h: number }
): ViewRect | null {
	if (!layer?.cssPxToLayer || css.w <= 1 || css.h <= 1) return null;
	const pi = (
		runtime as IRuntime & {
			platformInfo?: { canvasClientX?: number; canvasClientY?: number };
		}
	).platformInfo;
	const x0 = pi?.canvasClientX ?? 0;
	const y0 = pi?.canvasClientY ?? 0;
	try {
		const a = xy(layer.cssPxToLayer(x0, y0));
		const b = xy(layer.cssPxToLayer(x0 + css.w, y0 + css.h));
		const width = Math.abs(b.x - a.x);
		const height = Math.abs(b.y - a.y);
		if (width <= 1 || height <= 1) return null;
		return {
			left: Math.min(a.x, b.x),
			top: Math.min(a.y, b.y),
			width,
			height
		};
	} catch {
		return null;
	}
}

function scaleOuterVisible(runtime: IRuntime, css: { w: number; h: number }): ViewRect {
	const vw =
		(runtime as IRuntime & { viewportWidth?: number }).viewportWidth ?? LAYOUT_WIDTH;
	const vh =
		(runtime as IRuntime & { viewportHeight?: number }).viewportHeight ?? LAYOUT_HEIGHT;
	if (css.w <= 1 || css.h <= 1) {
		return { left: 0, top: 0, width: vw, height: vh };
	}
	const scale = Math.min(css.w / vw, css.h / vh);
	if (scale <= 0) return { left: 0, top: 0, width: vw, height: vh };
	const visW = css.w / scale;
	const visH = css.h / scale;
	const layout = runtime.layout as ILayout & { scrollX?: number; scrollY?: number };
	const cx = typeof layout.scrollX === "number" ? layout.scrollX : vw / 2;
	const cy = typeof layout.scrollY === "number" ? layout.scrollY : vh / 2;
	return {
		left: cx - visW / 2,
		top: cy - visH / 2,
		width: visW,
		height: visH
	};
}

function cssSize(runtime: IRuntime): { w: number; h: number } {
	const pi = (
		runtime as IRuntime & {
			platformInfo?: {
				windowInnerWidth?: number;
				windowInnerHeight?: number;
				canvasCssWidth?: number;
				canvasCssHeight?: number;
			};
		}
	).platformInfo;
	if (pi?.windowInnerWidth && pi.windowInnerHeight) {
		return { w: pi.windowInnerWidth, h: pi.windowInnerHeight };
	}
	if (pi?.canvasCssWidth && pi.canvasCssHeight) {
		return { w: pi.canvasCssWidth, h: pi.canvasCssHeight };
	}
	const g = globalThis as { innerWidth?: number; innerHeight?: number };
	if (typeof g.innerWidth === "number" && typeof g.innerHeight === "number") {
		return { w: g.innerWidth, h: g.innerHeight };
	}
	return { w: LAYOUT_WIDTH, h: LAYOUT_HEIGHT };
}

export function cellCenterX(col: number): number {
	return hud.boardLeft + col * hud.cellSize + hud.cellSize / 2;
}

export function cellCenterY(row: number): number {
	return hud.boardTop + row * hud.cellSize + hud.cellSize / 2;
}

export function worldToCol(x: number): number {
	return Math.floor((x - hud.boardLeft) / hud.cellSize);
}

export function worldToRow(y: number): number {
	return Math.floor((y - hud.boardTop) / hud.cellSize);
}

function xy(value: unknown): { x: number; y: number } {
	if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
		return { x: value[0], y: value[1] };
	}
	if (value !== null && typeof value === "object" && "x" in value && "y" in value) {
		const v = value as { x: unknown; y: unknown };
		if (typeof v.x === "number" && typeof v.y === "number") return { x: v.x, y: v.y };
	}
	return { x: 0, y: 0 };
}
