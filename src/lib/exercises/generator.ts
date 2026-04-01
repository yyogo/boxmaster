import type { ExerciseConfig, ExerciseMode, ExerciseType } from './types';
import { generateLineExercise } from './lines';
import { generateCircleExercise } from './circles';
import { generateEllipseExercise } from './ellipses';
import { generateRectExercise } from './rectangles';
import { generatePerspectiveExercise } from './perspective';

export function generateExercise(
	type: ExerciseType,
	mode: ExerciseMode,
	canvasW: number,
	canvasH: number,
	count?: number
): ExerciseConfig {
	switch (type) {
		case 'line':
			return generateLineExercise(mode as 'guided' | 'semi-guided' | 'free', canvasW, canvasH, count);
		case 'circle':
			return generateCircleExercise(mode as 'guided' | 'semi-guided', canvasW, canvasH, count);
		case 'ellipse':
			return generateEllipseExercise(mode as 'guided' | 'semi-guided', canvasW, canvasH, count);
		case 'rectangle':
			return generateRectExercise(mode as 'guided' | 'semi-guided' | 'free', canvasW, canvasH, count);
		case '1-point-box':
			return generatePerspectiveExercise(mode as 'guided' | 'semi-guided', canvasW, canvasH, count);
	}
}

export { lineDefinition } from './lines';
export { circleDefinition } from './circles';
export { ellipseDefinition } from './ellipses';
export { rectangleDefinition } from './rectangles';
export { perspectiveDefinition } from './perspective';
