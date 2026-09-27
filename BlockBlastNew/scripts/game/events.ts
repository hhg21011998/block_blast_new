export type GameEventMap = {
	started: { score: number };
	placed: {
		guid: string;
		cells: number;
		originCol: number;
		originRow: number;
		scoreDelta: number;
		score: number;
	};
	cleared: {
		lineCount: number;
		rows: number[];
		cols: number[];
		cellsRemoved: number;
		boardClear: boolean;
		combo: number;
		/** Combo multiplier applied to the line points of this move (1 when disabled). */
		multiplier: number;
		/** Line points x multiplier + board-clear bonus (placement points excluded). */
		scoreDelta: number;
		score: number;
	};
	bankRefill: { guids: string[] };
	unplaceable: { slot: number; unplaceable: boolean };
	/** No bank piece fits: the lose delay (ms) has just started; `lose` follows. */
	loseStart: { delayMs: number; score: number };
	lose: { score: number };
	score: { score: number };
};

export type GameEventName = keyof GameEventMap;

type Handler<K extends GameEventName> = (payload: GameEventMap[K]) => void;

export class EventBus {
	private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

	on<K extends GameEventName>(name: K, handler: Handler<K>): () => void {
		let set = this.handlers.get(name);
		if (!set) {
			set = new Set();
			this.handlers.set(name, set);
		}
		const wrapped = handler as (payload: unknown) => void;
		set.add(wrapped);
		return () => {
			set!.delete(wrapped);
		};
	}

	emit<K extends GameEventName>(name: K, payload: GameEventMap[K]): void {
		const set = this.handlers.get(name);
		if (!set) return;
		for (const handler of set) {
			handler(payload);
		}
	}

	clear(): void {
		this.handlers.clear();
	}
}
