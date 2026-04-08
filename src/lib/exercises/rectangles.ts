import type { ExerciseConfig, ExerciseMode, LineParams, QuadParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { quadEdges, quadDiagonals } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import {
	defineExercise,
	buildMetricScore,
	getStrokePoints,
	strokeChord,
	strokeArcLen,
	angleDiff,
	type CoordTransform,
} from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, scoreLineAccuracy } from './utils';

const TOTAL_LINES = 6; // 4 edges + 2 diagonals

function allQuadLines(q: QuadParams): LineParams[] {
	return [...quadEdges(q), ...quadDiagonals(q)];
}

function quadCenter(q: QuadParams): { x: number; y: number } {
	const c = q.corners;
	return {
		x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4,
		y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4,
	};
}

/** Cross product of vectors (b-a) and (c-b). Positive = CCW turn. */
function cross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
	return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

function isConvex(corners: { x: number; y: number }[]): boolean {
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const cp = cross(corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]);
		if (cp === 0) continue;
		if (sign === 0) sign = cp > 0 ? 1 : -1;
		else if ((cp > 0 ? 1 : -1) !== sign) return false;
	}
	return sign !== 0;
}

/**
 * Generate a convex quad by starting from a rectangle and jittering each
 * corner independently. Retries with reduced jitter if the result isn't convex.
 */
function generateConvexQuad(cx: number, cy: number, w: number, h: number, rotation: number): QuadParams {
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const hw = w / 2;
	const hh = h / 2;

	const baseCorners = [
		{ lx: -hw, ly: -hh },
		{ lx: hw, ly: -hh },
		{ lx: hw, ly: hh },
		{ lx: -hw, ly: hh },
	];

	const minDim = Math.min(w, h);

	for (let attempt = 0; attempt < 10; attempt++) {
		const jitter = minDim * 0.25 * Math.pow(0.7, attempt);
		const corners = baseCorners.map(({ lx, ly }) => {
			const jx = lx + (Math.random() - 0.5) * 2 * jitter;
			const jy = ly + (Math.random() - 0.5) * 2 * jitter;
			return {
				x: cx + cos * jx - sin * jy,
				y: cy + sin * jx + cos * jy,
			};
		}) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];

		if (isConvex(corners)) return { corners };
	}

	// Fallback: no jitter (perfect rectangle)
	const corners = baseCorners.map(({ lx, ly }) => ({
		x: cx + cos * lx - sin * ly,
		y: cy + sin * lx + cos * ly,
	})) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];

	return { corners };
}

/** Assign `n` strokes to `n` distinct lines (indices 0–5). `n` must be ≤ 6. */
function injectiveLineAssignments(n: number): number[][] {
	const out: number[][] = [];
	function dfs(cur: number[]) {
		if (cur.length === n) {
			out.push([...cur]);
			return;
		}
		for (let e = 0; e < TOTAL_LINES; e++) {
			if (cur.includes(e)) continue;
			cur.push(e);
			dfs(cur);
			cur.pop();
		}
	}
	dfs([]);
	return out;
}

function scoreStrokeToLine(points: StrokePoint[], line: LineParams): StrokeScore {
	return buildMetricScore(points, {
		pathDeviation: scoreLineAccuracy(points, line),
		smoothness: true,
		speedConsistency: true,
		endpointAccuracy: { start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 } },
	});
}

function bestSingleLineScore(points: StrokePoint[], lines: LineParams[]): StrokeScore {
	let best = scoreStrokeToLine(points, lines[0]);
	for (let i = 1; i < lines.length; i++) {
		const sc = scoreStrokeToLine(points, lines[i]);
		if (sc.composite > best.composite) best = sc;
	}
	return best;
}

export const rectanglePlugin = defineExercise({
	id: 'rectangle',
	unit: 'basic-shapes',
	label: 'Quads',
	icon: '◇',
	description: 'Draw quadrilaterals with their diagonals — 4 edges plus 2 crossing lines.',
	availableModes: ['tracing', 'challenge', 'memory', 'free'],
	requiredStrokes: TOTAL_LINES,
	defaultCount: 15,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const minDim = Math.min(canvasW, canvasH);
		const w = minDim * (0.1 + Math.random() * 0.18);
		const ratio = 0.45 + Math.random() * 0.45;
		const h = w * ratio;
		const rotation = Math.random() * Math.PI * 0.3;

		const maxDim = Math.max(w, h);
		const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxDim, h: maxDim }), 30, 18);
		const slot = slots[0];
		const center = toWorld
			? toWorld(slot.x + slot.w / 2, slot.y + slot.h / 2)
			: { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };

		const params = generateConvexQuad(center.x, center.y, w, h, rotation);

		return {
			unit: 'basic-shapes',
			type: 'rectangle',
			mode,
			strokeCount: TOTAL_LINES,
			references: [{ type: 'rectangle', params }],
			availableModes: ['tracing', 'challenge', 'memory', 'free'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const q = params as unknown as QuadParams;
		if (visibility === 'hidden') return;

		const c = q.corners;

		if (visibility === 'full') {
			ctx.save();
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);

			ctx.beginPath();
			ctx.moveTo(c[0].x, c[0].y);
			for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
			ctx.closePath();
			ctx.stroke();

			ctx.beginPath();
			ctx.moveTo(c[0].x, c[0].y);
			ctx.lineTo(c[2].x, c[2].y);
			ctx.moveTo(c[1].x, c[1].y);
			ctx.lineTo(c[3].x, c[3].y);
			ctx.stroke();

			ctx.setLineDash([]);
			ctx.restore();
		} else {
			for (const corner of c) drawDot(ctx, corner.x, corner.y, 5, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, _strokeIndex: number, mode: ExerciseMode): StrokeScore {
		if (mode === 'free') {
			return buildMetricScore(points, {
				pathDeviation: null,
				smoothness: true,
				speedConsistency: true,
			});
		}

		const q = reference.params as unknown as QuadParams;
		const lines = allQuadLines(q);
		return bestSingleLineScore(points, lines);
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

		const q = reference.params as unknown as QuadParams;
		const lines = allQuadLines(q);
		const n = Math.min(strokes.length, TOTAL_LINES);
		if (n === 0) return [];

		const assignments = injectiveLineAssignments(n);
		let bestScores: StrokeScore[] | null = null;
		let bestSum = -Infinity;
		for (const assign of assignments) {
			let sum = 0;
			const scores: StrokeScore[] = [];
			for (let i = 0; i < n; i++) {
				const pts = getStrokePoints(strokes[i]);
				const line = lines[assign[i]];
				const sc = scoreStrokeToLine(pts, line);
				scores.push(sc);
				sum += sc.composite;
			}
			if (sum > bestSum) {
				bestSum = sum;
				bestScores = scores;
			}
		}

		const head = bestScores!;
		if (strokes.length <= TOTAL_LINES) return head;

		const tail: StrokeScore[] = [];
		for (let i = TOTAL_LINES; i < strokes.length; i++) {
			const pts = getStrokePoints(strokes[i]);
			tail.push(bestSingleLineScore(pts, lines));
		}
		return [...head, ...tail];
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		canvasW: number,
		_canvasH: number,
		mode: ExerciseMode,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);

		if (mode === 'free') {
			if (chord < canvasW * 0.05) return false;
			const arc = strokeArcLen(pts);
			return arc > 0 && chord / arc > 0.65;
		}

		const q = reference.params as unknown as QuadParams;
		const lines = allQuadLines(q);
		const s = pts[0];
		const e = pts[pts.length - 1];
		const strokeAngle = Math.atan2(e.y - s.y, e.x - s.x);

		for (const line of lines) {
			const el = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
			if (el < 1) continue;

			const d1 = Math.sqrt((s.x - line.x1) ** 2 + (s.y - line.y1) ** 2);
			const d2 = Math.sqrt((s.x - line.x2) ** 2 + (s.y - line.y2) ** 2);
			const threshold = Math.max(el * 0.5, 40);
			if (d1 > threshold && d2 > threshold) continue;

			const lineAngle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
			const ad = Math.min(angleDiff(strokeAngle, lineAngle), angleDiff(strokeAngle, lineAngle + Math.PI));
			if (ad > Math.PI / 4) continue;

			if (chord >= el * 0.25) return true;
		}
		return false;
	},

	getCenter(params: Record<string, unknown>) {
		return quadCenter(params as unknown as QuadParams);
	},

	getBounds(params: Record<string, unknown>) {
		const q = params as unknown as QuadParams;
		const xs = q.corners.map((c) => c.x);
		const ys = q.corners.map((c) => c.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

registerExercise(rectanglePlugin);
