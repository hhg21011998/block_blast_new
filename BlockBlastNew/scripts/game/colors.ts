export interface ColorDef {
	id: number;
	name: string;
	animation: string;
	rgb: readonly [number, number, number];
}

const DEFAULT_COLORS: ColorDef[] = [
	{ id: 1, name: "blue", animation: "Blue", rgb: [0.24, 0.66, 0.99] },
	{ id: 2, name: "indigo", animation: "Indigo", rgb: [0.49, 0.36, 1.0] },
	{ id: 3, name: "green", animation: "Green", rgb: [0.24, 0.86, 0.59] },
	{ id: 4, name: "orange", animation: "Orange", rgb: [1.0, 0.69, 0.13] },
	{ id: 5, name: "red", animation: "Red", rgb: [1.0, 0.36, 0.48] },
	{ id: 6, name: "violet", animation: "Violet", rgb: [0.75, 0.52, 0.99] },
	{ id: 7, name: "yellow", animation: "Yellow", rgb: [1.0, 0.88, 0.3] }
];

const byId = new Map<number, ColorDef>();

function rebuild(list: ColorDef[]): void {
	byId.clear();
	for (const def of list) {
		byId.set(def.id, def);
	}
}

rebuild(DEFAULT_COLORS);

export const EMPTY_RGB: readonly [number, number, number] = [0.22, 0.18, 0.32];
export const INVALID_RGB: readonly [number, number, number] = [1.0, 0.25, 0.25];
export const PREVIEW_RGB: readonly [number, number, number] = [1.0, 1.0, 1.0];

export function applyColorsJson(data: { colors: ColorDef[] }): void {
	rebuild(data.colors);
}

export function rgbFor(colorId: number): readonly [number, number, number] {
	return byId.get(colorId)?.rgb ?? DEFAULT_COLORS[0]!.rgb;
}

export function animationFor(colorId: number): string {
	return byId.get(colorId)?.animation ?? "Blue";
}

export function colorName(colorId: number): string {
	return byId.get(colorId)?.name ?? "blue";
}
