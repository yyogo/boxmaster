import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { defineExercise, buildStrokeScore, getStrokePoints, strokeChord, strokeArcLen, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';

const GUIDE_COLOR = 'rgba(100, 160, 255, 0.6)';
const HINT_COLOR = 'rgba(100, 160, 255, 0.5)';

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

// --- Generation ---

function randomLine(canvasW: number, canvasH: number, diagonal: number, margin: number): LineParams {
	const targetLen = diagonal * (0.15 + Math.random() * 0.85);
	const angle = Math.random() * Math.PI * 2;

	const halfDx = (Math.cos(angle) * targetLen) / 2;
	const halfDy = (Math.sin(angle) * targetLen) / 2;

	const cxMin = margin + Math.max(0, halfDx, -halfDx);
	const cxMax = canvasW - margin - Math.max(0, halfDx, -halfDx);
	const cyMin = margin + Math.max(0, halfDy, -halfDy);
	const cyMax = canvasH - margin - Math.max(0, halfDy, -halfDy);

	if (cxMin < cxMax && cyMin < cyMax) {
		const cx = cxMin + Math.random() * (cxMax - cxMin);
		const cy = cyMin + Math.random() * (cyMax - cyMin);
		return { x1: cx - halfDx, y1: cy - halfDy, x2: cx + halfDx, y2: cy + halfDy };
	}

	const x1 = margin + Math.random() * (canvasW - 2 * margin);
	const y1 = margin + Math.random() * (canvasH - 2 * margin);
	const x2 = margin + Math.random() * (canvasW - 2 * margin);
	const y2 = margin + Math.random() * (canvasH - 2 * margin);
	return { x1, y1, x2, y2 };
}

// --- Scoring ---

function scoreLineAccuracy(points: StrokePoint[], line: LineParams): number {
	const len = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
	if (len === 0) return 0;
	let totalDist = 0;
	for (const p of points) totalDist += pointToSegmentDist(p.x, p.y, line);
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
}

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

function highlightDivergent(points: StrokePoint[], line: LineParams): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToSegmentDist(points[j].x, points[j].y, line);
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

// --- Plugin ---

export const linePlugin = defineExercise({
	id: 'line',
	unit: 'basic-shapes',
	label: 'Lines',
	icon: '╱',
	description: 'Draw straight lines between two points. Focus on confident, smooth strokes.',
	availableModes: ['guided', 'semi-guided', 'free'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const diagonal = Math.sqrt(canvasW * canvasW + canvasH * canvasH);
		const raw = randomLine(canvasW, canvasH, diagonal, 30);
		const p1 = toWorld ? toWorld(raw.x1, raw.y1) : { x: raw.x1, y: raw.y1 };
		const p2 = toWorld ? toWorld(raw.x2, raw.y2) : { x: raw.x2, y: raw.y2 };
		const params: LineParams = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
		return {
			unit: 'basic-shapes',
			type: 'line',
			mode,
			strokeCount: 1,
			references: [{ type: 'line', params }],
			availableModes: ['guided', 'semi-guided', 'free']
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
			return buildStrokeScore(scoreFreeLine(points), points);
		}
		const accuracy = scoreLineAccuracy(points, p);
		const extra = highlightDivergent(points, p);
		return buildStrokeScore(accuracy, points, extra);
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number, canvasH: number, mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		if (mode === 'free') {
			// Must be long enough (5% of viewport width) and reasonably straight
			if (chord < canvasW * 0.05) return false;
			const arc = strokeArcLen(pts);
			return arc > 0 && chord / arc > 0.65;
		}

		const p = reference.params as unknown as LineParams;
		const refLen = Math.sqrt((p.x2 - p.x1) ** 2 + (p.y2 - p.y1) ** 2);
		if (refLen < 1) return true;

		// Start should be near either endpoint
		const s = pts[0];
		const distToP1 = Math.sqrt((s.x - p.x1) ** 2 + (s.y - p.y1) ** 2);
		const distToP2 = Math.sqrt((s.x - p.x2) ** 2 + (s.y - p.y2) ** 2);
		const endpointThreshold = Math.max(refLen * 0.4, 40);
		if (distToP1 > endpointThreshold && distToP2 > endpointThreshold) return false;

		// Direction within 45° of reference (either direction)
		const e = pts[pts.length - 1];
		const strokeAngle = Math.atan2(e.y - s.y, e.x - s.x);
		const refAngle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
		const ad = Math.min(angleDiff(strokeAngle, refAngle), angleDiff(strokeAngle, refAngle + Math.PI));
		if (ad > Math.PI / 4) return false;

		// Length at least 25% of reference
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
