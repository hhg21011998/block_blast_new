/**
 * Rainbow combo heart drawn behind the score. The digits sit on the same point, on a higher layer.
 * The heart frames are white masks; T_VFX_Heart_OverlayGradient supplies the colour.
 * Both sit on the Streak layer (its own texture) and the gradient is drawn source-in,
 * so the rainbow exists only where the heart has alpha.
 * Beat rate follows how many non-clear placements remain before the combo breaks.
 */
import { STREAK_LAYER } from "./constants.js";
import { ease, FX } from "./fx.js";
import type { ScoreState } from "./score.js";

const HEART_OBJECT = "T_UI_Streak_Indicator_Heart";
const GRADIENT_OBJECT = "T_VFX_Heart_OverlayGradient";
const MASK_FRAME = 0;
const GLOW_FRAME = 2;

export type HeartCue = "idle" | "pop" | "accent" | "break" | "rate";
export type HeartBand = "rest" | "warn" | "panic";

type Mode = "hidden" | "pop" | "beat" | "break";

type HeartSprite = {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	angle: number;
	blendMode: string;
	animationFrame: number;
	stopAnimation?(): void;
	destroy(): void;
	moveToTop?(): void;
};

export interface HeartAnchor {
	x: number;
	y: number;
	size: number;
}

/** What the heart should do when the score state changes. `prev` is the combo before this move. */
export function heartCue(prev: number, combo: number): HeartCue {
	if (combo <= 0) return prev > 0 ? "break" : "idle";
	if (prev <= 0) return "pop";
	if (combo > prev) return "accent";
	return "rate";
}

/** Misses still allowed before the combo drops. 1 is the last chance. */
export function heartBand(remaining: number): HeartBand {
	if (remaining <= 1) return "panic";
	if (remaining === 2) return "warn";
	return "rest";
}

/**
 * One breath. Scale rests at both ends of the phase and reaches `peak` in the
 * middle. The slope is 0 at the turnaround, so the beat eases in and out.
 */
export function beatScale(phase: number, peak: number): number {
	const p = phase - Math.floor(phase);
	const lobe = Math.sin(p * Math.PI);
	return 1 + (peak - 1) * lobe * lobe;
}

/** Degrees per second. Calm at 3+ misses left, fastest when one miss remains. */
export function heartSpinDeg(remaining: number): number {
	const t = clamp01((3 - remaining) / 2);
	return FX.heartSpinRest + (FX.heartSpinPanic - FX.heartSpinRest) * t;
}

export class StreakHeart {
	private readonly runtime: IRuntime;
	private readonly onTick = (): void => this.tick();
	private ticking = false;
	private dead = false;
	private warned = false;
	/** Next combo-0 sync is a replay, not a broken streak. */
	private suppressBreak = false;
	private prevCombo = 0;
	private mode: Mode = "hidden";
	private band: HeartBand = "rest";
	private remaining = 3;
	private phase = 0;
	private shot = 0;
	private accent = false;
	private angle = 0;
	private anchor: HeartAnchor = { x: 0, y: 0, size: 1 };
	private pose = { scale: 1, opacity: 0, glow: 0 };
	private glow: HeartSprite | null = null;
	private mask: HeartSprite | null = null;
	private gradient: HeartSprite | null = null;
	private lastTime = -1;

	constructor(runtime: IRuntime) {
		this.runtime = runtime;
		this.ticking = true;
		runtime.addEventListener("tick", this.onTick);
	}

	/** Centre the heart on the score. Safe before the sprites exist. */
	layout(anchor: HeartAnchor): void {
		if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !(anchor.size > 0)) return;
		this.anchor = anchor;
		if (this.mode !== "hidden") this.apply(this.pose.scale, this.pose.opacity, this.pose.glow);
	}

	/**
	 * Follow the session score. Call after noteClear / noteNonClear.
	 * A reset() immediately before a combo-0 start does not play the break.
	 */
	sync(state: ScoreState): void {
		if (this.dead) return;
		const combo = Math.max(0, Math.floor(state.combo));
		const limit = Math.max(1, Math.floor(state.nonClearLimit));
		const streak = Math.max(0, Math.floor(state.nonClearStreak));
		this.remaining = limit - streak;
		this.band = heartBand(this.remaining);

		if (this.suppressBreak) {
			this.suppressBreak = false;
			this.prevCombo = combo;
			if (combo <= 0) {
				this.hideNow();
				return;
			}
		}

		const cue = heartCue(this.prevCombo, combo);
		this.prevCombo = combo;
		if (cue === "break") this.startBreak();
		else if (cue === "idle") this.hideNow();
		else if (cue === "pop") this.startPop();
		else if (cue === "accent") this.startAccent();
		else if (this.mode === "hidden") this.startPop();
	}

	/** Lose delay started: same squeeze-and-fade as a broken combo. */
	fadeOut(): void {
		this.startBreak();
	}

	/** Replay / new run. Hides immediately so the following combo-0 event stays quiet. */
	reset(): void {
		this.suppressBreak = true;
		this.prevCombo = 0;
		this.accent = false;
		this.hideNow();
	}

	/** Stop the tick and destroy sprites. Safe if the layout already destroyed them. */
	dispose(): void {
		if (!this.ticking) return;
		this.ticking = false;
		this.runtime.removeEventListener("tick", this.onTick);
		this.destroySprites();
	}

	private startPop(): void {
		if (!this.ensure()) return;
		this.mode = "pop";
		this.shot = 0;
		this.accent = false;
		this.apply(FX.heartPopFrom, 1, this.glowPeak() * 0.4);
	}

	private startAccent(): void {
		if (this.mode === "hidden" || this.mode === "break") {
			this.startPop();
			return;
		}
		if (!this.ensure()) return;
		this.mode = "beat";
		this.phase = 0;
		this.accent = true;
	}

	private startBreak(): void {
		if (this.dead || this.mode === "hidden" || this.mode === "break") return;
		if (!this.glow) return;
		this.mode = "break";
		this.shot = 0;
		this.accent = false;
	}

	private hideNow(): void {
		this.mode = "hidden";
		this.accent = false;
		this.apply(1, 0, 0);
	}

	private tick(): void {
		if (!this.ticking || this.mode === "hidden" || this.dead) return;
		const dt = this.frameDt();
		if (dt <= 0) return;
		this.angle += (heartSpinDeg(this.remaining) * Math.PI / 180) * dt;
		if (this.mode === "pop") this.tickPop(dt);
		else if (this.mode === "break") this.tickBreak(dt);
		else this.tickBeat(dt);
	}

	private tickPop(dt: number): void {
		this.shot += dt;
		const k = clamp01(this.shot / FX.heartPopSec);
		const scale = lerp(FX.heartPopFrom, 1, ease.outQuad(k));
		this.apply(scale, 1, this.glowPeak() * (0.4 + 0.6 * k));
		if (k < 1) return;
		this.mode = "beat";
		this.phase = 0;
	}

	private tickBeat(dt: number): void {
		const period = Math.max(0.05, this.period());
		this.phase += dt / period;
		if (this.phase >= 1) {
			this.phase -= Math.floor(this.phase);
			this.accent = false;
		}
		this.apply(this.currentScale(), 1, this.currentGlow());
	}

	private tickBreak(dt: number): void {
		this.shot += dt;
		const k = clamp01(this.shot / FX.heartBreakSec);
		const scale = lerp(FX.heartBreakFrom, FX.heartBreakTo, k);
		const opacity = 1 - k;
		this.apply(scale, opacity, this.glowPeak() * opacity);
		if (k < 1) return;
		this.hideNow();
	}

	private currentScale(): number {
		if (this.mode !== "beat") return 1;
		return beatScale(this.phase, this.accent ? FX.heartAccentPeak : this.peak());
	}

	private currentGlow(): number {
		if (this.mode !== "beat") return 0;
		const peak = this.accent ? FX.heartAccentPeak : this.peak();
		const scale = beatScale(this.phase, peak);
		const pulse = peak <= 1 ? 0 : clamp01((scale - 1) / (peak - 1));
		return this.glowPeak() * (0.4 + 0.6 * pulse);
	}

	private period(): number {
		if (this.band === "panic") return FX.heartPanicPeriod;
		if (this.band === "warn") return FX.heartWarnPeriod;
		return FX.heartRestPeriod;
	}

	private peak(): number {
		if (this.band === "panic") return FX.heartPanicPeak;
		if (this.band === "warn") return FX.heartWarnPeak;
		return FX.heartRestPeak;
	}

	private glowPeak(): number {
		if (this.band === "panic") return FX.heartPanicGlow;
		if (this.band === "warn") return FX.heartWarnGlow;
		return FX.heartRestGlow;
	}

	private apply(scale: number, opacity: number, glow: number): void {
		this.pose.scale = scale;
		this.pose.opacity = opacity;
		this.pose.glow = glow;
		const { x, y, size } = this.anchor;
		const s = size * scale;
		this.place(this.glow, x, y, s * FX.heartGlowScale, glow);
		this.place(this.mask, x, y, s, opacity);
		this.place(this.gradient, x, y, s * FX.heartGradientScale, opacity);
		if (this.gradient) this.gradient.angle = this.angle;
	}

	private place(inst: HeartSprite | null, x: number, y: number, size: number, opacity: number): void {
		if (!inst) return;
		inst.x = x;
		inst.y = y;
		inst.width = size;
		inst.height = size;
		inst.opacity = opacity;
	}

	private ensure(): boolean {
		if (this.dead) return false;
		if (this.glow && this.mask && this.gradient) return true;
		this.destroySprites();
		const glow = this.spawn(HEART_OBJECT, GLOW_FRAME);
		const mask = this.spawn(HEART_OBJECT, MASK_FRAME);
		const gradient = this.spawn(GRADIENT_OBJECT, 0);
		if (!glow || !mask || !gradient || !this.bindBlend(gradient)) {
			glow?.destroy();
			mask?.destroy();
			gradient?.destroy();
			this.glow = null;
			this.mask = null;
			this.gradient = null;
			return false;
		}
		gradient.moveToTop?.();
		this.glow = glow;
		this.mask = mask;
		this.gradient = gradient;
		return true;
	}

	private bindBlend(gradient: HeartSprite): boolean {
		if (!hasBlendSetter(gradient)) {
			this.fail("streak heart needs blendMode \"source-in\"; heart hidden");
			return false;
		}
		try {
			gradient.blendMode = "source-in";
		} catch (err) {
			this.fail("could not set streak heart blend mode", err);
			return false;
		}
		if (gradient.blendMode !== "source-in") {
			this.fail("streak heart blendMode did not stick; heart hidden");
			return false;
		}
		return true;
	}

	private spawn(objectName: string, frame: number): HeartSprite | null {
		const type = (this.runtime.objects as unknown as Record<string, IObjectType | undefined>)[objectName];
		if (!type) {
			this.fail(`object type "${objectName}" is missing; streak heart hidden`);
			return null;
		}
		let inst: HeartSprite | null = null;
		try {
			inst = type.createInstance(STREAK_LAYER, this.anchor.x, this.anchor.y) as unknown as HeartSprite;
			inst.stopAnimation?.();
			inst.animationFrame = frame;
			inst.opacity = 0;
			return inst;
		} catch (err) {
			safeDestroy(inst);
			this.fail(`could not create ${objectName} on ${STREAK_LAYER}`, err);
			return null;
		}
	}

	private destroySprites(): void {
		safeDestroy(this.glow);
		safeDestroy(this.mask);
		safeDestroy(this.gradient);
		this.glow = null;
		this.mask = null;
		this.gradient = null;
	}

	private fail(message: string, err?: unknown): void {
		this.dead = true;
		this.mode = "hidden";
		if (this.warned) return;
		this.warned = true;
		console.warn(`[BlockBlast] ${message}`, err ?? "");
	}

	private frameDt(): number {
		const now = performance.now() / 1000;
		const d = this.lastTime < 0 ? 1 / 60 : now - this.lastTime;
		this.lastTime = now;
		return Math.min(Math.max(d, 0), 0.1);
	}
}

function hasBlendSetter(inst: object): boolean {
	let proto: object | null = inst;
	while (proto) {
		const desc = Object.getOwnPropertyDescriptor(proto, "blendMode");
		if (desc?.set) return true;
		proto = Object.getPrototypeOf(proto);
	}
	return false;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp01(n: number): number {
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function safeDestroy(inst: { destroy(): void } | null): void {
	if (!inst) return;
	try {
		inst.destroy();
	} catch {
		// Layout already destroyed the instance.
	}
}
