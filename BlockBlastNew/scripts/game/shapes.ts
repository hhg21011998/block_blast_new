import type { Shape } from "./shape.js";

let shapes: Shape[] = [];
let spawnShapes: Shape[] = [];

export function getShapes(): readonly Shape[] {
	return shapes;
}

export function getSpawnShapes(): readonly Shape[] {
	return spawnShapes;
}

export function applyShapesJson(data: { shapes: Shape[] }): void {
	shapes = data.shapes.slice();
	spawnShapes = shapes.filter((s) => s.brc === 0);
}
