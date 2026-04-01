import type { ExerciseConfig, ExerciseDefinition, LineParams, ReferenceShape } from './types';

export const lineDefinition: ExerciseDefinition = {
	unit: 'basic-shapes',
	type: 'line',
	label: 'Lines',
	description: 'Draw straight lines between two points. Focus on confident, smooth strokes.',
	availableModes: ['guided', 'semi-guided', 'free'],
	defaultStrokeCount: 8
};

export function generateLineExercise(
	mode: 'guided' | 'semi-guided' | 'free',
	canvasW: number,
	canvasH: number,
	count = 8
): ExerciseConfig {
	const diagonal = Math.sqrt(canvasW * canvasW + canvasH * canvasH);
	const margin = 30;

	const references: ReferenceShape[] = [];
	for (let i = 0; i < count; i++) {
		references.push({ type: 'line' as const, params: randomLine(canvasW, canvasH, diagonal, margin) });
	}

	return {
		unit: 'basic-shapes',
		type: 'line',
		mode,
		strokeCount: count,
		references,
		availableModes: lineDefinition.availableModes
	};
}

function randomLine(canvasW: number, canvasH: number, diagonal: number, margin: number): LineParams {
	// Target length: 15%-100% of diagonal, uniformly distributed
	const targetLen = diagonal * (0.15 + Math.random() * 0.85);
	const angle = Math.random() * Math.PI * 2;

	// Rejection-sample a center so both endpoints stay within the canvas
	const halfDx = Math.cos(angle) * targetLen / 2;
	const halfDy = Math.sin(angle) * targetLen / 2;

	// Viable center region for this angle and length
	const cxMin = margin + Math.max(0, halfDx, -halfDx);
	const cxMax = canvasW - margin - Math.max(0, halfDx, -halfDx);
	const cyMin = margin + Math.max(0, halfDy, -halfDy);
	const cyMax = canvasH - margin - Math.max(0, halfDy, -halfDy);

	if (cxMin < cxMax && cyMin < cyMax) {
		const cx = cxMin + Math.random() * (cxMax - cxMin);
		const cy = cyMin + Math.random() * (cyMax - cyMin);
		return {
			x1: cx - halfDx, y1: cy - halfDy,
			x2: cx + halfDx, y2: cy + halfDy
		};
	}

	// Line too long for this angle — pick two random points near opposite edges instead
	const x1 = margin + Math.random() * (canvasW - 2 * margin);
	const y1 = margin + Math.random() * (canvasH - 2 * margin);
	const x2 = margin + Math.random() * (canvasW - 2 * margin);
	const y2 = margin + Math.random() * (canvasH - 2 * margin);
	return { x1, y1, x2, y2 };
}
