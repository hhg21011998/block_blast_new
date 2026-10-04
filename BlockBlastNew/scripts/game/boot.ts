/**
 * Runtime shell. `main.ts` only imports this module.
 * Event sheets see these exports as `Game.*` via importsForEvents.ts.
 *
 * Startup order: data JSON + high score load async in `boot`. The Game layout is
 * built only from `boot` (first run) and the Game layout's `beforelayoutstart`
 * listener (later runs), and only once data is ready. Event sheets must NOT call
 * initLayout on start of layout; if they do, the guard below makes it a no-op.
 */
import { loadGameData } from "./data.js";
import { loadHighScore } from "./storage.js";
import { applyHud, hudWindowKey, setPrecisionPointer } from "./hud.js";
import type { GameEventMap, GameEventName } from "./events.js";
import {
	isMouseHeld,
	layoutPosFromEvent,
	isPrimaryButton,
	pollLayoutPos
} from "./input.js";
import { GameApp } from "./view.js";

// Combo FX hooks for the animator / event sheets (Game.onComboShown etc.).
export { onComboShown, onGameOverStart, onHudRelayout } from "./comboFx.js";
export type { ComboShownInfo, GameOverStartInfo, HudRelayoutInfo } from "./comboFx.js";
// Lose-panel slide hooks (Game.setLosePanelOffset etc.).
export { getLosePanelOffset, onLosePanelLayout, setLosePanelOffset } from "./ui.js";
export type { LosePanelLayoutInfo, Rect as LosePanelRect } from "./ui.js";

let app: GameApp | null = null;
let pointerBound = false;
let autoInput = true;
/** Shapes/colors/classic/hand JSON applied. Building before this throws in spawnBank. */
let dataReady = false;
/** Game layout already built for the current run of that layout. */
let builtThisRun = false;

/** Set false if the event sheet drives Touch/Mouse into pointerDown/Move/Up. */
export function setAutoInput(enabled: boolean): void {
	autoInput = enabled;
}

export function getApp(): GameApp | null {
	return app;
}

/**
 * Build the Game layout. Idempotent per layout run and ignored until data has loaded,
 * so a stray extra call (e.g. from an event sheet) cannot build twice.
 */
export function initLayout(runtime: IRuntime): void {
	if (!dataReady || builtThisRun) return;
	if (runtime.layout.name !== "Game") return;
	applyHud(runtime);
	if (app) {
		try {
			app.dispose();
		} catch (err) {
			console.warn("[BlockBlast] dispose of previous game failed", err);
		}
		app = null;
	}
	const next = new GameApp(runtime);
	try {
		next.start();
	} catch (err) {
		// Leave builtThisRun false so a later call (next layout start) can retry.
		console.error("[BlockBlast] failed to build Game layout", err);
		try {
			next.dispose();
		} catch {
			// ignore
		}
		return;
	}
	app = next;
	builtThisRun = true;
}

export function pointerDown(x: number, y: number): void {
	app?.pointerDown(x, y);
}

export function pointerMove(x: number, y: number): void {
	app?.pointerMove(x, y);
}

export function pointerUp(x: number, y: number): void {
	app?.pointerUp(x, y);
}

export function cancelDrag(): void {
	app?.cancelDrag();
}

/** Start a new run on the current layout (same as the game-over Replay button). */
export function replay(): void {
	app?.replay();
}

export function getBoard() {
	return app?.session.board ?? null;
}

export function getScore(): number {
	return app?.session.score.score ?? 0;
}

export function getCombo(): number {
	return app?.session.score.combo ?? 0;
}

export function isLost(): boolean {
	return app?.session.lost ?? false;
}

export function on<K extends GameEventName>(
	name: K,
	handler: (payload: GameEventMap[K]) => void
): () => void {
	if (!app) return () => undefined;
	return app.session.events.on(name, handler);
}

runOnStartup(async (runtime: IRuntime) => {
	runtime.addEventListener("beforeprojectstart", () => {
		boot(runtime).catch((err: unknown) => {
			console.error("[BlockBlast] boot failed", err);
		});
	});
});

async function boot(runtime: IRuntime): Promise<void> {
	// Input + resize handlers first: they only act when `app` exists, and must not
	// depend on the layout build succeeding.
	if (!pointerBound) {
		pointerBound = true;
		bindPointer(runtime);
		bindHudResize(runtime);
	}
	await Promise.all([loadGameData(runtime), loadHighScore(runtime)]);
	dataReady = true;
	const gameLayout = runtime.getLayout("Game");
	// Later runs of the Game layout (restart / goToLayout).
	gameLayout.addEventListener("beforelayoutstart", () => {
		initLayout(runtime);
	});
	gameLayout.addEventListener("afterlayoutend", () => {
		// Construct already destroyed the instances; just stop timers/listeners.
		app?.detach();
		app = null;
		builtThisRun = false;
	});
	// First run: the layout started while data was still loading.
	if (runtime.layout.name === "Game") {
		initLayout(runtime);
	}
}

function bindHudResize(runtime: IRuntime): void {
	let lastKey = "";
	const sync = () => {
		if (runtime.layout.name !== "Game" || !app) return;
		const key = hudWindowKey(runtime);
		if (key === lastKey) return;
		lastKey = key;
		applyHud(runtime);
		app.relayout();
	};
	runtime.addEventListener("resize", sync);
	runtime.addEventListener("tick", sync);
}

function bindPointer(runtime: IRuntime): void {
	let held = false;
	let source: "none" | "pointer" | "mouse" = "none";
	/**
	 * pointerId that owns the current press (multi-touch): other fingers are ignored
	 * until it lifts. null = no owner / event without a pointerId.
	 */
	let ownerId: number | null = null;
	const pointerIdOf = (event?: unknown): number | null => {
		const id = (event as { pointerId?: unknown } | undefined)?.pointerId;
		return typeof id === "number" ? id : null;
	};
	const isOwner = (event?: unknown): boolean => {
		if (ownerId === null) return true;
		const id = pointerIdOf(event);
		return id === null || id === ownerId;
	};

	const down = (p: { x: number; y: number }, src: "pointer" | "mouse", event?: unknown) => {
		if (!autoInput || !app || held) return;
		held = true;
		source = src;
		ownerId = src === "pointer" ? pointerIdOf(event) : null;
		const pointerType = (event as { pointerType?: string } | undefined)?.pointerType;
		setPrecisionPointer(src === "mouse" || pointerType === "mouse" || pointerType === "pen");
		pointerDown(p.x, p.y);
	};
	const move = (p: { x: number; y: number }) => {
		if (!autoInput || !held) return;
		pointerMove(p.x, p.y);
	};
	const up = (p: { x: number; y: number }) => {
		if (!autoInput || !held) return;
		held = false;
		source = "none";
		ownerId = null;
		pointerUp(p.x, p.y);
	};
	/** Abort the press: a dragged piece goes back to its bank slot, nothing is placed. */
	const cancel = () => {
		if (!held) return;
		held = false;
		source = "none";
		ownerId = null;
		cancelDrag();
	};

	runtime.addEventListener("pointerdown", (event?: unknown) => {
		if (!isPrimaryButton(event)) return;
		// A second finger while one is pressed: ignored (down() also checks `held`).
		if (held) return;
		down(layoutPosFromEvent(runtime, event), "pointer", event);
	});
	runtime.addEventListener("pointermove", (event?: unknown) => {
		if (source === "pointer" && !isOwner(event)) return;
		move(layoutPosFromEvent(runtime, event));
	});
	runtime.addEventListener("pointerup", (event?: unknown) => {
		if (source === "pointer" && !isOwner(event)) return;
		up(layoutPosFromEvent(runtime, event));
	});
	runtime.addEventListener("pointercancel", (event?: unknown) => {
		if (source === "pointer" && !isOwner(event)) return;
		cancel();
	});
	// Tab hidden / app backgrounded mid-drag (Construct "suspend"): return the piece.
	runtime.addEventListener("suspend", cancel);

	runtime.addEventListener("tick", () => {
		if (!autoInput || !app) return;
		if (source === "pointer") return;
		const mouseHeld = isMouseHeld(runtime);
		const p = pollLayoutPos(runtime);
		if (mouseHeld && !held) down(p, "mouse");
		else if (mouseHeld && held) move(p);
		else if (!mouseHeld && held) up(p);
	});
}
