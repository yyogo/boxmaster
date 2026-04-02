import type { ExerciseConfig, ExerciseMode, PressureControlParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist, pointToBezierDist, bezierArcLen, sampleBezier } from '$lib/scoring/geometry';
import { drawPressureStroke } from '$lib/canvas/renderer';
import { renderPressureHighlights } from '$lib/canvas/highlights';
import { defineExercise, buildStrokeScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, randomLine, randomCurve, drawTaperedRibbon, projectOntoLine, pressureShapeScore } from './utils';

const MAX_RIBBON_WIDTH = 10;

function randomCurveParams(canvasW: number, canvasH: number, diagonal: number, margin: number): PressureControlParams {
	const curve = randomCurve(canvasW, canvasH, diagonal, margin);
	return { ...curve, isCurve: true, startPressure: 0.5, endPressure: 0.5 };
}

function getRefArcLen(p: PressureControlParams): number {
	if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
		return bezierArcLen({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, cp1x: p.cp1x, cp1y: p.cp1y, cp2x: p.cp2x, cp2y: p.cp2y });
	}
	return Math.sqrt((p.x2 - p.x1) ** 2 + (p.y2 - p.y1) ** 2);
}

function pointToRefDist(px: number, py: number, p: PressureControlParams): number {
	if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
		return pointToBezierDist(px, py, { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, cp1x: p.cp1x, cp1y: p.cp1y, cp2x: p.cp2x, cp2y: p.cp2y });
	}
	return pointToSegmentDist(px, py, { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 });
}

function scoreGeometricAccuracy(points: StrokePoint[], p: PressureControlParams): number {
	if (points.length === 0) return 0;
	let totalDist = 0;
	for (const pt of points) totalDist += pointToRefDist(pt.x, pt.y, p);
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
}

function projectOntoCurve(pt: StrokePoint, p: PressureControlParams): number {
	if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
		const samples = sampleBezier(
			{ x: p.x1, y: p.y1 },
			{ x: p.cp1x, y: p.cp1y },
			{ x: p.cp2x, y: p.cp2y },
			{ x: p.x2, y: p.y2 }
		);
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < samples.length; i++) {
			const d = (pt.x - samples[i].x) ** 2 + (pt.y - samples[i].y) ** 2;
			if (d < bestDist) { bestDist = d; bestIdx = i; }
		}
		return bestIdx / (samples.length - 1);
	}
	return Math.max(0, Math.min(1, projectOntoLine(pt, p)));
}

function scorePressureMatch(points: StrokePoint[], p: PressureControlParams): number {
	if (points.length < 3) return 100;

	const isConstant = Math.abs(p.startPressure - p.endPressure) < 0.05;

	if (isConstant) {
		const pressures = points.map((pt) => pt.pressure);
		const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
		const variance = pressures.reduce((sum, pr) => sum + (pr - mean) ** 2, 0) / pressures.length;
		const stdev = Math.sqrt(variance);
		return Math.max(0, Math.min(100, 100 - (stdev / 0.15) * 100));
	}

	let totalDiff = 0;
	for (const pt of points) {
		const t = projectOntoCurve(pt, p);
		const expected = p.startPressure + (p.endPressure - p.startPressure) * t;
		totalDiff += Math.abs(pt.pressure - expected);
	}

	const avgDiff = totalDiff / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDiff / 0.3) * 100));
}

function highlightDivergent(points: StrokePoint[], p: PressureControlParams): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToRefDist(points[j].x, points[j].y, p);
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

function detectPressureIssues(points: StrokePoint[], p: PressureControlParams): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const isConstant = Math.abs(p.startPressure - p.endPressure) < 0.05;
	const issueType = isConstant ? 'pressure_inconsistent' as const : 'pressure_deviation' as const;
	const threshold = isConstant ? 0.08 : 0.15;

	if (isConstant) {
		const windowSize = 12;
		for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
			const end = Math.min(i + windowSize, points.length);
			const pressures = points.slice(i, end).map((pt) => pt.pressure);
			const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
			const variance = pressures.reduce((sum, pr) => sum + (pr - mean) ** 2, 0) / pressures.length;
			const stdev = Math.sqrt(variance);

			if (stdev > threshold) {
				const severity = Math.min(1, stdev / 0.25);
				if (segments.length > 0) {
					const last = segments[segments.length - 1];
					if (last.issue === issueType && last.endIdx >= i - 2) {
						last.endIdx = end - 1;
						last.severity = Math.max(last.severity, severity);
						continue;
					}
				}
				segments.push({ startIdx: i, endIdx: end - 1, issue: issueType, severity });
			}
		}
	} else {
		for (let i = 0; i < points.length; i++) {
			const t = projectOntoCurve(points[i], p);
			const expected = p.startPressure + (p.endPressure - p.startPressure) * t;
			const diff = Math.abs(points[i].pressure - expected);

			if (diff > threshold) {
				const severity = Math.min(1, diff / 0.4);
				if (segments.length > 0) {
					const last = segments[segments.length - 1];
					if (last.issue === issueType && last.endIdx >= i - 3) {
						last.endIdx = i;
						last.severity = Math.max(last.severity, severity);
						continue;
					}
				}
				segments.push({ startIdx: i, endIdx: i, issue: issueType, severity });
			}
		}
	}

	return segments;
}

function getPathPoints(p: PressureControlParams, n = 40): { x: number; y: number }[] {
	if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
		return sampleBezier(
			{ x: p.x1, y: p.y1 },
			{ x: p.cp1x, y: p.cp1y },
			{ x: p.cp2x, y: p.cp2y },
			{ x: p.x2, y: p.y2 },
			n
		);
	}
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		pts.push({ x: p.x1 + (p.x2 - p.x1) * t, y: p.y1 + (p.y2 - p.y1) * t });
	}
	return pts;
}

export const pressureControlPlugin = defineExercise({
	id: 'pressure-control',
	unit: 'strokes',
	label: 'Pressure Control',
	icon: '🖊',
	description: 'Trace curves and lines with precise pressure: constant or tapered. Combines geometry and pressure mastery.',
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
		const useCurve = Math.random() < 0.5;
		const useTaper = Math.random() < 0.5;

		let params: PressureControlParams;
		if (useCurve) {
			params = randomCurveParams(canvasW, canvasH, diagonal, 30);
		} else {
			const line = randomLine(canvasW, canvasH, diagonal, 30);
			params = { ...line, isCurve: false, startPressure: 0.5, endPressure: 0.5 };
		}

		if (useTaper) {
			const taperIn = Math.random() < 0.5;
			params.startPressure = taperIn ? 0.8 : 0.1;
			params.endPressure = taperIn ? 0.1 : 0.8;
		}

		if (toWorld) {
			const p1 = toWorld(params.x1, params.y1);
			const p2 = toWorld(params.x2, params.y2);
			params.x1 = p1.x; params.y1 = p1.y;
			params.x2 = p2.x; params.y2 = p2.y;
			if (params.cp1x != null && params.cp1y != null) {
				const c1 = toWorld(params.cp1x, params.cp1y);
				params.cp1x = c1.x; params.cp1y = c1.y;
			}
			if (params.cp2x != null && params.cp2y != null) {
				const c2 = toWorld(params.cp2x, params.cp2y);
				params.cp2x = c2.x; params.cp2y = c2.y;
			}
		}

		return {
			unit: 'strokes',
			type: 'pressure-control',
			mode,
			strokeCount: 1,
			references: [{ type: 'pressure-control', params }],
			availableModes: ['guided']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as PressureControlParams;
		if (visibility === 'hidden') return;

		const color = visibility === 'full' ? GUIDE_COLOR : HINT_COLOR;
		const fillColor = color.replace(/[\d.]+\)$/, '0.25)');
		const startW = p.startPressure * MAX_RIBBON_WIDTH;
		const endW = p.endPressure * MAX_RIBBON_WIDTH;

		if (visibility === 'full') {
			const pathPoints = getPathPoints(p);
			drawTaperedRibbon(ctx, pathPoints, startW, endW, fillColor);

			if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
				ctx.beginPath();
				ctx.moveTo(p.x1, p.y1);
				ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, p.x2, p.y2);
			} else {
				ctx.beginPath();
				ctx.moveTo(p.x1, p.y1);
				ctx.lineTo(p.x2, p.y2);
			}
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
		const p = reference.params as unknown as PressureControlParams;
		const accuracy = scoreGeometricAccuracy(points, p);
		const divergent = highlightDivergent(points, p);
		const pressure = detectPressureIssues(points, p);
		const score = buildStrokeScore(accuracy, points, [...divergent, ...pressure]);
		return { ...score, metrics: { pressureMatch: scorePressureMatch(points, p) } };
	},

	computeShapeScore: pressureShapeScore,

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, _canvasW: number, _canvasH: number, _mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;

		const p = reference.params as unknown as PressureControlParams;
		const refLen = getRefArcLen(p);
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
		const p = params as unknown as PressureControlParams;
		if (p.isCurve && p.cp1x != null && p.cp1y != null && p.cp2x != null && p.cp2y != null) {
			return {
				x: (p.x1 + p.x2 + p.cp1x + p.cp2x) / 4,
				y: (p.y1 + p.y2 + p.cp1y + p.cp2y) / 4
			};
		}
		return { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as PressureControlParams;
		const xs = [p.x1, p.x2];
		const ys = [p.y1, p.y2];
		if (p.cp1x != null) xs.push(p.cp1x);
		if (p.cp1y != null) ys.push(p.cp1y);
		if (p.cp2x != null) xs.push(p.cp2x);
		if (p.cp2y != null) ys.push(p.cp2y);
		const margin = 10;
		return {
			minX: Math.min(...xs) - margin,
			minY: Math.min(...ys) - margin,
			maxX: Math.max(...xs) + margin,
			maxY: Math.max(...ys) + margin
		};
	}
});

registerExercise(pressureControlPlugin);
