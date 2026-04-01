export type Unit = 'basic-shapes' | 'perspective';
export type ShapeType = 'line' | 'circle' | 'ellipse' | 'rectangle';
export type PerspectiveExerciseType = '1-point-box';
export type ExerciseType = ShapeType | PerspectiveExerciseType;
export type ExerciseMode = 'guided' | 'semi-guided' | 'free';

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

export type ShapeParams = LineParams | CircleParams | EllipseParams | RectParams | PerspectiveBoxParams;

export interface ReferenceShape {
	type: ExerciseType;
	params: ShapeParams;
}

export interface ExerciseConfig {
	unit: Unit;
	type: ExerciseType;
	mode: ExerciseMode;
	strokeCount: number;
	references: ReferenceShape[];
	availableModes: ExerciseMode[];
}

export interface ExerciseDefinition {
	unit: Unit;
	type: ExerciseType;
	label: string;
	description: string;
	availableModes: ExerciseMode[];
	defaultStrokeCount: number;
}
