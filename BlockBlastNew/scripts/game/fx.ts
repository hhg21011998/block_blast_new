/**
 * Visual effects (animator). Pure TypeScript tweens driven by the runtime "tick";
 * no Construct behaviors. Everything here is cosmetic: board, score, bank and the
 * lose check are already final when an effect starts, and no effect blocks input.
 *
 * Ownership:
 *  - Sprites passed in by the view (filled cells, bank pieces, grid) stay owned by
 *    the view. Fx only tweens their size/position/opacity and never destroys them.
 *  - Sprites Fx creates itself (clear sweep, "+N" texts, particles, big text)
 *    are owned by Fx and destroyed when their effect ends, on cancelAll(), or on
 *    dispose().
 *
 * Hit-stop: pauses only the "board" tween group (line-clear sweep, place pull)
 * for HIT_STOP_MS. It does not touch runtime.timeScale, so input, UI tweens, the
 * combo popup and the lose timer keep running.
 */
import { animationFor } from "./colors.js";
import { BOARD_LAYER, BOARD_SIZE, DRAG_LAYER, SCORE_LAYER } from "./constants.js";
import { cellCenterX, cellCenterY } from "./hud.js";
import type { ComboShownInfo, ComboSprite } from "./comboFx.js";

const CLEAR_GLOW = "T_VFX_RoundedSquare_Gradient";
const CLEAR_EDGE = "T_VFX_RoundedSquare_Edge_Gradient";
const CLEAR_CORE = "T_VFX_RoundedSquare";
const CLEAR_FRONT = "T_VFX_FireBall_Front";
const CLEAR_TAIL = "T_VFX_FireballTail";
/** Native art sizes. Width and height stay in this ratio when drawn. */
const FIRE_FRONT_W = 122;
const FIRE_FRONT_H = 119;
const FIRE_TAIL_W = 361;
const FIRE_TAIL_H = 117;

type ClearSprite = FxSprite & {
	angle: number;
	blendMode: string;
	colorRgb: [number, number, number];
	animationFrame: number;
	isCollisionEnabled: boolean;
	stopAnimation?(): void;
};

type Rgb = readonly [number, number, number];
type Pt = { x: number; y: number };

/** Sprites Fx can animate (Block sprites have a centred origin). */
export type FxSprite = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	setAnimation?(name: string): void;
	destroy(): void;
	moveToTop?(): void;
};

type FxText = FxSprite & {
	text: string;
	fontFace: string;
	sizePt: number;
	isBold: boolean;
	fontColor: [number, number, number];
	horizontalAlign: "left" | "center" | "right";
	verticalAlign: "top" | "center" | "bottom";
	wordWrapMode?: string;
	readonly originX?: number;
	readonly originY?: number;
};

export type Ease = (t: number) => number;

/** "could not create text" is logged once per session, not per popup. */
let textWarned = false;

export const ease = {
	linear: (t: number) => t,
	inQuad: (t: number) => t * t,
	outQuad: (t: number) => 1 - (1 - t) * (1 - t),
	outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
	inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
	outBack: (t: number) => {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
	}
} satisfies Record<string, Ease>;

/** "board" pauses during hit-stop; "ui" never pauses. */
export type TweenGroup = "board" | "ui";

/** All timings in seconds. Numbers marked (own) are our design, not from the original. */
export const FX = {
	/** Place: the board yanks the piece into the cell (own). */
	placePullSec: 0.05,
	/** Shortest travel, in cells, so a drop that is already aligned still seats. */
	placePullMinCells: 0.16,
	/** Starts slightly large and settles to 1 as it locks. No rebound. */
	placePullScale: 1.045,
	/**
	 * Line clear, Giang's script: two fire heads fly in from both ends and fade
	 * near the middle; as they arrive, two tails shoot from the middle out to
	 * the edges and vanish fast on touching them; at the same moment many
	 * glow / core / edge squares spread around the line, dense at the middle and
	 * thinning toward the edges. Everything is tinted with the placed piece.
	 */
	clearFrontSec: 0.1, // heads: outside the end to the middle
	clearFrontOutsideCells: 0.9,
	clearMeet: 0.7, // fraction of the head's distance at which tails + squares start
	clearTailSec: 0.1, // middle to the edge
	clearTailVanishSec: 0.03, // "biến mất rất nhanh" once at the edge
	clearBurstSec: 0.3, // square life (each varies 0.75x-1.15x)
	clearBurstCount: 36, // per line, split across the 3 square sprites
	clearBurstMax: 180, // cap for one move with many lines
	clearBurstSpreadCells: 0.85, // perpendicular spread
	/**
	 * "+N" holds big over the clear, then darts into the HUD.
	 * The label counts and zooms for scoreCountSec (own).
	 */
	scorePopSec: 0.62,
	scoreZipSec: 0.28,
	/** Popup size while it holds, as a multiple of the HUD glyph height. */
	scorePopScale: 1.08,
	scoreCountSec: 0.62,
	/** Short swell when the points land. Not locked to the count. */
	scorePunchSec: 0.34,
	scorePunchPeak: 1.16,
	/** Camera shake on >= HIT_STOP_AFTER_LINES lines (own amplitude). */
	shakeCells: 0.08,
	/** Bank refill pop (0.1s spawn delay is from the Docs). */
	bankSpawnDelaySec: 0.1,
	bankPopSec: 0.22,
	/** Game-over grey-out must end inside the 0.5s lose delay (own split). */
	greyTotalSec: 0.4,
	greyRowSec: 0.15,
	greyOpacity: 0.3,
	/** Full-board clear (own). */
	boardClearParticles: 28,
	boardClearSec: 0.9,
	/**
	 * Combo cluster (own timings; order from the original prefab): COMBO pops first,
	 * the number ~0.1s later, digits 40ms apart; each piece 0 -> 1.2 -> 1 in 0.25s,
	 * the cluster drifts up a little, holds, then fades.
	 */
	comboNumberDelaySec: 0.1,
	comboDigitStaggerSec: 0.04,
	comboPopSec: 0.25,
	comboPopPeak: 1.2,
	comboHoldSec: 0.4,
	comboFadeSec: 0.3,
	/** Upward drift over the whole effect, as a fraction of the COMBO art height. */
	comboDrift: 0.25,
	/** On game-over start: fade this long, finished before the panel appears. */
	comboGameOverFadeSec: 0.15,
	/** Game-over panel slides up from below the screen edge (own). */
	panelSlideSec: 0.4,
	/**
	 * Combo heart behind the score (own). Periods are one full breath.
	 * Rest while 3+ misses remain, warn at 2, panic at 1 (the last miss breaks the combo).
	 * Panic stays slower than a flicker: the urgency is a deeper breath, not a shock.
	 */
	heartRestPeriod: 1.2,
	heartWarnPeriod: 0.95,
	heartPanicPeriod: 0.75,
	heartRestPeak: 1.06,
	heartWarnPeak: 1.08,
	heartPanicPeak: 1.1,
	heartAccentPeak: 1.14,
	heartRestGlow: 0.28,
	heartWarnGlow: 0.4,
	heartPanicGlow: 0.55,
	heartPopSec: 0.18,
	heartPopFrom: 0.35,
	heartBreakSec: 0.22,
	heartBreakFrom: 1.15,
	heartBreakTo: 0.45,
	/** Gradient spin, degrees per second (own). */
	heartSpinRest: 20,
	heartSpinPanic: 45,
	heartGlowScale: 1.12,
	heartGradientScale: 1.6
};

interface Tween {
	group: TweenGroup;
	delay: number;
	dur: number;
	t: number;
	/** k in [0,1]. Throwing (e.g. destroyed instance) kills the tween. */
	update(k: number): void;
	done?(): void;
	/** Tag so a caller can cancel related tweens (e.g. one sprite). */
	tag?: object;
}

interface ComboState {
	pieces: ComboSprite[];
	popEnd: number;
	fadeStart: number;
	fadeDur: number;
	tween: Tween | null;
}

interface Shake {
	targets: FxSprite[];
	bases: { x: number; y: number }[];
	amp: number;
	dur: number;
	t: number;
}

export class Fx {
	private readonly runtime: IRuntime;
	private tweens: Tween[] = [];
	private combo: ComboState | null = null;
	private owned = new Set<FxSprite | ComboSprite>();
	private boardPause = 0;
	private shake: Shake | null = null;
	private attached = true;
	private lastTime = -1;
	private readonly vfxMiss = new Set<string>();
	/** True while cancelAll() finishes tweens: follow-up effects must not spawn. */
	private cancelling = false;
	private readonly onTick = (): void => this.tick();

	constructor(runtime: IRuntime) {
		this.runtime = runtime;
		runtime.addEventListener("tick", this.onTick);
	}

	// ---- lifecycle --------------------------------------------------------

	/** Stop every effect now: view sprites get their end state, Fx sprites are destroyed. */
	cancelAll(): void {
		const list = this.tweens;
		this.tweens = [];
		this.cancelling = true;
		try {
			for (const tw of list) {
				safe(() => tw.update(1));
				safe(() => tw.done?.());
			}
		} finally {
			this.cancelling = false;
		}
		this.combo = null;
		this.stopShake();
		this.boardPause = 0;
		for (const inst of this.owned) safeDestroy(inst);
		this.owned.clear();
	}

	/** Game rebuilt / layout kept: stop and destroy what Fx owns. */
	dispose(): void {
		this.cancelAll();
		this.stopTicking();
	}

	/** Layout already ended (instances gone): just stop, touch nothing. */
	detach(): void {
		this.tweens = [];
		this.combo = null;
		this.shake = null;
		this.owned.clear();
		this.stopTicking();
	}

	/** Kill tweens tagged with `tag` (end state applied). */
	cancelTag(tag: object): void {
		const keep: Tween[] = [];
		for (const tw of this.tweens) {
			if (tw.tag === tag) {
				safe(() => tw.update(1));
				safe(() => tw.done?.());
			} else keep.push(tw);
		}
		this.tweens = keep;
	}

	/**
	 * Call before destroying board sprites that may still be animated (place
	 * pull tweens tagged with the sprite, hit-stop shake targets). Their tweens
	 * are dropped without a final write and they leave the shake list, so no
	 * effect ever writes to a destroyed instance.
	 */
	forgetSprites(sprites: Iterable<FxSprite | null | undefined>): void {
		const gone = new Set<object>();
		for (const s of sprites) if (s) gone.add(s);
		if (gone.size === 0) return;
		this.tweens = this.tweens.filter((tw) => !(tw.tag && gone.has(tw.tag)));
		const sh = this.shake;
		if (!sh) return;
		const targets: FxSprite[] = [];
		const bases: { x: number; y: number }[] = [];
		sh.targets.forEach((t, i) => {
			if (gone.has(t)) return;
			targets.push(t);
			bases.push(sh.bases[i]!);
		});
		sh.targets = targets;
		sh.bases = bases;
	}

	/**
	 * Add freshly spawned board sprites to a running hit-stop shake so they move
	 * with the board. Their current position is taken as the rest position.
	 */
	joinShake(sprites: Iterable<FxSprite | null | undefined>): void {
		const sh = this.shake;
		if (!sh) return;
		for (const s of sprites) {
			if (!s) continue;
			sh.targets.push(s);
			sh.bases.push({ x: s.x, y: s.y });
		}
	}

	// ---- core -------------------------------------------------------------

	tween(tw: Omit<Tween, "t">): Tween {
		const stored: Tween = { ...tw, t: 0 };
		this.tweens.push(stored);
		return stored;
	}

	private tick(): void {
		if (!this.attached) return;
		const dt = this.frameDt();
		if (dt <= 0) return;
		if (this.boardPause > 0) this.boardPause = Math.max(0, this.boardPause - dt);
		const list = this.tweens;
		const next: Tween[] = [];
		for (const tw of list) {
			if (tw.group === "board" && this.boardPause > 0) {
				next.push(tw);
				continue;
			}
			if (tw.delay > 0) {
				tw.delay -= dt;
				if (tw.delay > 0) {
					next.push(tw);
					continue;
				}
				tw.t += -tw.delay;
				tw.delay = 0;
			} else {
				tw.t += dt;
			}
			const k = tw.dur <= 0 ? 1 : Math.min(1, tw.t / tw.dur);
			let ok = true;
			try {
				tw.update(k);
			} catch {
				ok = false;
			}
			if (ok && k < 1) next.push(tw);
			else safe(() => tw.done?.());
		}
		// for..of also visits tweens appended during this loop, so they are already in `next`.
		this.tweens = next;
		this.tickShake(dt);
	}

	/**
	 * Seconds since the last tick, from the wall clock, so effects never depend on
	 * runtime.timeScale. Clamped so a long pause (tab hidden) does not skip effects.
	 */
	private frameDt(): number {
		const now = performance.now() / 1000;
		const d = this.lastTime < 0 ? 1 / 60 : now - this.lastTime;
		this.lastTime = now;
		return Math.min(Math.max(d, 0), 0.1);
	}

	private stopTicking(): void {
		if (!this.attached) return;
		this.attached = false;
		this.runtime.removeEventListener("tick", this.onTick);
	}

	// ---- 2. place pull ----------------------------------------------------

	/**
	 * Each placed cell is drawn at `from` (where the drag let go) and accelerates
	 * into `to` (the cell centre). The "ui" group keeps moving through hit-stop,
	 * so a big clear does not freeze the piece in mid-air.
	 */
	placePull(
		parts: { sprite: FxSprite; fromX: number; fromY: number; toX: number; toY: number }[],
		cellSize: number
	): void {
		const min = Math.max(0, cellSize) * FX.placePullMinCells;
		for (const part of parts) {
			const s = part.sprite;
			let dx = part.fromX - part.toX;
			let dy = part.fromY - part.toY;
			const len = Math.hypot(dx, dy);
			if (len < min) {
				if (len < 1) {
					dx = 0;
					dy = -min;
				} else {
					const fit = min / len;
					dx *= fit;
					dy *= fit;
				}
			}
			const fromX = part.toX + dx;
			const fromY = part.toY + dy;
			const size = s.width;
			s.x = fromX;
			s.y = fromY;
			setSize(s, size * FX.placePullScale);
			this.tween({
				group: "ui",
				delay: 0,
				dur: FX.placePullSec,
				tag: s,
				update: (k) => {
					const u = magnetPull(k);
					s.x = fromX + (part.toX - fromX) * u;
					s.y = fromY + (part.toY - fromY) * u;
					const sc = FX.placePullScale + (1 - FX.placePullScale) * u;
					setSize(s, size * sc);
				}
			});
		}
	}

	// ---- 3. line clear ----------------------------------------------------

	/**
	 * Each cleared row and column plays the same beat, all on the same frame
	 * (see FX.clear*). Sprites are created invisible at their start point, so a
	 * hit-stop that pauses the "board" group right after this never shows them
	 * parked in the middle.
	 */
	lineClear(info: {
		rows: readonly number[];
		cols: readonly number[];
		cellSize: number;
		color: Rgb;
	}): void {
		const cell = info.cellSize;
		if (!(cell > 0)) return;
		const lines = info.rows.length + info.cols.length;
		if (lines === 0) return;
		const squares = Math.max(9, Math.min(FX.clearBurstCount, Math.floor(FX.clearBurstMax / lines)));
		for (const row of info.rows) this.playClearLine("row", row, cell, info.color, squares);
		for (const col of info.cols) this.playClearLine("col", col, cell, info.color, squares);
	}

	private playClearLine(axis: "row" | "col", index: number, cell: number, tint: Rgb, squares: number): void {
		const mid = this.linePoint(axis, index, (BOARD_SIZE - 1) / 2);
		const ends = [0, BOARD_SIZE - 1].map((i) => this.linePoint(axis, index, i));
		// 1. Two heads, from just outside each end to the middle, fading out.
		const heads: { sprite: ClearSprite; from: Pt }[] = [];
		const h = cell * 1.15;
		const w = FIRE_FRONT_W * (h / FIRE_FRONT_H);
		for (const end of ends) {
			const from = past(end, mid, cell * FX.clearFrontOutsideCells);
			const travel = unit(mid.x - from.x, mid.y - from.y);
			// Head art points its nose left at angle 0: turn it to face the travel.
			const angle = Math.atan2(-travel.y, -travel.x);
			const sprite = this.spawnVfx(CLEAR_FRONT, from.x, from.y, w, h, angle, tint);
			if (!sprite) continue;
			sprite.opacity = 0;
			heads.push({ sprite, from });
		}
		let started = false;
		const start = (): void => {
			if (started || this.cancelling) return;
			started = true;
			this.sendTails(cell, tint, mid, ends);
			this.burstSquares(axis, cell, tint, mid, squares);
		};
		if (heads.length === 0) {
			start();
			return;
		}
		this.tween({
			group: "board",
			delay: 0,
			dur: FX.clearFrontSec,
			update: (k) => {
				const u = ease.outQuad(k);
				const fade = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
				for (const head of heads) {
					head.sprite.x = head.from.x + (mid.x - head.from.x) * u;
					head.sprite.y = head.from.y + (mid.y - head.from.y) * u;
					head.sprite.opacity = Math.max(0, fade);
				}
				if (u >= FX.clearMeet) start(); // head has covered 70% of its trip
			},
			done: () => {
				for (const head of heads) this.release(head.sprite);
				start();
			}
		});
	}

	/** 2. Two tails grow from the middle to the outer edges, then vanish fast. */
	private sendTails(cell: number, tint: Rgb, mid: Pt, ends: Pt[]): void {
		const moveSec = FX.clearTailSec;
		const total = moveSec + FX.clearTailVanishSec;
		for (const end of ends) {
			const tip = past(end, mid, cell * 0.5); // outer edge of the end cell
			const travel = unit(tip.x - mid.x, tip.y - mid.y);
			// Tail art: bright end left, faded end right at angle 0. The bright
			// end leads, so the faded end trails back toward the middle.
			const angle = Math.atan2(-travel.y, -travel.x);
			const hgt = cell * 0.9;
			const sprite = this.spawnVfx(CLEAR_TAIL, mid.x, mid.y, cell * 0.2, hgt, angle, tint);
			if (!sprite) continue;
			sprite.opacity = 0;
			this.tween({
				group: "board",
				delay: 0,
				dur: total,
				update: (k) => {
					const sec = k * total;
					const u = ease.outQuad(Math.min(1, sec / moveSec));
					const x = mid.x + (tip.x - mid.x) * u;
					const y = mid.y + (tip.y - mid.y) * u;
					const len = Math.max(cell * 0.2, Math.hypot(x - mid.x, y - mid.y));
					// Keep the aspect of the art in check: never thicker than long.
					sprite.width = len;
					sprite.height = Math.min(hgt, len * (FIRE_TAIL_H / FIRE_TAIL_W) * 3);
					sprite.x = (mid.x + x) / 2;
					sprite.y = (mid.y + y) / 2;
					sprite.opacity = sec <= moveSec ? 1 : Math.max(0, 1 - (sec - moveSec) / FX.clearTailVanishSec);
				},
				done: () => this.release(sprite)
			});
		}
	}

	/**
	 * 3. Glow, core and edge squares spread around the line from the middle.
	 * Positions pack at the middle and thin out toward the edges.
	 */
	private burstSquares(axis: "row" | "col", cell: number, tint: Rgb, mid: Pt, count: number): void {
		const half = (BOARD_SIZE * cell) / 2;
		const tangent = axis === "row" ? { x: 1, y: 0 } : { x: 0, y: 1 };
		const normal = axis === "row" ? { x: 0, y: 1 } : { x: 1, y: 0 };
		const names = [CLEAR_GLOW, CLEAR_CORE, CLEAR_EDGE];
		for (let i = 0; i < count; i++) {
			const span = Math.random() * 2 - 1;
			const along = Math.sign(span) * Math.pow(Math.abs(span), 1.7);
			const perp = (Math.random() * 2 - 1) * cell * FX.clearBurstSpreadCells;
			const name = names[i % names.length]!;
			const size =
				name === CLEAR_GLOW
					? cell * (0.7 + Math.random() * 0.6)
					: name === CLEAR_EDGE
						? cell * (0.4 + Math.random() * 0.4)
						: cell * (0.15 + Math.random() * 0.3);
			const from = {
				x: mid.x + tangent.x * along * half * 0.2 + normal.x * perp * 0.15,
				y: mid.y + tangent.y * along * half * 0.2 + normal.y * perp * 0.15
			};
			const to = {
				x: mid.x + tangent.x * along * half + normal.x * perp * 1.4,
				y: mid.y + tangent.y * along * half + normal.y * perp * 1.4
			};
			const sprite = this.spawnVfx(name, from.x, from.y, size, size, (Math.random() - 0.5) * 0.6, tint);
			if (!sprite) continue;
			sprite.opacity = 0;
			const peak = name === CLEAR_GLOW ? 0.7 : 1;
			this.tween({
				group: "board",
				delay: Math.abs(along) * 0.04, // the far ones leave a touch later
				dur: FX.clearBurstSec * (0.75 + Math.random() * 0.4),
				update: (k) => {
					const u = ease.outCubic(k);
					sprite.x = from.x + (to.x - from.x) * u;
					sprite.y = from.y + (to.y - from.y) * u;
					const fade = k < 0.15 ? k / 0.15 : 1 - ease.inQuad((k - 0.15) / 0.85);
					sprite.opacity = Math.max(0, fade) * peak;
					const grow = 1 + 0.3 * u;
					sprite.width = size * grow;
					sprite.height = size * grow;
				},
				done: () => this.release(sprite)
			});
		}
	}

	/** Point on a cleared row or column. `along` is 0 at the first cell and 7 at the last. */
	private linePoint(axis: "row" | "col", index: number, along: number): Pt {
		const x0 = cellCenterX(0);
		const y0 = cellCenterY(0);
		const x1 = cellCenterX(BOARD_SIZE - 1);
		const y1 = cellCenterY(BOARD_SIZE - 1);
		const t = along / (BOARD_SIZE - 1);
		if (axis === "row") return { x: x0 + (x1 - x0) * t, y: cellCenterY(index) };
		return { x: cellCenterX(index), y: y0 + (y1 - y0) * t };
	}

	// ---- 4. score flies into the HUD -------------------------------------

	/**
	 * "+N" holds at a fixed size over the clear, then darts into the score label.
	 * `target` is read every frame so a resize retargets the flight. Returns
	 * null if the text cannot be created. `cancel` drops the text without
	 * calling `onArrive`. `shelter` / `resume` keep it alive across `cancelAll`.
	 */
	flyScore(
		fromX: number,
		fromY: number,
		amount: number,
		target: () => { x: number; y: number; fontPx: number },
		onArrive: () => void
	): ScoreFly | null {
		if (amount <= 0 || this.cancelling) return null;
		const end0 = target();
		const hudFont0 = Math.max(8, end0.fontPx);
		const inst = this.spawnText(SCORE_LAYER, `+${amount}`, hudFont0, [1, 1, 1]);
		if (!inst) return null;
		inst.opacity = 0;
		let arrive = true;
		let dead = false;
		let sheltered = false;
		const dur = FX.scorePopSec + FX.scoreZipSec;
		const popEnd = FX.scorePopSec / dur;
		const tw = this.tween({
			group: "ui",
			delay: 0,
			dur,
			update: (k) => {
				const end = target();
				const hudFont = Math.max(8, end.fontPx);
				const big = hudFont * FX.scorePopScale;
				let x = fromX;
				let y = fromY;
				let font = big;
				if (k < popEnd) {
					const p = k / popEnd;
					// Short hit: small, then past the hold size, then back. The rest of the pop just sits.
					const bloom = Math.min(1, p / 0.16);
					const grow = Math.max(0, ease.outBack(bloom));
					font = lerp(big * 0.4, big, Math.min(grow, 1.22));
					inst.opacity = Math.min(1, p / 0.08);
				} else {
					const z = Math.pow((k - popEnd) / (1 - popEnd), 3);
					x = lerp(fromX, end.x, z);
					y = lerp(fromY, end.y, z);
					font = lerp(big, hudFont, z);
					inst.opacity = 1;
				}
				inst.sizePt = font;
				placeCentered(inst, x, y, font * 4, font * 1.4);
			},
			done: () => {
				dead = true;
				this.release(inst);
				if (arrive) onArrive();
			}
		});
		const drop = (): void => {
			if (!sheltered) this.detachTween(tw, inst);
			this.release(inst);
		};
		return {
			shelter: () => {
				if (dead || sheltered) return;
				sheltered = true;
				this.detachTween(tw, inst);
			},
			resume: () => {
				if (dead || !sheltered) return;
				sheltered = false;
				this.attachTween(tw, inst);
			},
			cancel: () => {
				if (dead) return;
				dead = true;
				arrive = false;
				drop();
			}
		};
	}

	private detachTween(tw: Tween, inst: FxText): void {
		this.tweens = this.tweens.filter((t) => t !== tw);
		this.owned.delete(inst);
	}

	private attachTween(tw: Tween, inst: FxText): void {
		if (!this.tweens.includes(tw)) this.tweens.push(tw);
		this.owned.add(inst);
	}

	// ---- 6. hit-stop + shake ----------------------------------------------

	/** Freeze board tweens for `ms` and shake `targets` (grid + filled cells). */
	hitStop(ms: number, targets: FxSprite[], cellSize: number): void {
		this.boardPause = Math.max(this.boardPause, ms / 1000);
		this.stopShake();
		if (targets.length === 0) return;
		this.shake = {
			targets: targets.slice(),
			bases: targets.map((s) => ({ x: s.x, y: s.y })),
			amp: cellSize * FX.shakeCells,
			dur: Math.max(0.12, ms / 1000),
			t: 0
		};
	}

	private tickShake(dt: number): void {
		const sh = this.shake;
		if (!sh) return;
		sh.t += dt;
		if (sh.t >= sh.dur) {
			this.stopShake();
			return;
		}
		const a = sh.amp * (1 - sh.t / sh.dur);
		const dx = (Math.random() * 2 - 1) * a;
		const dy = (Math.random() * 2 - 1) * a;
		for (let i = 0; i < sh.targets.length; i++) {
			const s = sh.targets[i]!;
			const b = sh.bases[i]!;
			safe(() => {
				s.x = b.x + dx;
				s.y = b.y + dy;
			});
		}
	}

	private stopShake(): void {
		const sh = this.shake;
		this.shake = null;
		if (!sh) return;
		for (let i = 0; i < sh.targets.length; i++) {
			const s = sh.targets[i]!;
			const b = sh.bases[i]!;
			safe(() => {
				s.x = b.x;
				s.y = b.y;
			});
		}
	}

	// ---- 7. bank refill ---------------------------------------------------

	/** Each slot's piece pops from 0 to full size around its slot centre, 0.1s apart. */
	bankPop(slots: FxSprite[][], centers: { x: number; y: number }[]): void {
		slots.forEach((sprites, i) => {
			const c = centers[i];
			if (!c || sprites.length === 0) return;
			const bases = sprites.map((s) => ({ x: s.x, y: s.y, size: s.width }));
			const apply = (sc: number) => {
				sprites.forEach((s, j) => {
					const b = bases[j]!;
					s.x = c.x + (b.x - c.x) * sc;
					s.y = c.y + (b.y - c.y) * sc;
					setSize(s, b.size * sc);
				});
			};
			apply(0);
			this.tween({
				group: "ui",
				delay: i * FX.bankSpawnDelaySec,
				dur: FX.bankPopSec,
				tag: sprites,
				update: (k) => apply(Math.max(0, ease.outBack(k)))
			});
		});
	}

	// ---- 9. game-over grey-out --------------------------------------------

	/** Rows (top to bottom) fade to 30% one after another; finishes in ~0.4s. */
	greyOut(rows: FxSprite[][], extra: FxSprite[] = []): void {
		const n = Math.max(1, rows.length);
		const step = n > 1 ? (FX.greyTotalSec - FX.greyRowSec) / (n - 1) : 0;
		const fade = (list: FxSprite[], delay: number) => {
			const from = list.map((s) => s.opacity);
			this.tween({
				group: "ui",
				delay,
				dur: FX.greyRowSec,
				update: (k) => {
					list.forEach((s, j) => {
						const f = from[j]!;
						safe(() => {
							s.opacity = f + (FX.greyOpacity - f) * ease.outQuad(k);
						});
					});
				}
			});
		};
		rows.forEach((row, i) => fade(row, i * step));
		if (extra.length > 0) fade(extra, FX.greyTotalSec - FX.greyRowSec);
	}

	// ---- 10. full-board clear ---------------------------------------------

	/** Big text plus coloured block particles bursting from the board centre. */
	boardClear(cx: number, cy: number, cellSize: number, label = "CLEAR!"): void {
		const text = this.spawnText(DRAG_LAYER, label, cellSize * 1.1, [1, 0.84, 0.3]);
		if (text) {
			const w = cellSize * 9;
			const h = cellSize * 2.5;
			const basePt = text.sizePt;
			this.tween({
				group: "ui",
				delay: 0,
				dur: FX.boardClearSec,
				update: (k) => {
					const pop = k < 0.3 ? ease.outBack(k / 0.3) : 1;
					text.sizePt = Math.max(1, basePt * pop);
					placeCentered(text, cx, cy, w, h);
					text.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
				},
				done: () => this.release(text)
			});
		}
		const n = FX.boardClearParticles;
		for (let i = 0; i < n; i++) {
			const ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
			const dist = cellSize * (2.5 + Math.random() * 2);
			const size = cellSize * (0.25 + Math.random() * 0.2);
			const anim = animationFor(1 + Math.floor(Math.random() * 7));
			const p = this.spawnBlock(DRAG_LAYER, cx, cy, size, anim, 1);
			if (!p) continue;
			const dur = FX.boardClearSec * (0.7 + Math.random() * 0.3);
			this.tween({
				group: "ui",
				delay: Math.random() * 0.06,
				dur,
				update: (k) => {
					const e = ease.outCubic(k);
					p.x = cx + Math.cos(ang) * dist * e;
					p.y = cy + Math.sin(ang) * dist * e;
					setSize(p, size * (1 - 0.6 * k));
					p.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
				},
				done: () => this.release(p)
			});
		}
	}

	// ---- 11. game-over panel slide-in ---------------------------------------

	/**
	 * Tween the lose panel offset from `fromDy` to 0 with a small overshoot.
	 * `setOffset` must be ui.ts setLosePanelOffset (never move the instances
	 * directly: the refit ticks would overwrite them). cancelAll() snaps to 0.
	 */
	panelSlideIn(fromDy: number, setOffset: (dx: number, dy: number) => void): void {
		setOffset(0, fromDy);
		this.tween({
			group: "ui",
			delay: 0,
			dur: FX.panelSlideSec,
			tag: setOffset,
			update: (k) => setOffset(0, k >= 1 ? 0 : fromDy * (1 - ease.outBack(k)))
		});
	}

	// ---- 5. combo --------------------------------------------------------

	/**
	 * Animate a freshly built combo cluster (from comboFx onComboShown). Fx takes
	 * ownership: the cluster is destroyed when the effect ends, when a new combo
	 * arrives, on killCombo() (relayout / replay) and on dispose().
	 * Group "ui": hit-stop does not pause it.
	 */
	comboPop(info: ComboShownInfo): void {
		this.killCombo();
		const pieces: ComboSprite[] = [];
		const starts: number[] = [];
		if (info.comboText) {
			pieces.push(info.comboText);
			starts.push(0);
		}
		info.digits.forEach((d, i) => {
			pieces.push(d);
			starts.push(FX.comboNumberDelaySec + i * FX.comboDigitStaggerSec);
		});
		if (pieces.length === 0) return;
		const bases = pieces.map((p) => ({ x: p.x, y: p.y, w: p.width, h: p.height }));
		for (const p of pieces) {
			this.owned.add(p);
			safe(() => {
				p.width = 0;
				p.height = 0;
				p.opacity = 0;
			});
		}
		const popEnd = Math.max(...starts) + FX.comboPopSec;
		const drift = (info.comboText ? bases[0]!.h : 241 * info.baseScale) * FX.comboDrift;
		const state: ComboState = {
			pieces,
			popEnd,
			fadeStart: popEnd + FX.comboHoldSec,
			fadeDur: FX.comboFadeSec,
			tween: null
		};
		const tw = this.tween({
			group: "ui",
			delay: 0,
			dur: state.fadeStart + state.fadeDur,
			update: (k) => {
				const t = k * tw.dur;
				const alpha =
					t <= state.fadeStart ? 1 : Math.max(0, 1 - (t - state.fadeStart) / state.fadeDur);
				const dy = -drift * ease.outQuad(Math.min(1, t / (popEnd + FX.comboHoldSec + FX.comboFadeSec)));
				pieces.forEach((p, i) => {
					const b = bases[i]!;
					const local = t - starts[i]!;
					let sc: number;
					if (local <= 0) sc = 0;
					else if (local >= FX.comboPopSec) sc = 1;
					else {
						const q = local / FX.comboPopSec;
						sc =
							q < 0.6
								? FX.comboPopPeak * ease.outQuad(q / 0.6)
								: FX.comboPopPeak - (FX.comboPopPeak - 1) * ease.inOutQuad((q - 0.6) / 0.4);
					}
					safe(() => {
						p.width = b.w * sc;
						p.height = b.h * sc;
						p.x = b.x;
						p.y = b.y + dy;
						p.opacity = local <= 0 ? 0 : alpha;
					});
				});
			},
			done: () => {
				if (this.combo === state) this.combo = null;
				for (const p of pieces) this.release(p);
			}
		});
		state.tween = tw;
		this.combo = state;
	}

	/**
	 * Game over started: let the pop finish, then fade quickly so the cluster is
	 * gone before the panel appears after `delayMs`.
	 */
	comboGameOver(delayMs: number): void {
		const st = this.combo;
		const tw = st?.tween;
		if (!st || !tw) return;
		const now = tw.t;
		const deadline = Math.max(now, delayMs / 1000 - 0.02);
		const fadeDur = Math.min(FX.comboGameOverFadeSec, deadline - now);
		const fadeStart = Math.max(now, Math.min(Math.max(now, st.popEnd), deadline - fadeDur));
		if (fadeStart + fadeDur >= st.fadeStart + st.fadeDur) return; // already ends in time
		st.fadeStart = fadeStart;
		st.fadeDur = Math.max(0.001, fadeDur);
		tw.dur = Math.max(now + 0.001, st.fadeStart + st.fadeDur);
	}

	/** Destroy the current combo cluster immediately (relayout, replay, new combo). */
	killCombo(): void {
		const st = this.combo;
		this.combo = null;
		if (!st) return;
		if (st.tween) this.tweens = this.tweens.filter((t) => t !== st.tween);
		for (const p of st.pieces) this.release(p);
	}

	// ---- helpers ----------------------------------------------------------

	private release(inst: FxSprite | ComboSprite): void {
		this.owned.delete(inst);
		safeDestroy(inst);
	}

	private spawnVfx(
		name: string,
		x: number,
		y: number,
		w: number,
		h: number,
		angle: number,
		tint: Rgb
	): ClearSprite | null {
		if (this.cancelling) return null;
		const type = (this.runtime.objects as unknown as Record<string, IObjectType | undefined>)[name];
		if (!type) {
			if (!this.vfxMiss.has(name)) {
				this.vfxMiss.add(name);
				console.warn(`[BlockBlast] object type "${name}" is missing; clear fx partial`);
			}
			return null;
		}
		try {
			const inst = type.createInstance(BOARD_LAYER, x, y) as unknown as ClearSprite;
			inst.stopAnimation?.();
			inst.animationFrame = 0;
			inst.width = w;
			inst.height = h;
			inst.angle = angle;
			inst.opacity = 1;
			inst.colorRgb = [tint[0], tint[1], tint[2]];
			// Purely visual: the ObjectBanks template has collisions on, turn them off per instance.
			safe(() => {
				inst.isCollisionEnabled = false;
			});
			trySetBlend(inst, "additive");
			inst.moveToTop?.();
			this.owned.add(inst);
			return inst;
		} catch (err) {
			if (!this.vfxMiss.has(name)) {
				this.vfxMiss.add(name);
				console.warn(`[BlockBlast] could not create ${name}`, err);
			}
			return null;
		}
	}

	private spawnBlock(
		layer: string,
		x: number,
		y: number,
		size: number,
		animation: string,
		opacity: number
	): FxSprite | null {
		try {
			const inst = this.runtime.objects.Block.createInstance(layer, x, y) as unknown as FxSprite;
			setSize(inst, size);
			inst.opacity = opacity;
			inst.setAnimation?.(animation);
			inst.moveToTop?.();
			this.owned.add(inst);
			return inst;
		} catch (err) {
			console.warn("[BlockBlast] fx: could not create Block", err);
			return null;
		}
	}

	private spawnText(
		layer: string,
		text: string,
		glyphPx: number,
		color: [number, number, number]
	): FxText | null {
		const type = (this.runtime.objects as unknown as Record<string, IObjectType | undefined>)[
			"HudText"
		];
		if (!type) return null;
		let inst: FxText | null = null;
		try {
			inst = type.createInstance(layer, -10000, -10000) as unknown as FxText;
			inst.fontFace = "Arial";
			inst.isBold = true;
			inst.fontColor = [color[0], color[1], color[2]];
			inst.horizontalAlign = "center";
			inst.verticalAlign = "center";
			inst.wordWrapMode = "word";
			inst.sizePt = Math.max(8, Math.round(glyphPx * 0.75));
			inst.text = text;
			inst.moveToTop?.();
			this.owned.add(inst);
			return inst;
		} catch (err) {
			safeDestroy(inst);
			if (!textWarned) {
				textWarned = true;
				console.warn("[BlockBlast] fx: could not create text (logged once)", err);
			}
			return null;
		}
	}
}

/**
 * Score count-up for the HUD. The real score is never delayed; only the
 * displayed text eases toward it.
 */
export class ScoreCounter {
	private from = 0;
	private to = 0;
	private t = 1;
	private readonly dur: number;

	constructor(durSec = FX.scoreCountSec) {
		this.dur = durSec;
	}

	busy(): boolean {
		return this.t < 1;
	}

	/** Jump without animating (new run, relayout). */
	reset(value: number): void {
		this.from = value;
		this.to = value;
		this.t = 1;
	}

	set(target: number): void {
		if (target === this.to) return;
		this.from = this.shown();
		this.to = target;
		this.t = target < this.from ? 1 : 0;
	}

	/** Advance; returns true while still counting. */
	step(dt: number): boolean {
		if (this.t >= 1) return false;
		this.t = Math.min(1, this.t + dt / this.dur);
		return true;
	}

	shown(): number {
		if (this.t >= 1) return this.to;
		return Math.round(this.from + (this.to - this.from) * ease.outQuad(this.t));
	}
}

export interface ScoreFly {
	/** Pull the flight out of cancelAll, then put it back with `resume`. */
	shelter(): void;
	resume(): void;
	/** Destroy the flyer and do not run its arrival callback. */
	cancel(): void;
}

function unit(x: number, y: number): Pt {
	const len = Math.hypot(x, y);
	if (len < 1e-4) return { x: 1, y: 0 };
	return { x: x / len, y: y / len };
}

/** `extra` layout px past `end`, continuing away from `mid`. */
function past(end: Pt, mid: Pt, extra: number): Pt {
	const d = unit(end.x - mid.x, end.y - mid.y);
	return { x: end.x + d.x * extra, y: end.y + d.y * extra };
}

function trySetBlend(inst: { blendMode: string }, mode: string): void {
	let proto: object | null = inst;
	while (proto) {
		if (Object.getOwnPropertyDescriptor(proto, "blendMode")?.set) {
			try {
				inst.blendMode = mode;
			} catch {
				// Normal blend still reads as a white flash.
			}
			return;
		}
		proto = Object.getPrototypeOf(proto);
	}
}

/** Almost still, then a hard yank. Most of the travel is in the last quarter. */
function magnetPull(k: number): number {
	const t = k < 0 ? 0 : k > 1 ? 1 : k;
	const yank = t * t * t * t;
	return t * 0.08 + yank * 0.92;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function setSize(s: FxSprite, size: number): void {
	s.width = size;
	s.height = size;
}

/** Text boxes use a top-left origin by default; centre the box on (cx, cy). */
function placeCentered(t: FxText, cx: number, cy: number, w: number, h: number): void {
	t.width = w;
	t.height = h;
	t.x = cx - w / 2 + w * (t.originX ?? 0);
	t.y = cy - h / 2 + h * (t.originY ?? 0);
}

function safe(fn: () => void): void {
	try {
		fn();
	} catch {
		// destroyed instance or similar — effects are cosmetic
	}
}

function safeDestroy(inst: { destroy(): void } | null): void {
	if (!inst) return;
	try {
		inst.destroy();
	} catch {
		// already destroyed
	}
}
