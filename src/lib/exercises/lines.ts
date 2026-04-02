import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, strokeArcLen, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, randomLine, scoreLineAccuracy, highlightLineDivergent } from './utils';

function scoreFreeLine(points: StrokePoint[]): number {
	if (points.length < 2) return 0;
	const start = points[0];
	const end = points[points.length - 1];
	let arcLen = 0;
	for (let i = 1; i < points.length; i++) {
		arcLen += Math.sqrt((points[i].x - points[i - 1].x) ** 2 + (points[i].y - points[i - 1].y) ** 2);
	}
	const chord = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
	if (chord < 5) return 0;
	return Math.max(0, Math.min(100, (chord / arcLen) * 100));
}

export const linePlugin = defineExercise({
	id: 'line',
	unit: 'basic-shapes',
	label: 'Lines',
	icon: '╱',
	description: 'Draw straight lines between two points. Focus on confident, smooth strokes.',
	availableModes: ['guided', 'challenge', 'free'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const diagonal = Math.sqrt(canvasW * canvasW + canvasH * canvasH);
		const raw = randomLine(canvasW, canvasH, diagonal, 30, 0.85);
		const p1 = toWorld ? toWorld(raw.x1, raw.y1) : { x: raw.x1, y: raw.y1 };
		const p2 = toWorld ? toWorld(raw.x2, raw.y2) : { x: raw.x2, y: raw.y2 };
		const params: LineParams = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
		return {
			unit: 'basic-shapes',
			type: 'line',
			mode,
			strokeCount: 1,
			references: [{ type: 'line', params }],
			availableModes: ['guided', 'challenge', 'free']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as LineParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;
		const lw = visibility === 'full' ? 2 : 1.5;

		ctx.beginPath();
		ctx.moveTo(p.x1, p.y1);
		ctx.lineTo(p.x2, p.y2);
		ctx.strokeStyle = color;
		ctx.lineWidth = lw;
		ctx.setLineDash(visibility === 'full' ? [8, 6] : [6, 8]);
		ctx.stroke();
		ctx.setLineDash([]);
		drawDot(ctx, p.x1, p.y1, 4, color);
		drawDot(ctx, p.x2, p.y2, 4, color);
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, _strokeIndex: number, mode: ExerciseMode): StrokeScore {
		const p = reference.params as unknown as LineParams;
		if (mode === 'free') {
			return buildMetricScore(points, {
				pathDeviation: scoreFreeLine(points),
				smoothness: true,
				speedConsistency: true,
			});
		}
		const extra = highlightLineDivergent(points, p);
		return buildMetricScore(points, {
			pathDeviation: scoreLineAccuracy(points, p),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start: { x: p.x1, y: p.y1 }, end: { x: p.x2, y: p.y2 } },
			extraSegments: extra,
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number, canvasH: number, mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		if (mode === 'free') {
			if (chord < canvasW * 0.05) return false;
			const arc = strokeArcLen(pts);
			return arc > 0 && chord / arc > 0.65;
		}

		const p = reference.params as unknown as LineParams;
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
		const p = params as unknown as LineParams;
		return { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as LineParams;
		const margin = 10;
		return {
			minX: Math.min(p.x1, p.x2) - margin,
			minY: Math.min(p.y1, p.y2) - margin,
			maxX: Math.max(p.x1, p.x2) + margin,
			maxY: Math.max(p.y1, p.y2) + margin
		};
	}
});

registerExercise(linePlugin);
