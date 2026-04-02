import type { ExerciseConfig, ExerciseMode, CurveParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToBezierDist, bezierArcLen } from '$lib/scoring/geometry';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, randomCurve } from './utils';

function scoreCurveAccuracy(points: StrokePoint[], curve: CurveParams): number {
	if (points.length === 0) return 0;
	let totalDist = 0;
	for (const p of points) totalDist += pointToBezierDist(p.x, p.y, curve);
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
}

function highlightDivergent(points: StrokePoint[], curve: CurveParams): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToBezierDist(points[j].x, points[j].y, curve);
		const avgDist = totalDist / (end - i);

		if (avgDist > threshold) {
			const severity = Math.min(1, avgDist / 50);
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last.issue === 'divergent' && last.endIdx >= i - 2) {
					last.endIdx = end - 1;
					last.severity = Math.max(last.severity, severity);
					continue;
				}
			}
			segments.push({ startIdx: i, endIdx: end - 1, issue: 'divergent', severity });
		}
	}
	return segments;
}

export const curvePlugin = defineExercise({
	id: 'curve',
	unit: 'strokes',
	label: 'Curves',
	icon: '〰',
	description: 'Draw smooth bezier curves. Focus on fluid, continuous strokes that follow the path.',
	availableModes: ['guided'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const diagonal = Math.sqrt(canvasW * canvasW + canvasH * canvasH);
		const raw = randomCurve(canvasW, canvasH, diagonal, 30);

		const p1 = toWorld ? toWorld(raw.x1, raw.y1) : { x: raw.x1, y: raw.y1 };
		const p2 = toWorld ? toWorld(raw.x2, raw.y2) : { x: raw.x2, y: raw.y2 };
		const c1 = toWorld ? toWorld(raw.cp1x, raw.cp1y) : { x: raw.cp1x, y: raw.cp1y };
		const c2 = toWorld ? toWorld(raw.cp2x, raw.cp2y) : { x: raw.cp2x, y: raw.cp2y };

		const params: CurveParams = {
			x1: p1.x, y1: p1.y,
			x2: p2.x, y2: p2.y,
			cp1x: c1.x, cp1y: c1.y,
			cp2x: c2.x, cp2y: c2.y
		};

		return {
			unit: 'strokes',
			type: 'curve',
			mode,
			strokeCount: 1,
			references: [{ type: 'curve', params }],
			availableModes: ['guided']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as CurveParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;

		if (visibility === 'full') {
			ctx.beginPath();
			ctx.moveTo(p.x1, p.y1);
			ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x2, p.y2);
			ctx.strokeStyle = color;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		drawDot(ctx, p.x1, p.y1, 4, color);
		drawDot(ctx, p.x2, p.y2, 4, color);
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as CurveParams;
		const extra = highlightDivergent(points, p);
		return buildMetricScore(points, {
			pathDeviation: scoreCurveAccuracy(points, p),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start: { x: p.x1, y: p.y1 }, end: { x: p.x2, y: p.y2 } },
			extraSegments: extra,
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number, _canvasH: number, _mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;

		const p = reference.params as unknown as CurveParams;
		const refLen = bezierArcLen(p);
		if (refLen < 1) return true;

		const s = pts[0];
		const distToP1 = Math.sqrt((s.x - p.x1) ** 2 + (s.y - p.y1) ** 2);
		const distToP2 = Math.sqrt((s.x - p.x2) ** 2 + (s.y - p.y2) ** 2);
		const endpointThreshold = Math.max(refLen * 0.4, 40);
		if (distToP1 > endpointThreshold && distToP2 > endpointThreshold) return false;

		const arc = strokeArcLen(pts);
		return arc >= refLen * 0.25;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as CurveParams;
		return {
			x: (p.x1 + p.x2 + p.cp1x + p.cp2x) / 4,
			y: (p.y1 + p.y2 + p.cp1y + p.cp2y) / 4
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as CurveParams;
		const xs = [p.x1, p.x2, p.cp1x, p.cp2x];
		const ys = [p.y1, p.y2, p.cp1y, p.cp2y];
		const margin = 10;
		return {
			minX: Math.min(...xs) - margin,
			minY: Math.min(...ys) - margin,
			maxX: Math.max(...xs) + margin,
			maxY: Math.max(...ys) + margin
		};
	}
});

registerExercise(curvePlugin);
