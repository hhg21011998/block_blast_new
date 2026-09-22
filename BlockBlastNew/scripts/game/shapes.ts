import type { Shape } from "./shape.js";

let shapes: Shape[] = [];

export function getShapes(): readonly Shape[] {
	return shapes;
}

export function applyShapesJson(data: { shapes: Shape[] }): void {
	shapes = data.shapes.slice();
}
