import { applyClassicConfig } from "./constants.js";
import { applyColorsJson } from "./colors.js";
import { applyShapesJson } from "./shapes.js";

const FILES = {
	shapes: "shapes.json",
	colors: "colors.json",
	classic: "classic.json"
} as const;

export async function loadGameData(runtime: IRuntime): Promise<void> {
	const [shapes, colors, classic] = await Promise.all([
		fetchProjectJson(runtime, FILES.shapes),
		fetchProjectJson(runtime, FILES.colors),
		fetchProjectJson(runtime, FILES.classic)
	]);
	applyShapesJson(shapes as { shapes: import("./shape.js").Shape[] });
	applyColorsJson(colors as Parameters<typeof applyColorsJson>[0]);
	applyClassicConfig(classic as Parameters<typeof applyClassicConfig>[0]);
}

async function fetchProjectJson(runtime: IRuntime, filename: string): Promise<unknown> {
	const assets = (
		runtime as IRuntime & {
			assets?: { getProjectFileUrl: (name: string) => Promise<string> };
		}
	).assets;
	const url = assets?.getProjectFileUrl
		? await assets.getProjectFileUrl(filename)
		: filename;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to load ${filename}: ${response.status}`);
	}
	return response.json();
}
