export type ExerciseMode = 'tracing' | 'challenge' | 'memory' | 'free';

// Concrete param types for built-in exercises.
// Plugins define their own params internally and cast as needed.

export interface LineParams {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface CircleParams {
	cx: number;
	cy: number;
	r: number;
}

export interface EllipseParams {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	rotation: number;
}

export interface RectParams {
	cx: number;
	cy: number;
	w: number;
	h: number;
	rotation: number;
}

export interface QuadParams {
	corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}

export interface PerspectiveBoxParams {
	horizon: { y: number };
	vanishingPoint: { x: number; y: number };
	givenCorner: { x: number; y: number };
	givenEdges: {
		horizontal: LineParams;
		vertical: LineParams;
		depth: LineParams;
	};
	expectedEdges: LineParams[];
}

export interface CurveParams {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	cp1x: number;
	cp1y: number;
	cp2x: number;
	cp2y: number;
}

export interface PressureLineParams {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface TaperParams {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	startPressure: number;
	endPressure: number;
}

export interface PressureControlParams {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	cp1x?: number;
	cp1y?: number;
	cp2x?: number;
	cp2y?: number;
	isCurve: boolean;
	startPressure: number;
	endPressure: number;
}

export interface ThreePointBoxParams {
	vps: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
	yCorner: { x: number; y: number };
	yEdges: [LineParams, LineParams, LineParams];
	expectedEdges: Array<LineParams & { vpIndex: 0 | 1 | 2 }>;
}

export interface ReferenceShape {
	type: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	params: any;
}

export interface ExerciseConfig {
	unit: string;
	type: string;
	mode: ExerciseMode;
	strokeCount: number;
	references: ReferenceShape[];
	availableModes: ExerciseMode[];
}
