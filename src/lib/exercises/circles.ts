import type { ExerciseConfig, ExerciseDefinition, CircleParams, ReferenceShape } from './types';
import { placeNonOverlapping } from './placement';

export const circleDefinition: ExerciseDefinition = {
	unit: 'basic-shapes',
	type: 'circle',
	label: 'Circles',
	description: 'Draw circles. Aim for round, even shapes with a single confident stroke.',
	availableModes: ['guided', 'semi-guided'],
	defaultStrokeCount: 4
};

export function generateCircleExercise(
	mode: 'guided' | 'semi-guided',
	canvasW: number,
	canvasH: number,
	count = 4
): ExerciseConfig {
	const minDim = Math.min(canvasW, canvasH);
	const radii = Array.from({ length: count }, () => {
		return minDim * (0.05 + Math.random() * 0.13);
	});

	const slots = placeNonOverlapping(
		count,
		canvasW,
		canvasH,
		(i) => ({ w: radii[i] * 2, h: radii[i] * 2 }),
		30,
		18
	);

	const references: ReferenceShape[] = slots.map((slot, i) => {
		const params: CircleParams = {
			cx: slot.x + slot.w / 2,
			cy: slot.y + slot.h / 2,
			r: radii[i]
		};
		return { type: 'circle' as const, params };
	});

	return {
		unit: 'basic-shapes',
		type: 'circle',
		mode,
		strokeCount: count,
		references,
		availableModes: circleDefinition.availableModes
	};
}
