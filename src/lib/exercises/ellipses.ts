import type { ExerciseConfig, ExerciseDefinition, EllipseParams, ReferenceShape } from './types';
import { placeNonOverlapping } from './placement';

export const ellipseDefinition: ExerciseDefinition = {
	unit: 'basic-shapes',
	type: 'ellipse',
	label: 'Ellipses',
	description: 'Draw ellipses at various orientations. Keep your strokes smooth and even.',
	availableModes: ['guided', 'semi-guided'],
	defaultStrokeCount: 4
};

export function generateEllipseExercise(
	mode: 'guided' | 'semi-guided',
	canvasW: number,
	canvasH: number,
	count = 4
): ExerciseConfig {
	const minDim = Math.min(canvasW, canvasH);
	const dims = Array.from({ length: count }, () => {
		const rx = minDim * (0.06 + Math.random() * 0.12);
		const ratio = 0.4 + Math.random() * 0.5;
		return {
			rx,
			ry: rx * ratio,
			rotation: Math.random() * Math.PI
		};
	});

	const slots = placeNonOverlapping(
		count,
		canvasW,
		canvasH,
		(i) => {
			const maxR = Math.max(dims[i].rx, dims[i].ry);
			return { w: maxR * 2, h: maxR * 2 };
		},
		30,
		18
	);

	const references: ReferenceShape[] = slots.map((slot, i) => {
		const params: EllipseParams = {
			cx: slot.x + slot.w / 2,
			cy: slot.y + slot.h / 2,
			rx: dims[i].rx,
			ry: dims[i].ry,
			rotation: dims[i].rotation
		};
		return { type: 'ellipse' as const, params };
	});

	return {
		unit: 'basic-shapes',
		type: 'ellipse',
		mode,
		strokeCount: count,
		references,
		availableModes: ellipseDefinition.availableModes
	};
}
