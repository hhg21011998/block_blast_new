/**
 * High score persistence.
 * Uses Construct's `runtime.storage` (async, works in worker mode) and falls back to
 * browser `localStorage` when that is missing. No LocalStorage plugin needed.
 */

const HIGH_SCORE_KEY = "blockblastnew.classic.highScore";

type AsyncStorage = {
	getItem(key: string): Promise<unknown>;
	setItem(key: string, value: unknown): Promise<unknown>;
};

type SyncStorage = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
};

let highScore = 0;

export function getHighScore(): number {
	return highScore;
}

/** Load once at boot, before the first layout build. Never throws. */
export async function loadHighScore(runtime: IRuntime): Promise<number> {
	let raw: unknown = null;
	try {
		const store = asyncStorage(runtime);
		if (store) {
			raw = await store.getItem(HIGH_SCORE_KEY);
		} else {
			raw = syncStorage()?.getItem(HIGH_SCORE_KEY) ?? null;
		}
	} catch (err) {
		console.warn("[BlockBlast] could not read high score", err);
	}
	highScore = Math.max(highScore, sanitize(raw));
	return highScore;
}

/**
 * Record a finished run. Returns true when it beats the stored best.
 * The write is fire-and-forget; the in-memory value updates immediately.
 */
export function submitScore(runtime: IRuntime, score: number): boolean {
	const value = sanitize(score);
	if (value <= highScore) return false;
	highScore = value;
	void persist(runtime, value);
	return true;
}

async function persist(runtime: IRuntime, value: number): Promise<void> {
	try {
		const store = asyncStorage(runtime);
		if (store) {
			await store.setItem(HIGH_SCORE_KEY, value);
		} else {
			syncStorage()?.setItem(HIGH_SCORE_KEY, String(value));
		}
	} catch (err) {
		console.warn("[BlockBlast] could not save high score", err);
	}
}

function asyncStorage(runtime: IRuntime): AsyncStorage | null {
	const store = (runtime as unknown as { storage?: AsyncStorage }).storage;
	return store && typeof store.getItem === "function" ? store : null;
}

function syncStorage(): SyncStorage | null {
	const g = globalThis as unknown as { localStorage?: SyncStorage };
	return g.localStorage ?? null;
}

function sanitize(raw: unknown): number {
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
