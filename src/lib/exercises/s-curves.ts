import type { ExerciseConfig, ExerciseMode, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { sampleBezier, pointToSegmentDist } from '$lib/scoring/geometry';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot } from './utils';

export interface SCurveParams {
	x1: number;
	y1: number;
	cp1x: number;
	cp1y: number;
	mx: number;
	my: number;
	cpMx: number;
	cpMy: number;
	cp2x: number;
	cp2y: number;
	x2: number;
	y2: number;
}

function sampleSCurve(p: SCurveParams, n = 60): { x: number; y: number }[] {
	const half = Math.floor(n / 2);
	const first = sampleBezier(
		{ x: p.x1, y: p.y1 },
		{ x: p.cp1x, y: p.cp1y },
		{ x: p.cpMx, y: p.cpMy },
		{ x: p.mx, y: p.my },
		half,
	);
	const cpM2x = 2 * p.mx - p.cpMx;
	const cpM2y = 2 * p.my - p.cpMy;
	const second = sampleBezier(
		{ x: p.mx, y: p.my },
		{ x: cpM2x, y: cpM2y },
		{ x: p.cp2x, y: p.cp2y },
		{ x: p.x2, y: p.y2 },
		half,
	);
	return [...first, ...second.slice(1)];
}

function pointToSCurveDist(px: number, py: number, samples: { x: number; y: number }[]): number {
	let minDist = Infinity;
	for (let i = 0; i < samples.length - 1; i++) {
		const d = pointToSegmentDist(px, py, {
			x1: samples[i].x,
			y1: samples[i].y,
			x2: samples[i + 1].x,
			y2: samples[i + 1].y,
		});
		if (d < minDist) minDist = d;
	}
	return minDist;
}

function scoreSCurveAccuracy(points: StrokePoint[], params: SCurveParams): number {
	if (points.length === 0) return 0;
	const samples = sampleSCurve(params);
	let total = 0;
	for (const p of points) total += pointToSCurveDist(p.x, p.y, samples);
	const avg = total / points.length;
	return Math.max(0, Math.min(100, 100 - (avg / 50) * 100));
}

function highlightDivergent(points: StrokePoint[], params: SCurveParams): ScoredSegment[] {
	const samples = sampleSCurve(params);
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToSCurveDist(points[j].x, points[j].y, samples);
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

function generateSCurve(canvasW: number, canvasH: number, toWorld?: CoordTransform): SCurveParams {
	const minDim = Math.min(canvasW, canvasH);
	const len = minDim * (0.25 + Math.random() * 0.35);
	const angle = Math.random() * Math.PI * 2;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);

	const cx = canvasW * (0.25 + Math.random() * 0.5);
	const cy = canvasH * (0.25 + Math.random() * 0.5);

	const x1 = cx - (cos * len) / 2;
	const y1 = cy - (sin * len) / 2;
	const x2 = cx + (cos * len) / 2;
	const y2 = cy + (sin * len) / 2;
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;

	const perpX = -sin;
	const perpY = cos;
	const bulge = len * (0.25 + Math.random() * 0.3);

	// C1 continuity: cpM outgoing = reflection of cpM incoming across midpoint
	const cp1x = x1 + cos * len * 0.2 + perpX * bulge;
	const cp1y = y1 + sin * len * 0.2 + perpY * bulge;
	const cpMx = mx - cos * len * 0.15 + perpX * bulge;
	const cpMy = my - sin * len * 0.15 + perpY * bulge;
	const cp2x = x2 - cos * len * 0.2 - perpX * bulge;
	const cp2y = y2 - sin * len * 0.2 - perpY * bulge;

	const raw: SCurveParams = { x1, y1, cp1x, cp1y, mx, my, cpMx, cpMy, cp2x, cp2y, x2, y2 };
	if (toWorld) {
		const p1 = toWorld(raw.x1, raw.y1);
		const p2 = toWorld(raw.x2, raw.y2);
		const pm = toWorld(raw.mx, raw.my);
		const c1 = toWorld(raw.cp1x, raw.cp1y);
		const cm = toWorld(raw.cpMx, raw.cpMy);
		const c2 = toWorld(raw.cp2x, raw.cp2y);
		return {
			x1: p1.x,
			y1: p1.y,
			cp1x: c1.x,
			cp1y: c1.y,
			mx: pm.x,
			my: pm.y,
			cpMx: cm.x,
			cpMy: cm.y,
			cp2x: c2.x,
			cp2y: c2.y,
			x2: p2.x,
			y2: p2.y,
		};
	}
	return raw;
}

function sCurveArcLen(p: SCurveParams): number {
	const pts = sampleSCurve(p);
	let len = 0;
	for (let i = 1; i < pts.length; i++) {
		len += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2);
	}
	return len;
}

export const sCurvePlugin = defineExercise({
	id: 's-curve',
	unit: 'basic-shapes',
	label: 'S-Curves',
	icon: '∿',
	description: 'Draw compound curves with an inflection point — essential for organic forms.',
	availableModes: ['tracing', 'challenge'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const params = generateSCurve(canvasW, canvasH, toWorld);
		return {
			unit: 'basic-shapes',
			type: 's-curve',
			mode,
			strokeCount: 1,
			references: [{ type: 's-curve', params }],
			availableModes: ['tracing', 'challenge'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as SCurveParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;

		if (visibility === 'full') {
			const cpM2x = 2 * p.mx - p.cpMx;
			const cpM2y = 2 * p.my - p.cpMy;
			ctx.beginPath();
			ctx.moveTo(p.x1, p.y1);
			ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cpMx, p.cpMy, p.mx, p.my);
			ctx.bezierCurveTo(cpM2x, cpM2y, p.cp2x, p.cp2y, p.x2, p.y2);
			ctx.strokeStyle = color;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		drawDot(ctx, p.x1, p.y1, 4, color);
		drawDot(ctx, p.mx, p.my, 3, color);
		drawDot(ctx, p.x2, p.y2, 4, color);
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as SCurveParams;
		const extra = highlightDivergent(points, p);
		return buildMetricScore(points, {
			pathDeviation: scoreSCurveAccuracy(points, p),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start: { x: p.x1, y: p.y1 }, end: { x: p.x2, y: p.y2 } },
			extraSegments: extra,
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const p = reference.params as unknown as SCurveParams;
		const refLen = sCurveArcLen(p);
		if (refLen < 1) return true;

		const s = pts[0];
		const distToP1 = Math.sqrt((s.x - p.x1) ** 2 + (s.y - p.y1) ** 2);
		const distToP2 = Math.sqrt((s.x - p.x2) ** 2 + (s.y - p.y2) ** 2);
		const endpointThreshold = Math.max(refLen * 0.4, 40);
		if (distToP1 > endpointThreshold && distToP2 > endpointThreshold) return false;

		const arc = strokeArcLen(pts);
		return arc >= refLen * 0.2;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as SCurveParams;
		return { x: p.mx, y: p.my };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as SCurveParams;
		const cpM2x = 2 * p.mx - p.cpMx;
		const cpM2y = 2 * p.my - p.cpMy;
		const xs = [p.x1, p.cp1x, p.cpMx, p.mx, cpM2x, p.cp2x, p.x2];
		const ys = [p.y1, p.cp1y, p.cpMy, p.my, cpM2y, p.cp2y, p.y2];
		const margin = 10;
		return {
			minX: Math.min(...xs) - margin,
			minY: Math.min(...ys) - margin,
			maxX: Math.max(...xs) + margin,
			maxY: Math.max(...ys) + margin,
		};
	},
});

registerExercise(sCurvePlugin);
