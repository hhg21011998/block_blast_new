/**
 * Visual effects (animator). Pure TypeScript tweens driven by the runtime "tick";
 * no Construct behaviors. Everything here is cosmetic: board, score, bank and the
 * lose check are already final when an effect starts, and no effect blocks input.
 *
 * Ownership:
 *  - Sprites passed in by the view (filled cells, bank pieces, grid) stay owned by
 *    the view. Fx only tweens their size/position/opacity and never destroys them.
 *  - Sprites Fx creates itself (line-clear copies, "+N" texts, particles, big text)
 *    are owned by Fx and destroyed when their effect ends, on cancelAll(), or on
 *    dispose().
 *
 * Hit-stop: pauses only the "board" tween group (line-clear copies, place bounce)
 * for HIT_STOP_MS. It does not touch runtime.timeScale, so input, UI tweens, the
 * combo popup and the lose timer keep running.
 */
import { animationFor } from "./colors.js";
import { BOARD_LAYER, DRAG_LAYER } from "./constants.js";
import type { ComboShownInfo, ComboSprite } from "./comboFx.js";

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
	/** Place bounce: scale peak and duration (own). */
	placeBounceScale: 1.15,
	placeBounceSec: 0.12,
	/** Line clear per cell (own): stagger between rings, glow phase, total. */
	clearStaggerSec: 0.02,
	clearGlowScale: 1.12,
	clearGlowSec: 0.06,
	clearSec: 0.3,
	/** Floating "+N" (own). */
	floatRiseCells: 1.1,
	floatSec: 0.7,
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
	panelSlideSec: 0.4
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
		for (const tw of list) {
			safe(() => tw.update(1));
			safe(() => tw.done?.());
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
	 * bounce tweens tagged with the sprite, hit-stop shake targets). Their tweens
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

	// ---- 2. place bounce --------------------------------------------------

	/** Placed cells pop to 1.15 and settle back (each sprite scales about its centre). */
	placeBounce(sprites: FxSprite[]): void {
		for (const s of sprites) {
			const base = s.width;
			const peak = FX.placeBounceScale;
			this.tween({
				group: "board",
				delay: 0,
				dur: FX.placeBounceSec,
				tag: s,
				update: (k) => {
					// up in the first 40%, back in the rest
					const sc =
						k < 0.4
							? 1 + (peak - 1) * ease.outQuad(k / 0.4)
							: peak - (peak - 1) * ease.inOutQuad((k - 0.4) / 0.6);
					setSize(s, base * sc);
				}
			});
		}
	}

	// ---- 3. line clear ----------------------------------------------------

	/**
	 * Visual copies of cleared cells glow, shrink and fade. `cells` are cell
	 * centres; `animation` is the placed piece's colour (matches the clear hint).
	 * Stagger grows with distance (in cells) from `from`, ~20ms per ring.
	 */
	lineClear(
		cells: { x: number; y: number; col: number; row: number }[],
		size: number,
		animation: string,
		from: { col: number; row: number }
	): void {
		for (const c of cells) {
			const inst = this.spawnBlock(BOARD_LAYER, c.x, c.y, size, animation, 1);
			if (!inst) continue;
			const ring = Math.max(Math.abs(c.col - from.col), Math.abs(c.row - from.row));
			const glowK = FX.clearGlowSec / FX.clearSec;
			this.tween({
				group: "board",
				delay: ring * FX.clearStaggerSec,
				dur: FX.clearSec,
				update: (k) => {
					if (k < glowK) {
						setSize(inst, size * (1 + (FX.clearGlowScale - 1) * ease.outQuad(k / glowK)));
						inst.opacity = 1;
					} else {
						const p = ease.inQuad((k - glowK) / (1 - glowK));
						setSize(inst, size * (FX.clearGlowScale - (FX.clearGlowScale - 0.1) * p));
						inst.opacity = 1 - p;
					}
				},
				done: () => this.release(inst)
			});
		}
	}

	// ---- 4. floating "+N" -------------------------------------------------

	/** "+N" rises about one cell above (x, y) and fades out. */
	floatScore(x: number, y: number, amount: number, cellSize: number): void {
		if (amount <= 0) return;
		const t = this.spawnText(DRAG_LAYER, `+${amount}`, cellSize * 0.5, [1, 1, 1]);
		if (!t) return;
		const rise = cellSize * FX.floatRiseCells;
		const w = cellSize * 4;
		const h = cellSize;
		this.tween({
			group: "ui",
			delay: 0,
			dur: FX.floatSec,
			update: (k) => {
				placeCentered(t, x, y - rise * ease.outCubic(k), w, h);
				t.opacity = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
			},
			done: () => this.release(t)
		});
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
 * Score count-up for the HUD: the shown number eases to the real score over
 * ~0.35s. The real score is never delayed; only the displayed text is.
 */
export class ScoreCounter {
	private from = 0;
	private to = 0;
	private t = 1;
	private readonly dur: number;

	constructor(durSec = 0.35) {
		this.dur = durSec;
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
		return Math.round(this.from + (this.to - this.from) * ease.outCubic(this.t));
	}
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
