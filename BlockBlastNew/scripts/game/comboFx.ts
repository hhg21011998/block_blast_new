/**
 * Combo FX: the "COMBO" + digits sprite cluster shown on each clearing move with
 * combo >= COMBO_FX_MIN (score.ts comboFxMin()).
 *
 * This module only creates and places the cluster; the animator (fx.ts) owns its
 * lifetime: ComboFx subscribes an Fx instance to the hooks below.
 * Public hooks (all return an unsubscribe function; all are cleared when the
 * Game layout ends or the game is rebuilt):
 *   onComboShown(listener)    cluster created and placed
 *   onHudRelayout(listener)   HUD geometry recomputed (resize / rotation)
 *   onGameOverStart(listener) lose delay (~0.5 s) started, before the panel
 *
 * Glyph metrics live in comboGlyphs.ts.
 */
import { BOARD_SIZE, DRAG_LAYER } from "./constants.js";
import {
	COMBO_DIGIT_GAP,
	COMBO_DIGIT_GLYPHS,
	COMBO_DIGIT_OBJECT,
	COMBO_HEIGHT_CELLS,
	COMBO_TEXT_GLYPH,
	COMBO_TEXT_OBJECT,
	COMBO_VIEW_MARGIN,
	COMBO_WORD_GAP,
	type GlyphMetrics
} from "./comboGlyphs.js";
// fx.ts only type-imports this module, so there is no runtime cycle; FX is still
// read inside build() (call time), never at module init.
import { Fx, FX } from "./fx.js";
import { cellCenterX, cellCenterY, hud, readViewport, type ViewRect } from "./hud.js";

/** Layer for the cluster: the top layer, above Board and Bank. */
export const COMBO_LAYER = DRAG_LAYER;

/** Subset of Construct's ISpriteInstance used for the cluster. */
export type ComboSprite = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	animationFrame: number;
	stopAnimation?(): void;
	destroy(): void;
	moveToTop?(): void;
};

export interface Offset {
	x: number;
	y: number;
}

export interface ComboShownInfo {
	combo: number;
	/** null only if the ComboText object type is missing. */
	comboText: ComboSprite | null;
	/** One NumberCombo per digit, most significant first; frame = digit value. */
	digits: ComboSprite[];
	/** Cluster centre in layout px (already clamped into the visible viewport). */
	centerX: number;
	centerY: number;
	/** Scale applied to every instance (image px -> layout px). */
	baseScale: number;
	/**
	 * Position of each instance relative to the centre at scale 1:
	 * index 0 = comboText, then digits in order. Instance x = centerX + offset.x * baseScale.
	 */
	offsets: Offset[];
	layer: string;
}

export interface HudRelayoutInfo {
	landscape: boolean;
	cellSize: number;
	boardLeft: number;
	boardTop: number;
	view: ViewRect;
}

export interface GameOverStartInfo {
	/** Lose delay that just started (ms); the game-over panel appears after it. */
	delayMs: number;
	score: number;
}

type Listener<T> = (info: T) => void;

const shownListeners = new Set<Listener<ComboShownInfo>>();
const relayoutListeners = new Set<Listener<HudRelayoutInfo>>();
const gameOverListeners = new Set<Listener<GameOverStartInfo>>();

export function onComboShown(listener: Listener<ComboShownInfo>): () => void {
	shownListeners.add(listener);
	return () => {
		shownListeners.delete(listener);
	};
}

export function onHudRelayout(listener: Listener<HudRelayoutInfo>): () => void {
	relayoutListeners.add(listener);
	return () => {
		relayoutListeners.delete(listener);
	};
}

export function onGameOverStart(listener: Listener<GameOverStartInfo>): () => void {
	gameOverListeners.add(listener);
	return () => {
		gameOverListeners.delete(listener);
	};
}

function emit<T>(listeners: Set<Listener<T>>, info: T, label: string): void {
	for (const listener of [...listeners]) {
		try {
			listener(info);
		} catch (err) {
			console.warn(`[BlockBlast] ${label} listener failed`, err);
		}
	}
}

/** The live controller; only its dispose() clears the module-level listeners. */
let activeFx: ComboFx | null = null;

export class ComboFx {
	private readonly runtime: IRuntime;
	private warned = new Set<string>();
	/** Tween engine for every effect (animator). The view can reuse it. */
	readonly fx: Fx;
	private readonly unsubscribe: (() => void)[];

	constructor(runtime: IRuntime) {
		this.runtime = runtime;
		activeFx = this;
		const fx = (this.fx = new Fx(runtime));
		this.unsubscribe = [
			onComboShown((info) => fx.comboPop(info)),
			onHudRelayout(() => fx.killCombo()),
			onGameOverStart((info) => fx.comboGameOver(info.delayMs))
		];
	}

	/** Create + place the cluster for `combo`, centred on the cleared lines. */
	show(combo: number, rows: readonly number[], cols: readonly number[]): void {
		try {
			const info = this.build(combo, rows, cols);
			if (!info) return;
			emit(shownListeners, info, "onComboShown");
		} catch (err) {
			console.warn("[BlockBlast] combo fx failed", err);
		}
	}

	notifyRelayout(): void {
		emit(
			relayoutListeners,
			{
				landscape: hud.landscape,
				cellSize: hud.cellSize,
				boardLeft: hud.boardLeft,
				boardTop: hud.boardTop,
				view: readViewport(this.runtime)
			},
			"onHudRelayout"
		);
	}

	notifyGameOverStart(info: GameOverStartInfo): void {
		emit(gameOverListeners, info, "onGameOverStart");
	}

	/** New run on the same layout (replay). */
	resetRun(): void {
		this.fx.killCombo();
	}

	/** Layout end / game rebuild: stop the effects, drop our own and every listener. */
	dispose(): void {
		for (const off of this.unsubscribe) off();
		this.fx.dispose();
		if (activeFx !== this) return;
		activeFx = null;
		shownListeners.clear();
		relayoutListeners.clear();
		gameOverListeners.clear();
	}

	private build(combo: number, rows: readonly number[], cols: readonly number[]): ComboShownInfo | null {
		const digitValues = String(Math.max(0, Math.floor(combo)))
			.split("")
			.map((ch) => Number(ch));
		const glyphs: GlyphMetrics[] = [
			COMBO_TEXT_GLYPH,
			...digitValues.map((d) => COMBO_DIGIT_GLYPHS[d] ?? COMBO_DIGIT_GLYPHS[0]!)
		];
		const layout = rowLayout(glyphs);

		// Base size from the board cell, then shrink so the *animated* cluster (every
		// piece at the pop peak + the full upward drift, see fx.ts comboPop) fits the
		// visible viewport, and clamp the centre with the same animated extent.
		const view = readViewport(this.runtime);
		const margin = COMBO_VIEW_MARGIN;
		const ext = animatedExtent(glyphs, layout.offsets);
		const minX = view.left + margin;
		const maxX = view.left + view.width - margin;
		const minY = view.top + margin;
		const maxY = view.top + view.height - margin;
		let scale = (hud.cellSize * COMBO_HEIGHT_CELLS) / COMBO_TEXT_GLYPH.glyphH;
		scale = Math.min(
			scale,
			Math.max(0.01, maxX - minX) / (ext.right - ext.left),
			Math.max(0.01, maxY - minY) / (ext.bottom - ext.top)
		);
		const target = clearedCenter(rows, cols);
		const centerX = clampExtent(target.x, ext.left * scale, ext.right * scale, minX, maxX);
		const centerY = clampExtent(target.y, ext.top * scale, ext.bottom * scale, minY, maxY);

		const comboText = this.spawn(COMBO_TEXT_OBJECT, 0, COMBO_TEXT_GLYPH, centerX, centerY, layout.offsets[0]!, scale);
		const digits: ComboSprite[] = [];
		digitValues.forEach((d, i) => {
			const inst = this.spawn(
				COMBO_DIGIT_OBJECT,
				d,
				glyphs[i + 1]!,
				centerX,
				centerY,
				layout.offsets[i + 1]!,
				scale
			);
			if (inst) digits.push(inst);
		});
		if (!comboText && digits.length === 0) return null;
		return {
			combo,
			comboText,
			digits,
			centerX,
			centerY,
			baseScale: scale,
			offsets: layout.offsets.map((o) => ({ x: o.x, y: o.y })),
			layer: COMBO_LAYER
		};
	}

	private spawn(
		objectName: string,
		frame: number,
		glyph: GlyphMetrics,
		centerX: number,
		centerY: number,
		offset: Offset,
		scale: number
	): ComboSprite | null {
		const type = (this.runtime.objects as unknown as Record<string, IObjectType | undefined>)[objectName];
		if (!type) {
			if (!this.warned.has(objectName)) {
				this.warned.add(objectName);
				console.warn(`[BlockBlast] object type "${objectName}" is missing; combo fx partial`);
			}
			return null;
		}
		const inst = type.createInstance(
			COMBO_LAYER,
			centerX + offset.x * scale,
			centerY + offset.y * scale
		) as unknown as ComboSprite;
		// Frames are data (digit value), not an animation: never let it play.
		inst.stopAnimation?.();
		inst.animationFrame = frame;
		// Frames differ in size; set the size explicitly from the table.
		inst.width = glyph.imageW * scale;
		inst.height = glyph.imageH * scale;
		inst.opacity = 1;
		inst.moveToTop?.();
		return inst;
	}
}

/**
 * COMBO art then the digits on one row, spaced by glyph width (not image width).
 * Offsets are instance positions (image centre) relative to the cluster centre at
 * scale 1; glyph vertical centres are aligned on y = 0.
 */
function rowLayout(glyphs: readonly GlyphMetrics[]): { width: number; height: number; offsets: Offset[] } {
	let width = 0;
	let height = 0;
	glyphs.forEach((g, i) => {
		width += g.glyphW;
		if (i === 1) width += COMBO_WORD_GAP;
		else if (i > 1) width += COMBO_DIGIT_GAP;
		height = Math.max(height, g.glyphH);
	});
	const offsets: Offset[] = [];
	let cursor = -width / 2;
	glyphs.forEach((g, i) => {
		if (i === 1) cursor += COMBO_WORD_GAP;
		else if (i > 1) cursor += COMBO_DIGIT_GAP;
		const glyphCenterX = cursor + g.glyphW / 2;
		offsets.push({ x: glyphCenterX - g.offX, y: -g.offY });
		cursor += g.glyphW;
	});
	return { width, height, offsets };
}

/**
 * Centre of the cleared lines: mean cleared column for x and mean cleared row for y;
 * a missing axis uses the board centre (e.g. only rows cleared -> board centre x).
 */
function clearedCenter(rows: readonly number[], cols: readonly number[]): Offset {
	const boardMid = (BOARD_SIZE - 1) / 2;
	const x = cols.length > 0 ? mean(cols.map(cellCenterX)) : cellCenterX(boardMid);
	const y = rows.length > 0 ? mean(rows.map(cellCenterY)) : cellCenterY(boardMid);
	return { x, y };
}

function mean(values: readonly number[]): number {
	let sum = 0;
	for (const v of values) sum += v;
	return sum / Math.max(1, values.length);
}

/**
 * Bounds of the cluster during the fx.ts comboPop animation, relative to the
 * cluster centre, in image px at baseScale 1 (multiply by baseScale for layout px).
 * Matches fx.ts: each piece's width/height is scaled by up to FX.comboPopPeak around
 * its own instance position (image centre), so its visible glyph box (centre at
 * offset + off*peak, half size glyph/2*peak) grows too; every piece moves up by
 * drift = COMBO image height * baseScale * FX.comboDrift (fx.ts uses the ComboText
 * instance height, or 241 * baseScale without it). Down/left/right get no drift.
 * Conservative: assumes the peak and the full drift at the same time.
 */
function animatedExtent(
	glyphs: readonly GlyphMetrics[],
	offsets: readonly Offset[]
): { left: number; right: number; top: number; bottom: number } {
	const peak = Math.max(1, Number(FX.comboPopPeak) || 1);
	const drift = Math.max(0, Number(FX.comboDrift) || 0) * COMBO_TEXT_GLYPH.imageH;
	let left = Infinity;
	let right = -Infinity;
	let top = Infinity;
	let bottom = -Infinity;
	glyphs.forEach((g, i) => {
		const o = offsets[i] ?? { x: 0, y: 0 };
		left = Math.min(left, o.x + (g.offX - g.glyphW / 2) * peak);
		right = Math.max(right, o.x + (g.offX + g.glyphW / 2) * peak);
		top = Math.min(top, o.y + (g.offY - g.glyphH / 2) * peak);
		bottom = Math.max(bottom, o.y + (g.offY + g.glyphH / 2) * peak);
	});
	if (!Number.isFinite(left)) return { left: -0.5, right: 0.5, top: -0.5, bottom: 0.5 };
	return { left, right, top: top - drift, bottom };
}

/**
 * Centre such that [value + lo, value + hi] stays inside [min, max] (lo <= 0 <= hi,
 * layout px). If it cannot fit, centre the extent in the range.
 */
function clampExtent(value: number, lo: number, hi: number, min: number, max: number): number {
	if (max - min <= hi - lo) return (min + max) / 2 - (lo + hi) / 2;
	return Math.min(max - hi, Math.max(min - lo, value));
}
