import type { ExerciseConfig, ExerciseMode, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot } from './utils';

export interface MirrorParams {
	axis: 'vertical' | 'horizontal';
	axisPosition: number;
	originalPoints: { x: number; y: number }[];
	mirroredPoints: { x: number; y: number }[];
}

function reflectPoint(p: { x: number; y: number }, axis: 'vertical' | 'horizontal', pos: number): { x: number; y: number } {
	if (axis === 'vertical') return { x: 2 * pos - p.x, y: p.y };
	return { x: p.x, y: 2 * pos - p.y };
}

function generateMirrorShape(canvasW: number, canvasH: number): MirrorParams {
	const axis: 'vertical' | 'horizontal' = Math.random() < 0.7 ? 'vertical' : 'horizontal';
	const axisPosition = axis === 'vertical' ? canvasW / 2 : canvasH / 2;

	const segCount = 3 + Math.floor(Math.random() * 4); // 3-6 segments
	const minDim = Math.min(canvasW, canvasH);
	const shapeSize = minDim * (0.15 + Math.random() * 0.15);

	const originalPoints: { x: number; y: number }[] = [];

	if (axis === 'vertical') {
		// Shape on the left half
		const startX = canvasW * 0.15 + Math.random() * (canvasW * 0.2);
		const startY = canvasH * 0.25 + Math.random() * (canvasH * 0.5);
		originalPoints.push({ x: startX, y: startY });

		for (let i = 0; i < segCount; i++) {
			const prev = originalPoints[originalPoints.length - 1];
			const angle = (Math.PI * -0.5) + Math.random() * Math.PI; // mostly rightward
			const len = shapeSize * (0.3 + Math.random() * 0.5);
			const nx = Math.max(canvasW * 0.05, Math.min(axisPosition - 20, prev.x + Math.cos(angle) * len));
			const ny = Math.max(canvasH * 0.1, Math.min(canvasH * 0.9, prev.y + Math.sin(angle) * len));
			originalPoints.push({ x: nx, y: ny });
		}
	} else {
		// Shape on the top half
		const startX = canvasW * 0.2 + Math.random() * (canvasW * 0.6);
		const startY = canvasH * 0.1 + Math.random() * (canvasH * 0.2);
		originalPoints.push({ x: startX, y: startY });

		for (let i = 0; i < segCount; i++) {
			const prev = originalPoints[originalPoints.length - 1];
			const angle = Math.random() * Math.PI; // mostly downward
			const len = shapeSize * (0.3 + Math.random() * 0.5);
			const nx = Math.max(canvasW * 0.05, Math.min(canvasW * 0.95, prev.x + Math.cos(angle) * len));
			const ny = Math.max(canvasH * 0.05, Math.min(axisPosition - 20, prev.y + Math.sin(angle) * len));
			originalPoints.push({ x: nx, y: ny });
		}
	}

	const mirroredPoints = originalPoints.map(p => reflectPoint(p, axis, axisPosition));
	return { axis, axisPosition, originalPoints, mirroredPoints };
}

function pointToPolylineDist(px: number, py: number, polyline: { x: number; y: number }[]): number {
	let minDist = Infinity;
	for (let i = 0; i < polyline.length - 1; i++) {
		const d = pointToSegmentDist(px, py, {
			x1: polyline[i].x, y1: polyline[i].y,
			x2: polyline[i + 1].x, y2: polyline[i + 1].y,
		});
		if (d < minDist) minDist = d;
	}
	return minDist;
}

function scoreMirrorAccuracy(points: StrokePoint[], mirroredPts: { x: number; y: number }[]): number {
	if (points.length === 0 || mirroredPts.length < 2) return 0;
	let total = 0;
	for (const p of points) total += pointToPolylineDist(p.x, p.y, mirroredPts);
	const avg = total / points.length;
	return Math.max(0, Math.min(100, 100 - (avg / 50) * 100));
}

function highlightDivergent(points: StrokePoint[], mirroredPts: { x: number; y: number }[]): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToPolylineDist(points[j].x, points[j].y, mirroredPts);
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

export const mirrorPlugin = defineExercise({
	id: 'mirror',
	unit: 'basic-shapes',
	label: 'Mirror Drawing',
	icon: '⎸⎹',
	description: 'Draw the mirror image of a given shape — trains spatial reasoning and symmetry.',
	availableModes: ['guided', 'challenge'],
	requiredStrokes: 1,
	defaultCount: 15,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const params = generateMirrorShape(canvasW, canvasH);
		return {
			unit: 'basic-shapes',
			type: 'mirror',
			mode,
			strokeCount: 1,
			references: [{ type: 'mirror', params }],
			availableModes: ['guided', 'challenge'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as MirrorParams;

		// Draw axis line
		ctx.beginPath();
		if (p.axis === 'vertical') {
			ctx.moveTo(p.axisPosition, 0);
			ctx.lineTo(p.axisPosition, ctx.canvas.height / (window.devicePixelRatio || 1));
		} else {
			ctx.moveTo(0, p.axisPosition);
			ctx.lineTo(ctx.canvas.width / (window.devicePixelRatio || 1), p.axisPosition);
		}
		ctx.strokeStyle = 'rgba(255, 200, 80, 0.5)';
		ctx.lineWidth = 1.5;
		ctx.setLineDash([10, 6]);
		ctx.stroke();
		ctx.setLineDash([]);

		// Draw original shape (solid)
		if (p.originalPoints.length >= 2) {
			ctx.beginPath();
			ctx.moveTo(p.originalPoints[0].x, p.originalPoints[0].y);
			for (let i = 1; i < p.originalPoints.length; i++) {
				ctx.lineTo(p.originalPoints[i].x, p.originalPoints[i].y);
			}
			ctx.strokeStyle = VISIBLE_COLOR;
			ctx.lineWidth = 2.5;
			ctx.stroke();

			for (const pt of p.originalPoints) {
				drawDot(ctx, pt.x, pt.y, 3, VISIBLE_COLOR);
			}
		}

		// Draw mirrored guide based on visibility
		if (visibility === 'full') {
			if (p.mirroredPoints.length >= 2) {
				ctx.beginPath();
				ctx.moveTo(p.mirroredPoints[0].x, p.mirroredPoints[0].y);
				for (let i = 1; i < p.mirroredPoints.length; i++) {
					ctx.lineTo(p.mirroredPoints[i].x, p.mirroredPoints[i].y);
				}
				ctx.strokeStyle = GUIDE_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([6, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}

		// In challenge mode show mirrored endpoints only
		if (visibility === 'hints' && p.mirroredPoints.length >= 2) {
			drawDot(ctx, p.mirroredPoints[0].x, p.mirroredPoints[0].y, 4, HINT_COLOR);
			drawDot(ctx, p.mirroredPoints[p.mirroredPoints.length - 1].x, p.mirroredPoints[p.mirroredPoints.length - 1].y, 4, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as MirrorParams;
		const extra = highlightDivergent(points, p.mirroredPoints);
		const start = p.mirroredPoints[0];
		const end = p.mirroredPoints[p.mirroredPoints.length - 1];
		return buildMetricScore(points, {
			pathDeviation: scoreMirrorAccuracy(points, p.mirroredPoints),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start, end },
			extraSegments: extra,
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const p = reference.params as unknown as MirrorParams;

		// Should be on the mirrored side of the axis
		const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
		const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
		const origCx = p.originalPoints.reduce((s, pt) => s + pt.x, 0) / p.originalPoints.length;
		const origCy = p.originalPoints.reduce((s, pt) => s + pt.y, 0) / p.originalPoints.length;

		if (p.axis === 'vertical') {
			return (cx > p.axisPosition) !== (origCx > p.axisPosition) || Math.abs(cx - p.axisPosition) < 20;
		}
		return (cy > p.axisPosition) !== (origCy > p.axisPosition) || Math.abs(cy - p.axisPosition) < 20;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as MirrorParams;
		const all = [...p.originalPoints, ...p.mirroredPoints];
		return {
			x: all.reduce((s, pt) => s + pt.x, 0) / all.length,
			y: all.reduce((s, pt) => s + pt.y, 0) / all.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as MirrorParams;
		const all = [...p.originalPoints, ...p.mirroredPoints];
		const xs = all.map(pt => pt.x);
		const ys = all.map(pt => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

const VISIBLE_COLOR = 'rgba(180, 220, 255, 0.8)';

registerExercise(mirrorPlugin);
