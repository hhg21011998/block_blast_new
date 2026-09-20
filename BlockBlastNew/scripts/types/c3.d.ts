/**
 * Minimal Construct 3 runtime stubs for the external editor.
 * Not listed in project.c3proj.
 */
declare function runOnStartup(
	callback: (runtime: IRuntime) => void | Promise<void>
): void;

interface IRuntime {
	readonly layout: ILayout;
	readonly objects: {
		Block: IObjectType;
		Grid: IObjectType;
		Block_Blue?: IObjectType;
		Mouse?: IObjectType;
		Touch?: IObjectType;
	};
	readonly mouse?: IMouseObject;
	readonly touch?: ITouchObject;
	timeScale: number;
	addEventListener(name: string, callback: (event?: unknown) => void): void;
}

interface IMouseObject {
	getMouseX(layer?: string | number): number;
	getMouseY(layer?: string | number): number;
	isMouseButtonDown(button: number): boolean;
}

interface ITouchObject {
	getTouchCount(): number;
	getTouchX(index: number, layer?: string | number): number;
	getTouchY(index: number, layer?: string | number): number;
	readonly touches?: ReadonlyArray<{ x: number; y: number }>;
}

interface ILayout {
	readonly name: string;
	addEventListener(name: string, callback: () => void): void;
	getLayer(name: string): ILayer | null;
}

interface ILayer {
	cssPxToLayer?(clientX: number, clientY: number): unknown;
}

interface IObjectType {
	createInstance(layerName: string, x: number, y: number): IWorldInstance;
}

interface IWorldInstance {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	setAnimation(name: string, fromBeginning?: boolean): void;
	destroy(): void;
	moveToTop?(): void;
}
