import type { StrokePoint } from '$lib/input/stroke';
import type { PerspectiveBoxParams, LineParams, ReferenceShape } from '$lib/exercises/types';
import { pointToSegmentDist } from './accuracy';

/**
 * Score a user stroke against all perspective boxes in the exercise.
 * Matches the stroke to the closest expected edge across all boxes,
 * then scores with VP convergence weighting for depth edges.
 */
export function scorePerspectiveStroke(
	points: StrokePoint[],
	boxes: PerspectiveBoxParams[]
): number {
	if (points.length < 2 || boxes.length === 0) return 0;

	const allEdges: { edge: LineParams; isDepth: boolean; vp: { x: number; y: number } }[] = [];
	for (const box of boxes) {
		for (let i = 0; i < box.expectedEdges.length; i++) {
			// Depth edges are indices 2–4 (the three convergence edges from front corners)
			allEdges.push({
				edge: box.expectedEdges[i],
				isDepth: i >= 2 && i <= 4,
				vp: box.vanishingPoint
			});
		}
	}

	if (allEdges.length === 0) return 0;

	const matched = matchStrokeToEdge(points, allEdges.map((e) => e.edge));
	const info = allEdges[matched.index];

	if (info.isDepth) {
		return scoreDepthEdge(points, info.edge, info.vp);
	}
	return scoreEdgeAccuracy(points, info.edge);
}

/** Legacy single-box overload for backward compat */
export function scorePerspectiveStrokeSingle(
	points: StrokePoint[],
	boxParams: PerspectiveBoxParams,
	_strokeIndex: number
): number {
	return scorePerspectiveStroke(points, [boxParams]);
}

/** Collect all PerspectiveBoxParams from an exercise's references */
export function extractBoxParams(references: ReferenceShape[]): PerspectiveBoxParams[] {
	return references
		.filter((r) => r.type === '1-point-box')
		.map((r) => r.params as PerspectiveBoxParams);
}

function matchStrokeToEdge(
	points: StrokePoint[],
	expectedEdges: LineParams[]
): { edge: LineParams; index: number } {
	const strokeMid = {
		x: (points[0].x + points[points.length - 1].x) / 2,
		y: (points[0].y + points[points.length - 1].y) / 2
	};

	let bestIndex = 0;
	let bestDist = Infinity;

	for (let i = 0; i < expectedEdges.length; i++) {
		const edge = expectedEdges[i];
		const edgeMid = { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 };
		const dist = Math.sqrt((strokeMid.x - edgeMid.x) ** 2 + (strokeMid.y - edgeMid.y) ** 2);
		if (dist < bestDist) {
			bestDist = dist;
			bestIndex = i;
		}
	}

	return { edge: expectedEdges[bestIndex], index: bestIndex };
}

function scoreDepthEdge(
	points: StrokePoint[],
	expectedEdge: LineParams,
	vp: { x: number; y: number }
): number {
	const start = points[0];
	const end = points[points.length - 1];

	const strokeAngle = Math.atan2(end.y - start.y, end.x - start.x);
	const vpAngle = Math.atan2(vp.y - start.y, vp.x - start.x);

	let angleDiff = Math.abs(strokeAngle - vpAngle);
	if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

	const angleScore = Math.max(0, 100 - (angleDiff / (Math.PI / 6)) * 100);
	const posScore = scoreEdgeAccuracy(points, expectedEdge);

	return angleScore * 0.6 + posScore * 0.4;
}

function scoreEdgeAccuracy(points: StrokePoint[], edge: LineParams): number {
	let totalDist = 0;
	for (const p of points) {
		totalDist += pointToSegmentDist(p.x, p.y, edge);
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
}
