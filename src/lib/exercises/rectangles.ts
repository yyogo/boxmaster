import type { ExerciseConfig, ExerciseDefinition, RectParams, ReferenceShape } from './types';
import { placeNonOverlapping } from './placement';

export const rectangleDefinition: ExerciseDefinition = {
	unit: 'basic-shapes',
	type: 'rectangle',
	label: 'Rectangles',
	description: 'Draw rectangles with straight edges and square corners.',
	availableModes: ['guided', 'semi-guided', 'free'],
	defaultStrokeCount: 4
};

export function generateRectExercise(
	mode: 'guided' | 'semi-guided' | 'free',
	canvasW: number,
	canvasH: number,
	count = 4
): ExerciseConfig {
	const minDim = Math.min(canvasW, canvasH);
	const dims = Array.from({ length: count }, () => {
		const w = minDim * (0.10 + Math.random() * 0.18);
		const ratio = 0.45 + Math.random() * 0.45;
		return {
			w,
			h: w * ratio,
			rotation: Math.random() * Math.PI * 0.3
		};
	});

	const slots = placeNonOverlapping(
		count,
		canvasW,
		canvasH,
		(i) => {
			const maxDim = Math.max(dims[i].w, dims[i].h);
			return { w: maxDim, h: maxDim };
		},
		30,
		18
	);

	const references: ReferenceShape[] = slots.map((slot, i) => {
		const params: RectParams = {
			cx: slot.x + slot.w / 2,
			cy: slot.y + slot.h / 2,
			w: dims[i].w,
			h: dims[i].h,
			rotation: dims[i].rotation
		};
		return { type: 'rectangle' as const, params };
	});

	return {
		unit: 'basic-shapes',
		type: 'rectangle',
		mode,
		strokeCount: count * 4,
		references,
		availableModes: rectangleDefinition.availableModes
	};
}
