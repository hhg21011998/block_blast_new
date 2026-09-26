/**
 * On-screen HUD (score, combo, best) and the game-over overlay with a replay button.
 * Uses the `HudText` Text object (created at runtime; one template instance sits
 * off-screen on the ObjectBanks layout) and the `Block` sprite for the button face
 * and the dark panel. Positions follow the live geometry in `hud` (hud.ts):
 *   - PC landscape: the reserved left strip (hud.uiLeft / hud.uiWidth)
 *   - portrait / mobile: the band above the board
 *
 * Every public method is fail-safe: if Text/Sprite creation or a property write
 * throws, the HUD hides itself and gameplay keeps running.
 */
import { BOARD_LAYER, BOARD_SIZE, DRAG_LAYER } from "./constants.js";
import { hud } from "./hud.js";

export const HUD_TEXT_OBJECT = "HudText";
const FONT_FACE = "Arial";
const BUTTON_ANIMATION = "Green";
const PANEL_ANIMATION = "Indigo";
const PANEL_OPACITY = 0.78;
/**
 * Fallback width estimate (fraction of font px per character) used only when the
 * runtime cannot measure the text yet. Deliberately generous for bold caps.
 */
const GLYPH_WIDTH = 0.7;
/** Text boxes are this many times wider than the fit width so text never wraps. */
const NO_WRAP_BOX_SCALE = 3;
/** Ticks to keep re-measuring after a change (textWidth can lag a draw). */
const REFIT_TICKS = 3;

/**
 * Fitted base font size (pt) of the combo text; 0 until the HUD has laid out and
 * again after the HUD is disposed. Owned by `activeUi`: only the live GameUi writes
 * it, and its dispose() resets the value and drops every listener.
 */
let comboFitSizePt = 0;
const comboFitListeners = new Set<(sizePt: number) => void>();
let activeUi: GameUi | null = null;
/** Advanced once per tick by the live GameUi; see `place` for why. */
let fitFrame = 0;

/**
 * Current fitted `sizePt` of the COMBO text (base size for a scale/size tween).
 * Changes after score updates and resize refits; subscribe with onComboFitSizeChange.
 */
export function getComboFitSizePt(): number {
	return comboFitSizePt;
}

/**
 * Called whenever the fitted combo size changes (e.g. after a resize refit or a new
 * combo value; not while the combo text is hidden). Listeners are cleared when the
 * HUD is disposed (layout end / game rebuild), so subscribe again for a new layout.
 */
export function onComboFitSizeChange(listener: (sizePt: number) => void): () => void {
	comboFitListeners.add(listener);
	return () => comboFitListeners.delete(listener);
}

function setComboFitSizePt(sizePt: number): void {
	if (sizePt === comboFitSizePt) return;
	comboFitSizePt = sizePt;
	for (const listener of comboFitListeners) {
		try {
			listener(sizePt);
		} catch (err) {
			console.warn("[BlockBlast] combo fit listener failed", err);
		}
	}
}

type Rgb = [number, number, number];
type HAlign = "left" | "center" | "right";

/** Subset of Construct's ITextInstance used here. */
type TextInst = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	readonly originX?: number;
	readonly originY?: number;
	text: string;
	fontFace: string;
	sizePt: number;
	isBold: boolean;
	fontColor: Rgb;
	horizontalAlign: HAlign;
	verticalAlign: "top" | "center" | "bottom";
	/** Construct: "word" | "cjk" | "character" (there is no "none"). */
	wordWrapMode?: string;
	/** Measured text size in layout px; may lag until the next draw. */
	readonly textWidth?: number;
	destroy(): void;
	moveToTop?(): void;
};

type SpriteInst = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	colorRgb?: Rgb;
	setAnimation(name: string): void;
	destroy(): void;
	moveToTop?(): void;
};

interface Box {
	cx: number;
	cy: number;
	w: number;
	h: number;
	size: number;
	align: HAlign;
}

export interface HudValues {
	score: number;
	combo: number;
	best: number;
}

export interface GameOverInfo {
	score: number;
	best: number;
	newBest: boolean;
}

interface Overlay {
	panel: SpriteInst | null;
	title: TextInst | null;
	score: TextInst | null;
	best: TextInst | null;
	button: SpriteInst | null;
	label: TextInst | null;
}

const WHITE: Rgb = [1, 1, 1];
const GOLD: Rgb = [1, 0.84, 0.3];
const CYAN: Rgb = [0.55, 0.9, 1];
const PANEL_TINT: Rgb = [0.05, 0.04, 0.1];

export class GameUi {
	private readonly runtime: IRuntime;
	private scoreText: TextInst | null = null;
	private comboText: TextInst | null = null;
	private bestText: TextInst | null = null;
	private overlay: Overlay | null = null;
	private info: GameOverInfo | null = null;
	private values: HudValues = { score: 0, combo: 0, best: 0 };
	/** Set after any HUD failure: stop creating text, keep hit-testing working. */
	private textBroken = false;
	private warned = false;
	private refitTicks = 0;
	private readonly onTick = (): void => {
		if (activeUi === this) fitFrame++;
		if (this.refitTicks <= 0) return;
		this.refitTicks--;
		this.guard("refit HUD", () => {
			this.fitHud();
			if (this.overlay) this.fitOverlay(this.overlay);
		});
	};

	constructor(runtime: IRuntime) {
		this.runtime = runtime;
		activeUi = this;
		runtime.addEventListener("tick", this.onTick);
	}

	create(): void {
		this.guard("create HUD", () => {
			this.destroyHud();
			this.bestText = this.makeText(BOARD_LAYER, GOLD);
			this.scoreText = this.makeText(BOARD_LAYER, WHITE);
			this.comboText = this.makeText(BOARD_LAYER, CYAN);
			this.layoutHud();
		});
	}

	setValues(values: HudValues): void {
		this.values = values;
		this.guard("update HUD", () => this.layoutHud());
	}

	/** Re-place everything after a HUD/viewport change. */
	layout(): void {
		this.guard("layout HUD", () => {
			this.layoutHud();
			if (this.overlay) this.layoutOverlay(this.overlay);
		});
	}

	/**
	 * Show the panel. The overlay (and so the replay hit area) exists even if
	 * every instance failed to spawn, so the player can always restart.
	 */
	showGameOver(info: GameOverInfo): void {
		this.hideGameOver();
		this.info = info;
		const overlay: Overlay = {
			panel: null,
			title: null,
			score: null,
			best: null,
			button: null,
			label: null
		};
		this.overlay = overlay;
		this.guard("show game over", () => {
			overlay.panel = this.makePanel();
			overlay.title = this.makeText(DRAG_LAYER, info.newBest ? GOLD : WHITE);
			overlay.score = this.makeText(DRAG_LAYER, WHITE);
			overlay.best = this.makeText(DRAG_LAYER, GOLD);
			overlay.button = this.makeButton();
			// Created last so it draws above the button face.
			overlay.label = this.makeText(DRAG_LAYER, WHITE);
			this.layoutOverlay(overlay);
		});
	}

	hideGameOver(): void {
		const o = this.overlay;
		this.overlay = null;
		this.info = null;
		if (!o) return;
		for (const inst of [o.panel, o.title, o.score, o.best, o.button, o.label]) {
			safeDestroy(inst);
		}
	}

	isGameOverVisible(): boolean {
		return this.overlay !== null;
	}

	/** Hit test against the replay button (works even if the sprite failed to spawn). */
	hitReplay(x: number, y: number): boolean {
		if (!this.overlay) return false;
		const b = this.overlayBoxes().button;
		return Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2;
	}

	dispose(): void {
		this.runtime.removeEventListener("tick", this.onTick);
		this.hideGameOver();
		this.destroyHud();
		if (activeUi === this) {
			activeUi = null;
			comboFitSizePt = 0;
			comboFitListeners.clear();
		}
	}

	/** Place + fit now, then re-measure for a few ticks in case textWidth lagged. */
	private layoutHud(): void {
		this.fitHud();
		this.refitTicks = REFIT_TICKS;
	}

	private layoutOverlay(o: Overlay): void {
		this.fitOverlay(o);
		this.refitTicks = REFIT_TICKS;
	}

	private fitHud(): void {
		const { score, combo, best } = this.values;
		const boxes = this.hudBoxes();
		place(this.bestText, boxes.best, `BEST ${Math.max(best, score)}`);
		place(this.scoreText, boxes.score, String(score));
		// Hidden combo ("") returns 0: keep the previous base size, fire nothing.
		const comboPt = place(this.comboText, boxes.combo, combo > 0 ? `COMBO x${combo}` : "");
		if (comboPt > 0 && activeUi === this) setComboFitSizePt(comboPt);
	}

	private fitOverlay(o: Overlay): void {
		const info = this.info;
		if (!info) return;
		const b = this.overlayBoxes();
		placeSprite(o.panel, b.panel);
		placeSprite(o.button, b.button);
		place(o.title, b.title, info.newBest ? "NEW BEST!" : "GAME OVER");
		place(o.score, b.score, `Score ${info.score}`);
		place(o.best, b.best, `Best ${info.best}`);
		place(o.label, b.label, "REPLAY");
	}

	private hudBoxes(): { best: Box; score: Box; combo: Box } {
		const cell = hud.cellSize;
		const boardPx = cell * BOARD_SIZE;
		if (hud.landscape && hud.uiWidth > 0) {
			const cx = hud.uiLeft + hud.uiWidth / 2;
			const w = hud.uiWidth * 0.86;
			const midY = hud.boardTop + boardPx * 0.4;
			return {
				best: box(cx, hud.boardTop + cell * 0.6, w, cell * 0.36, "center"),
				score: box(cx, midY, w, cell * 0.62, "center"),
				combo: box(cx, midY + cell * 1.3, w, cell * 0.34, "center")
			};
		}
		const left = hud.boardLeft;
		const right = left + boardPx;
		const half = boardPx / 2;
		const rowY = hud.boardTop - cell * 1.9;
		return {
			best: box(left + half / 2, rowY, half, cell * 0.3, "left"),
			score: box(left + half, hud.boardTop - cell * 0.8, boardPx, cell * 0.62, "center"),
			combo: box(right - half / 2, rowY, half, cell * 0.3, "right")
		};
	}

	private overlayBoxes(): {
		panel: Box;
		title: Box;
		score: Box;
		best: Box;
		button: Box;
		label: Box;
	} {
		const cell = hud.cellSize;
		const boardPx = cell * BOARD_SIZE;
		const cx = hud.boardLeft + boardPx / 2;
		const cy = hud.boardTop + boardPx / 2;
		const w = boardPx * 0.9;
		const buttonW = Math.min(boardPx * 0.6, cell * 4.5);
		const buttonH = cell * 1.1;
		const buttonY = cy + cell * 1.8;
		// Panel spans from above the title to below the button.
		const panelTop = cy - cell * 2.9;
		const panelBottom = buttonY + buttonH / 2 + cell * 0.5;
		return {
			panel: rect(cx, (panelTop + panelBottom) / 2, boardPx * 0.96, panelBottom - panelTop),
			title: box(cx, cy - cell * 2, w, cell * 0.6, "center"),
			score: box(cx, cy - cell * 0.7, w, cell * 0.42, "center"),
			best: box(cx, cy + cell * 0.2, w, cell * 0.32, "center"),
			button: rect(cx, buttonY, buttonW, buttonH),
			label: box(cx, buttonY, buttonW * 0.9, cell * 0.42, "center")
		};
	}

	private makeText(layer: string, color: Rgb): TextInst | null {
		if (this.textBroken) return null;
		const type = (this.runtime.objects as unknown as Record<string, IObjectType | undefined>)[
			HUD_TEXT_OBJECT
		];
		if (!type) {
			this.fail(`object type "${HUD_TEXT_OBJECT}" (Text) is missing`);
			return null;
		}
		let inst: TextInst | null = null;
		try {
			inst = type.createInstance(layer, -10000, -10000) as unknown as TextInst;
			inst.fontFace = FONT_FACE;
			inst.isBold = true;
			inst.fontColor = [color[0], color[1], color[2]];
			inst.verticalAlign = "center";
			// No "none" mode exists; the oversized box in place() is what prevents wrapping.
			inst.wordWrapMode = "word";
			inst.text = "";
			inst.moveToTop?.();
			return inst;
		} catch (err) {
			safeDestroy(inst);
			this.fail(`could not create ${HUD_TEXT_OBJECT}`, err);
			return null;
		}
	}

	private makeButton(): SpriteInst | null {
		return this.makeSprite(BUTTON_ANIMATION, 1, null);
	}

	private makePanel(): SpriteInst | null {
		return this.makeSprite(PANEL_ANIMATION, PANEL_OPACITY, PANEL_TINT);
	}

	private makeSprite(animation: string, opacity: number, tint: Rgb | null): SpriteInst | null {
		let inst: SpriteInst | null = null;
		try {
			inst = this.runtime.objects.Block.createInstance(
				DRAG_LAYER,
				-10000,
				-10000
			) as unknown as SpriteInst;
			inst.setAnimation(animation);
			inst.opacity = opacity;
			if (tint) inst.colorRgb = [tint[0], tint[1], tint[2]];
			inst.moveToTop?.();
			return inst;
		} catch (err) {
			safeDestroy(inst);
			console.warn("[BlockBlast] could not create overlay sprite", err);
			return null;
		}
	}

	private destroyHud(): void {
		safeDestroy(this.bestText);
		safeDestroy(this.scoreText);
		safeDestroy(this.comboText);
		this.bestText = null;
		this.scoreText = null;
		this.comboText = null;
	}

	/** Run a HUD step; on error hide the HUD instead of breaking the game. */
	private guard(label: string, fn: () => void): void {
		try {
			fn();
		} catch (err) {
			this.fail(`HUD step "${label}" failed`, err);
			this.destroyHud();
		}
	}

	private fail(message: string, err?: unknown): void {
		this.textBroken = true;
		if (this.warned) return;
		this.warned = true;
		console.warn(`[BlockBlast] ${message}; HUD hidden, gameplay continues`, err ?? "");
	}
}

function box(cx: number, cy: number, w: number, sizePx: number, align: HAlign): Box {
	return { cx, cy, w, h: sizePx * 2, size: sizePx, align };
}

function rect(cx: number, cy: number, w: number, h: number): Box {
	return { cx, cy, w, h, size: 0, align: "center" };
}

/**
 * Set text and fit it on one line. `b.size` is the preferred glyph height in layout
 * px; the font shrinks so the line fits inside `b.w` (e.g. "COMBO x12" or a 6-digit
 * score in the narrow landscape strip). Uses the runtime's measured `textWidth`
 * when it reports one, else a per-character estimate; the caller re-runs this on
 * the next few ticks so a lagging measurement converges. Returns the sizePt set.
 *
 * Wrapping: Construct Text always wraps at the box edge, so the box is made
 * NO_WRAP_BOX_SCALE x wider than the fit width, anchored on the aligned side
 * (centred text stays centred on `b.cx`). The visible line still fits `b.w`.
 */
function place(inst: TextInst | null, b: Box, text: string): number {
	if (!inst) return 0;
	let st = fitStates.get(inst);
	if (!st) {
		st = { pt: inst.sizePt, frame: fitFrame, good: null };
		fitStates.set(inst, st);
	}
	if (inst.text !== text) {
		inst.text = text;
		st.frame = fitFrame;
	}
	placeBox(inst, b);
	// Hidden/empty text: leave the size alone (no jump to the box maximum).
	if (text.length === 0) return 0;

	// Harvest `textWidth` only when it must describe what we see now: our last
	// text/size write happened on an earlier tick (so a draw has run since) and
	// nobody else (e.g. a size tween) has changed sizePt in between.
	const measured = inst.textWidth;
	if (
		st.frame < fitFrame &&
		inst.sizePt === st.pt &&
		typeof measured === "number" &&
		measured > 0
	) {
		st.good = { pt: st.pt, width: measured, len: text.length };
	}

	// Width per pt: from the last trustworthy measurement (scaled by character
	// count if the text changed since), else the per-character estimate.
	const perPt = st.good
		? (st.good.width / st.good.pt) * (text.length / st.good.len)
		: (text.length * GLYPH_WIDTH) / 0.75;
	const maxPt = Math.max(8, Math.floor(b.size * 0.75));
	// 2% margin for rounding.
	const pt = Math.max(8, Math.min(maxPt, Math.floor((b.w * 0.98) / perPt)));
	// Only write on a real change so refit ticks settle and tweens are not clobbered.
	if (Math.abs(st.pt - pt) >= 1) {
		inst.sizePt = pt;
		st.pt = pt;
		st.frame = fitFrame;
	}
	return st.pt;
}

interface FitState {
	/** sizePt we last wrote. */
	pt: number;
	/** fitFrame of our last text/size write; textWidth is stale until a later tick. */
	frame: number;
	/** Last measurement known to match its sizePt and text length. */
	good: { pt: number; width: number; len: number } | null;
}

const fitStates = new WeakMap<object, FitState>();

/** Oversized, side-anchored box so the line never wraps (see `place`). */
function placeBox(inst: TextInst, b: Box): void {
	const boxW = b.w * NO_WRAP_BOX_SCALE;
	let left = b.cx - boxW / 2;
	if (b.align === "left") left = b.cx - b.w / 2;
	else if (b.align === "right") left = b.cx + b.w / 2 - boxW;
	inst.width = boxW;
	inst.height = b.h;
	inst.horizontalAlign = b.align;
	// Construct Text defaults to a top-left origin; honour a custom origin if present.
	inst.x = left + boxW * (inst.originX ?? 0);
	inst.y = b.cy - b.h / 2 + b.h * (inst.originY ?? 0);
}

/** Block sprites have a centred origin. */
function placeSprite(inst: SpriteInst | null, b: Box): void {
	if (!inst) return;
	inst.x = b.cx;
	inst.y = b.cy;
	inst.width = b.w;
	inst.height = b.h;
}

function safeDestroy(inst: { destroy(): void } | null): void {
	if (!inst) return;
	try {
		inst.destroy();
	} catch {
		// Already destroyed (e.g. layout ended) — nothing to do.
	}
}
