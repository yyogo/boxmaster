import type { ExerciseConfig, ExerciseMode, LineParams, RectParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { rectEdges, rectCorners } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, strokeArcLen, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, scoreLineAccuracy } from './utils';

function scoreFreeRect(strokes: Stroke[]): number {
	if (strokes.length < 4) return 0;
	const edges = strokes.slice(0, 4).map((s) => {
		const pts = s.smoothedPoints.length > 0 ? s.smoothedPoints : s.rawPoints;
		const start = pts[0];
		const end = pts[pts.length - 1];
		return { dx: end.x - start.x, dy: end.y - start.y };
	});

	let perpTotal = 0;
	for (let i = 0; i < 4; i++) {
		const a = edges[i];
		const b = edges[(i + 1) % 4];
		const magA = Math.sqrt(a.dx ** 2 + a.dy ** 2);
		const magB = Math.sqrt(b.dx ** 2 + b.dy ** 2);
		if (magA > 0 && magB > 0) perpTotal += 1 - Math.abs((a.dx * b.dx + a.dy * b.dy) / (magA * magB));
	}
	const perpendicularity = Math.max(0, Math.min(100, (perpTotal / 4) * 100));

	let paraTotal = 0;
	for (let i = 0; i < 2; i++) {
		const a = edges[i];
		const b = edges[i + 2];
		const magA = Math.sqrt(a.dx ** 2 + a.dy ** 2);
		const magB = Math.sqrt(b.dx ** 2 + b.dy ** 2);
		if (magA > 0 && magB > 0) paraTotal += Math.abs((a.dx * b.dx + a.dy * b.dy) / (magA * magB));
	}
	const parallelism = Math.max(0, Math.min(100, (paraTotal / 2) * 100));

	let straightTotal = 0;
	for (const s of strokes.slice(0, 4)) {
		const pts = s.smoothedPoints.length > 0 ? s.smoothedPoints : s.rawPoints;
		if (pts.length < 2) continue;
		const start = pts[0];
		const end = pts[pts.length - 1];
		let arcLen = 0;
		for (let i = 1; i < pts.length; i++) {
			arcLen += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2);
		}
		const chord = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
		straightTotal += chord < 5 ? 0 : Math.max(0, Math.min(100, (chord / arcLen) * 100));
	}

	return straightTotal / 4 * 0.4 + perpendicularity * 0.3 + parallelism * 0.3;
}

/** Assign `n` strokes to `n` distinct edges (indices 0–3). `n` must be ≤ 4. */
function injectiveEdgeAssignments(n: number): number[][] {
	const out: number[][] = [];
	function dfs(cur: number[]) {
		if (cur.length === n) {
			out.push([...cur]);
			return;
		}
		for (let e = 0; e < 4; e++) {
			if (cur.includes(e)) continue;
			cur.push(e);
			dfs(cur);
			cur.pop();
		}
	}
	dfs([]);
	return out;
}

function scoreRectStrokeToEdge(points: StrokePoint[], edge: LineParams): StrokeScore {
	return buildMetricScore(points, {
		pathDeviation: scoreLineAccuracy(points, edge),
		smoothness: true,
		speedConsistency: true,
		endpointAccuracy: { start: { x: edge.x1, y: edge.y1 }, end: { x: edge.x2, y: edge.y2 } },
	});
}

function bestSingleEdgeScore(points: StrokePoint[], edges: LineParams[]): StrokeScore {
	let best = scoreRectStrokeToEdge(points, edges[0]);
	for (let i = 1; i < edges.length; i++) {
		const sc = scoreRectStrokeToEdge(points, edges[i]);
		if (sc.composite > best.composite) best = sc;
	}
	return best;
}

export const rectanglePlugin = defineExercise({
	id: 'rectangle',
	unit: 'basic-shapes',
	label: 'Rectangles',
	icon: '▭',
	description: 'Draw rectangles with straight edges and square corners.',
	availableModes: ['tracing', 'challenge', 'free'],
	requiredStrokes: 4,
	defaultCount: 15,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const minDim = Math.min(canvasW, canvasH);
		const w = minDim * (0.10 + Math.random() * 0.18);
		const ratio = 0.45 + Math.random() * 0.45;
		const h = w * ratio;
		const rotation = Math.random() * Math.PI * 0.3;

		const maxDim = Math.max(w, h);
		const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxDim, h: maxDim }), 30, 18);
		const slot = slots[0];
		const center = toWorld
			? toWorld(slot.x + slot.w / 2, slot.y + slot.h / 2)
			: { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
		const params: RectParams = { cx: center.x, cy: center.y, w, h, rotation };

		return {
			unit: 'basic-shapes',
			type: 'rectangle',
			mode,
			strokeCount: 4,
			references: [{ type: 'rectangle', params }],
			availableModes: ['tracing', 'challenge', 'free']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as RectParams;
		if (visibility === 'hidden') return;

		if (visibility === 'full') {
			ctx.save();
			ctx.translate(p.cx, p.cy);
			ctx.rotate(p.rotation);
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
			ctx.setLineDash([]);
			ctx.restore();
		} else {
			const corners = rectCorners(p);
			for (const c of corners) drawDot(ctx, c.x, c.y, 5, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, _strokeIndex: number, mode: ExerciseMode): StrokeScore {
		const p = reference.params as unknown as RectParams;

		if (mode === 'free') {
			return buildMetricScore(points, {
				pathDeviation: null,
				smoothness: true,
				speedConsistency: true,
			});
		}

		const edges = rectEdges(p);
		return bestSingleEdgeScore(points, edges);
	},

	scoreStrokesForRound(strokes: Stroke[], reference: ReferenceShape, mode: ExerciseMode): StrokeScore[] {
		if (mode === 'free') {
			return strokes.map((s) => {
				const pts = getStrokePoints(s);
				return buildMetricScore(pts, {
					pathDeviation: null,
					smoothness: true,
					speedConsistency: true,
				});
			});
		}

		const p = reference.params as unknown as RectParams;
		const edges = rectEdges(p);
		const n = Math.min(strokes.length, 4);
		if (n === 0) return [];

		const assignments = injectiveEdgeAssignments(n);
		let bestScores: StrokeScore[] | null = null;
		let bestSum = -Infinity;
		for (const assign of assignments) {
			let sum = 0;
			const scores: StrokeScore[] = [];
			for (let i = 0; i < n; i++) {
				const pts = getStrokePoints(strokes[i]);
				const edge = edges[assign[i]];
				const sc = scoreRectStrokeToEdge(pts, edge);
				scores.push(sc);
				sum += sc.composite;
			}
			if (sum > bestSum) {
				bestSum = sum;
				bestScores = scores;
			}
		}

		const head = bestScores!;
		if (strokes.length <= 4) return head;

		const tail: StrokeScore[] = [];
		for (let i = 4; i < strokes.length; i++) {
			const pts = getStrokePoints(strokes[i]);
			tail.push(bestSingleEdgeScore(pts, edges));
		}
		return [...head, ...tail];
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number, _canvasH: number, mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		if (mode === 'free') {
			if (chord < canvasW * 0.05) return false;
			const arc = strokeArcLen(pts);
			return arc > 0 && chord / arc > 0.65;
		}

		const p = reference.params as unknown as RectParams;
		const edges = rectEdges(p);
		const s = pts[0];
		const e = pts[pts.length - 1];
		const strokeAngle = Math.atan2(e.y - s.y, e.x - s.x);

		// Accept if stroke is compatible with ANY edge
		for (const edge of edges) {
			const el = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
			if (el < 1) continue;

			// Start should be near either endpoint of the edge
			const d1 = Math.sqrt((s.x - edge.x1) ** 2 + (s.y - edge.y1) ** 2);
			const d2 = Math.sqrt((s.x - edge.x2) ** 2 + (s.y - edge.y2) ** 2);
			const threshold = Math.max(el * 0.5, 40);
			if (d1 > threshold && d2 > threshold) continue;

			// Direction within 45° of edge (either way)
			const edgeAngle = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1);
			const ad = Math.min(angleDiff(strokeAngle, edgeAngle), angleDiff(strokeAngle, edgeAngle + Math.PI));
			if (ad > Math.PI / 4) continue;

			// Length at least 25% of edge
			if (chord >= el * 0.25) return true;
		}
		return false;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as RectParams;
		return { x: p.cx, y: p.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as RectParams;
		const corners = rectCorners(p);
		const xs = corners.map((c) => c.x);
		const ys = corners.map((c) => c.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10
		};
	}
});

// Expose scoreFreeRect for use by the exercise page's special free-mode handling
export { scoreFreeRect };

registerExercise(rectanglePlugin);
