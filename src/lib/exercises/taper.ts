import type { ExerciseConfig, ExerciseMode, TaperParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { drawPressureStroke } from '$lib/canvas/renderer';
import { renderPressureHighlights } from '$lib/canvas/highlights';
import {
	defineExercise,
	buildMetricScore,
	getStrokePoints,
	strokeChord,
	angleDiff,
	type CoordTransform,
} from './plugin';
import { registerExercise } from './registry';
import {
	GUIDE_COLOR,
	HINT_COLOR,
	drawDot,
	randomLine,
	scoreLineAccuracy,
	highlightLineDivergent,
	drawTaperedRibbon,
	lineToPathPoints,
	projectOntoLine,
	pressureShapeScore,
} from './utils';

const MAX_RIBBON_WIDTH = 10;

function scoreTaperMatch(points: StrokePoint[], taper: TaperParams): number {
	if (points.length < 3) return 100;

	const refLen = Math.sqrt((taper.x2 - taper.x1) ** 2 + (taper.y2 - taper.y1) ** 2);
	if (refLen === 0) return 100;

	let totalDiff = 0;
	for (const pt of points) {
		const t = Math.max(0, Math.min(1, projectOntoLine(pt, taper)));
		const expected = taper.startPressure + (taper.endPressure - taper.startPressure) * t;
		totalDiff += Math.abs(pt.pressure - expected);
	}

	const avgDiff = totalDiff / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDiff / 0.3) * 100));
}

function detectPressureDeviation(points: StrokePoint[], taper: TaperParams): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const threshold = 0.15;

	for (let i = 0; i < points.length; i++) {
		const t = Math.max(0, Math.min(1, projectOntoLine(points[i], taper)));
		const expected = taper.startPressure + (taper.endPressure - taper.startPressure) * t;
		const diff = Math.abs(points[i].pressure - expected);

		if (diff > threshold) {
			const severity = Math.min(1, diff / 0.4);
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last.issue === 'pressure_deviation' && last.endIdx >= i - 3) {
					last.endIdx = i;
					last.severity = Math.max(last.severity, severity);
					continue;
				}
			}
			segments.push({ startIdx: i, endIdx: i, issue: 'pressure_deviation', severity });
		}
	}
	return segments;
}

export const taperPlugin = defineExercise({
	id: 'taper',
	unit: 'strokes',
	label: 'Taper',
	icon: '◥',
	description: 'Trace a tapered line, gradually increasing or decreasing pressure. Requires pressure-sensitive input.',
	availableModes: ['tracing'],
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

		const taperIn = Math.random() < 0.5;
		const params: TaperParams = {
			x1: p1.x,
			y1: p1.y,
			x2: p2.x,
			y2: p2.y,
			startPressure: taperIn ? 0.8 : 0.1,
			endPressure: taperIn ? 0.1 : 0.8,
		};
		return {
			unit: 'strokes',
			type: 'taper',
			mode,
			strokeCount: 1,
			references: [{ type: 'taper', params }],
			availableModes: ['tracing'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as TaperParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;
		const fillColor = color.replace(/[\d.]+\)$/, '0.25)');
		const startW = p.startPressure * MAX_RIBBON_WIDTH;
		const endW = p.endPressure * MAX_RIBBON_WIDTH;

		if (visibility === 'full') {
			const pathPts = lineToPathPoints(p.x1, p.y1, p.x2, p.y2);
			drawTaperedRibbon(ctx, pathPts, startW, endW, fillColor);
			ctx.beginPath();
			ctx.moveTo(p.x1, p.y1);
			ctx.lineTo(p.x2, p.y2);
			ctx.strokeStyle = color;
			ctx.lineWidth = 1;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		drawDot(ctx, p.x1, p.y1, Math.max(3, startW / 2), color);
		drawDot(ctx, p.x2, p.y2, Math.max(3, endW / 2), color);
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as TaperParams;
		const accuracy = scoreLineAccuracy(points, p);
		const divergent = highlightLineDivergent(points, p);
		const pressure = detectPressureDeviation(points, p);
		return buildMetricScore(points, {
			pathDeviation: accuracy,
			smoothness: true,
			speedConsistency: true,
			taperQuality: { startPressure: p.startPressure, endPressure: p.endPressure },
			endpointAccuracy: { start: { x: p.x1, y: p.y1 }, end: { x: p.x2, y: p.y2 } },
			extraSegments: [...divergent, ...pressure],
		});
	},

	computeShapeScore: pressureShapeScore,

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		_canvasW: number,
		_canvasH: number,
		_mode: ExerciseMode,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		const p = reference.params as unknown as TaperParams;
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
		const p = params as unknown as TaperParams;
		return { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as TaperParams;
		const margin = 10;
		return {
			minX: Math.min(p.x1, p.x2) - margin,
			minY: Math.min(p.y1, p.y2) - margin,
			maxX: Math.max(p.x1, p.x2) + margin,
			maxY: Math.max(p.y1, p.y2) + margin,
		};
	},
});

registerExercise(taperPlugin);
