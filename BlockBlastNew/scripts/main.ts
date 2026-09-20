/**
 * Main script. Construct loads this on startup.
 * Event sheets may call Game.* via importsForEvents.ts — they are not required.
 * Pointer + layout start are bound here.
 */
import { loadGameData } from "./game/data.js";
import { applyHud, hudWindowKey, setPrecisionPointer } from "./game/hud.js";
import type { GameEventMap, GameEventName } from "./game/events.js";
import {
	isMouseHeld,
	layoutPosFromEvent,
	isPrimaryButton,
	pollLayoutPos
} from "./game/input.js";
import { GameApp } from "./game/view.js";

let app: GameApp | null = null;
let pointerBound = false;
let autoInput = true;

/** Set false if the event sheet drives Touch/Mouse into pointerDown/Move/Up. */
export function setAutoInput(enabled: boolean): void {
	autoInput = enabled;
}

export function getApp(): GameApp | null {
	return app;
}

export function initLayout(runtime: IRuntime): void {
	if (runtime.layout.name !== "Game") return;
	applyHud(runtime);
	app?.dispose();
	app = new GameApp(runtime);
	app.start();
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
		void boot(runtime);
	});
});

async function boot(runtime: IRuntime): Promise<void> {
	await loadGameData(runtime);
	runtime.layout.addEventListener("beforelayoutstart", () => {
		initLayout(runtime);
	});
	if (runtime.layout.name === "Game") {
		initLayout(runtime);
	}
	if (!pointerBound) {
		pointerBound = true;
		bindPointer(runtime);
		bindHudResize(runtime);
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

	const down = (p: { x: number; y: number }, src: "pointer" | "mouse", event?: unknown) => {
		if (!autoInput || !app || held) return;
		held = true;
		source = src;
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
		pointerUp(p.x, p.y);
	};

	runtime.addEventListener("pointerdown", (event?: unknown) => {
		if (!isPrimaryButton(event)) return;
		down(layoutPosFromEvent(runtime, event), "pointer", event);
	});
	runtime.addEventListener("pointermove", (event?: unknown) => {
		move(layoutPosFromEvent(runtime, event));
	});
	const pointerUpEv = (event?: unknown) => {
		up(layoutPosFromEvent(runtime, event));
	};
	runtime.addEventListener("pointerup", pointerUpEv);
	runtime.addEventListener("pointercancel", pointerUpEv);

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
