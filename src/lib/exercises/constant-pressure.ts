import type { ExerciseConfig, ExerciseMode, PressureLineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { drawPressureStroke } from '$lib/canvas/renderer';
import { renderPressureHighlights } from '$lib/canvas/highlights';
import { defineExercise, buildStrokeScore, getStrokePoints, strokeChord, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, randomLine, scoreLineAccuracy, highlightLineDivergent, drawRibbon, pressureShapeScore } from './utils';

const RIBBON_WIDTH = 6;

function scorePressureConstancy(points: StrokePoint[]): number {
	if (points.length < 3) return 100;
	const pressures = points.map((p) => p.pressure);
	const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
	const variance = pressures.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pressures.length;
	const stdev = Math.sqrt(variance);
	return Math.max(0, Math.min(100, 100 - (stdev / 0.15) * 100));
}

function detectPressureInconsistency(points: StrokePoint[]): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 12;
	const threshold = 0.08;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		const end = Math.min(i + windowSize, points.length);
		const pressures = points.slice(i, end).map((p) => p.pressure);
		const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
		const variance = pressures.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pressures.length;
		const stdev = Math.sqrt(variance);

		if (stdev > threshold) {
			const severity = Math.min(1, stdev / 0.25);
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last.issue === 'pressure_inconsistent' && last.endIdx >= i - 2) {
					last.endIdx = end - 1;
					last.severity = Math.max(last.severity, severity);
					continue;
				}
			}
			segments.push({ startIdx: i, endIdx: end - 1, issue: 'pressure_inconsistent', severity });
		}
	}
	return segments;
}

export const constantPressurePlugin = defineExercise({
	id: 'constant-pressure',
	unit: 'strokes',
	label: 'Constant Pressure',
	icon: '▬',
	description: 'Draw along the line with steady, even pressure. Requires pressure-sensitive input (pen/stylus).',
	availableModes: ['guided'],
	requiredStrokes: 1,
	defaultCount: 15,
	requiresPressure: true,

	renderStroke(ctx, stroke, color, baseWidth) {
		drawPressureStroke(ctx, stroke, color, baseWidth);
	},
	renderScoredStroke(ctx, stroke, score) {
		renderPressureHighlights(ctx, stroke, score);
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const diagonal = Math.sqrt(canvasW * canvasW + canvasH * canvasH);
		const raw = randomLine(canvasW, canvasH, diagonal, 30);
		const p1 = toWorld ? toWorld(raw.x1, raw.y1) : { x: raw.x1, y: raw.y1 };
		const p2 = toWorld ? toWorld(raw.x2, raw.y2) : { x: raw.x2, y: raw.y2 };
		const params: PressureLineParams = {
			x1: p1.x, y1: p1.y,
			x2: p2.x, y2: p2.y
		};
		return {
			unit: 'strokes',
			type: 'constant-pressure',
			mode,
			strokeCount: 1,
			references: [{ type: 'constant-pressure', params }],
			availableModes: ['guided']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as PressureLineParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;

		if (visibility === 'full') {
			drawRibbon(ctx, p.x1, p.y1, p.x2, p.y2, RIBBON_WIDTH, color.replace(/[\d.]+\)$/, '0.25)'));
			ctx.beginPath();
			ctx.moveTo(p.x1, p.y1);
			ctx.lineTo(p.x2, p.y2);
			ctx.strokeStyle = color;
			ctx.lineWidth = 1;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		drawDot(ctx, p.x1, p.y1, 4, color);
		drawDot(ctx, p.x2, p.y2, 4, color);
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as PressureLineParams;
		const accuracy = scoreLineAccuracy(points, p);
		const divergent = highlightLineDivergent(points, p);
		const pressure = detectPressureInconsistency(points);
		const score = buildStrokeScore(accuracy, points, [...divergent, ...pressure]);
		return { ...score, metrics: { pressureMatch: scorePressureConstancy(points) } };
	},

	computeShapeScore: pressureShapeScore,

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number, _canvasH: number, _mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		const p = reference.params as unknown as PressureLineParams;
		const refLen = Math.sqrt((p.x2 - p.x1) ** 2 + (p.y2 - p.y1) ** 2);
		if (refLen < 1) return true;

		const s = pts[0];
		const distToP1 = Math.sqrt((s.x - p.x1) ** 2 + (s.y - p.y1) ** 2);
		const distToP2 = Math.sqrt((s.x - p.x2) ** 2 + (s.y - p.y2) ** 2);
		const endpointThreshold = Math.max(refLen * 0.4, 40);
		if (distToP1 > endpointThreshold && distToP2 > endpointThreshold) return false;

		const e = pts[pts.length - 1];
		const strokeAngle = Math.atan2(e.y - s.y, e.x - s.x);
		const refAngle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
		const ad = Math.min(angleDiff(strokeAngle, refAngle), angleDiff(strokeAngle, refAngle + Math.PI));
		if (ad > Math.PI / 4) return false;

		return chord >= refLen * 0.25;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as PressureLineParams;
		return { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as PressureLineParams;
		const margin = 10;
		return {
			minX: Math.min(p.x1, p.x2) - margin,
			minY: Math.min(p.y1, p.y2) - margin,
			maxX: Math.max(p.x1, p.x2) + margin,
			maxY: Math.max(p.y1, p.y2) + margin
		};
	}
});

registerExercise(constantPressurePlugin);
