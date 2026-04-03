import type {
	ExerciseConfig,
	ExerciseMode,
	LineParams,
	ThreePointBoxParams,
	ReferenceShape,
} from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import {
	defineExercise,
	buildMetricScore,
	getStrokePoints,
	strokeChord,
} from './plugin';
import { registerExercise } from './registry';
import { drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

type Pt = { x: number; y: number };
type TaggedEdge = LineParams & { vpIndex: 0 | 1 | 2 };

const VP_COLORS = [
	'rgba(255, 120, 80, 0.9)',
	'rgba(80, 200, 255, 0.9)',
	'rgba(160, 255, 80, 0.9)',
];
const VP_EXT_COLORS = [
	'rgba(255, 120, 80, 0.4)',
	'rgba(80, 200, 255, 0.4)',
	'rgba(160, 255, 80, 0.4)',
];
const GIVEN_EDGE_COLOR = 'rgba(180, 220, 255, 0.8)';
const GUIDE_COLOR_FAINT = 'rgba(130, 185, 255, 0.35)';
const EXTENSION_LEN = 5000;

// --- Geometry helpers ---

function drawCrosshair(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	color: string,
) {
	ctx.beginPath();
	ctx.moveTo(x - size, y);
	ctx.lineTo(x + size, y);
	ctx.moveTo(x, y - size);
	ctx.lineTo(x, y + size);
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.stroke();
}

function lineLineIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
	const d1x = p2.x - p1.x;
	const d1y = p2.y - p1.y;
	const d2x = p4.x - p3.x;
	const d2y = p4.y - p3.y;
	const denom = d1x * d2y - d1y * d2x;
	if (Math.abs(denom) < 1e-10) return null;
	const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
	return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

function rayCanvasExtent(
	origin: Pt,
	dx: number,
	dy: number,
	canvasW: number,
	canvasH: number,
): number {
	let tMax = Infinity;
	if (dx > 1e-9) tMax = Math.min(tMax, (canvasW - origin.x) / dx);
	else if (dx < -1e-9) tMax = Math.min(tMax, -origin.x / dx);
	if (dy > 1e-9) tMax = Math.min(tMax, (canvasH - origin.y) / dy);
	else if (dy < -1e-9) tMax = Math.min(tMax, -origin.y / dy);
	return Math.max(0, tMax);
}

function buildExpectedEdges(
	c1: Pt,
	c2: Pt,
	c3: Pt,
	c4: Pt,
	c5: Pt,
	c6: Pt,
	c7: Pt,
): TaggedEdge[] {
	return [
		// VP 0 group (parallel to C0→C1)
		{ x1: c2.x, y1: c2.y, x2: c4.x, y2: c4.y, vpIndex: 0 },
		{ x1: c3.x, y1: c3.y, x2: c5.x, y2: c5.y, vpIndex: 0 },
		{ x1: c6.x, y1: c6.y, x2: c7.x, y2: c7.y, vpIndex: 0 },
		// VP 1 group (parallel to C0→C2)
		{ x1: c1.x, y1: c1.y, x2: c4.x, y2: c4.y, vpIndex: 1 },
		{ x1: c3.x, y1: c3.y, x2: c6.x, y2: c6.y, vpIndex: 1 },
		{ x1: c5.x, y1: c5.y, x2: c7.x, y2: c7.y, vpIndex: 1 },
		// VP 2 group (parallel to C0→C3)
		{ x1: c1.x, y1: c1.y, x2: c5.x, y2: c5.y, vpIndex: 2 },
		{ x1: c2.x, y1: c2.y, x2: c6.x, y2: c6.y, vpIndex: 2 },
		{ x1: c4.x, y1: c4.y, x2: c7.x, y2: c7.y, vpIndex: 2 },
	];
}

function computeBoxVertices(
	endpoints: Pt[],
	vps: [Pt, Pt, Pt],
): { c4: Pt; c5: Pt; c6: Pt; c7: Pt } | null {
	const [c1, c2, c3] = endpoints;
	const c4 = lineLineIntersect(c1, vps[1], c2, vps[0]);
	const c5 = lineLineIntersect(c1, vps[2], c3, vps[0]);
	const c6 = lineLineIntersect(c2, vps[2], c3, vps[1]);
	if (!c4 || !c5 || !c6) return null;
	const c7 = lineLineIntersect(c4, vps[2], c5, vps[1]);
	if (!c7) return null;
	return { c4, c5, c6, c7 };
}

// --- Generation ---

function generate3PtBox(
	canvasW: number,
	canvasH: number,
): ThreePointBoxParams | null {
	const minDim = Math.min(canvasW, canvasH);
	const margin = minDim * 0.15;

	const c0: Pt = {
		x: margin + Math.random() * (canvasW - 2 * margin),
		y: margin + Math.random() * (canvasH - 2 * margin),
	};

	// Simplex sampling: 3 angular gaps each >= π/2, summing to 2π
	const u1 = Math.random() * (Math.PI / 2);
	const u2 = Math.random() * (Math.PI / 2);
	const lo = Math.min(u1, u2);
	const hi = Math.max(u1, u2);
	const gaps = [
		lo + Math.PI / 2,
		hi - lo + Math.PI / 2,
		Math.PI / 2 - hi + Math.PI / 2,
	];

	const theta0 = Math.random() * Math.PI * 2;
	const thetas = [theta0, theta0 + gaps[0], theta0 + gaps[0] + gaps[1]];

	const arms: { endpoint: Pt; vp: Pt }[] = [];
	for (let i = 0; i < 3; i++) {
		const dx = Math.cos(thetas[i]);
		const dy = Math.sin(thetas[i]);
		const maxExt = rayCanvasExtent(c0, dx, dy, canvasW, canvasH);
		if (maxExt < minDim * 0.15) return null;

		const vpDist = maxExt * (0.5 + Math.random() * 0.4);
		const armLen = vpDist * (0.25 + Math.random() * 0.2);
		if (armLen < minDim * 0.06) return null;

		arms.push({
			endpoint: { x: c0.x + dx * armLen, y: c0.y + dy * armLen },
			vp: { x: c0.x + dx * vpDist, y: c0.y + dy * vpDist },
		});
	}

	const endpoints = arms.map((a) => a.endpoint);
	const vps: [Pt, Pt, Pt] = [arms[0].vp, arms[1].vp, arms[2].vp];

	const verts = computeBoxVertices(endpoints, vps);
	if (!verts) return null;
	const { c4, c5, c6, c7 } = verts;

	for (const pt of [c4, c5, c6, c7]) {
		if (
			pt.x < -canvasW * 0.3 ||
			pt.x > canvasW * 1.3 ||
			pt.y < -canvasH * 0.3 ||
			pt.y > canvasH * 1.3
		)
			return null;
	}

	const expectedEdges = buildExpectedEdges(
		endpoints[0],
		endpoints[1],
		endpoints[2],
		c4,
		c5,
		c6,
		c7,
	);

	const minEdgeLen = minDim * 0.03;
	for (const e of expectedEdges) {
		if (
			Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2) < minEdgeLen
		)
			return null;
	}

	return {
		vps,
		yCorner: c0,
		yEdges: [
			{ x1: c0.x, y1: c0.y, x2: endpoints[0].x, y2: endpoints[0].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[1].x, y2: endpoints[1].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[2].x, y2: endpoints[2].y },
		],
		expectedEdges,
	};
}

function generateFallbackBox(
	canvasW: number,
	canvasH: number,
): ThreePointBoxParams {
	const cx = canvasW / 2;
	const cy = canvasH / 2;
	const minDim = Math.min(canvasW, canvasH);
	const armLen = minDim * 0.15;
	const vpDist = minDim * 0.45;

	const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
	const c0: Pt = { x: cx, y: cy };
	const endpoints = angles.map((a) => ({
		x: cx + Math.cos(a) * armLen,
		y: cy + Math.sin(a) * armLen,
	}));
	const vps = angles.map((a) => ({
		x: cx + Math.cos(a) * vpDist,
		y: cy + Math.sin(a) * vpDist,
	})) as [Pt, Pt, Pt];

	const { c4, c5, c6, c7 } = computeBoxVertices(endpoints, vps)!;

	return {
		vps,
		yCorner: c0,
		yEdges: [
			{ x1: c0.x, y1: c0.y, x2: endpoints[0].x, y2: endpoints[0].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[1].x, y2: endpoints[1].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[2].x, y2: endpoints[2].y },
		],
		expectedEdges: buildExpectedEdges(
			endpoints[0],
			endpoints[1],
			endpoints[2],
			c4,
			c5,
			c6,
			c7,
		),
	};
}

// --- Stroke matching ---

function matchStrokeToEdge(
	pts: { x: number; y: number }[],
	edges: TaggedEdge[],
): TaggedEdge | null {
	if (pts.length < 2 || edges.length === 0) return null;
	const mid = {
		x: (pts[0].x + pts[pts.length - 1].x) / 2,
		y: (pts[0].y + pts[pts.length - 1].y) / 2,
	};
	let best: TaggedEdge = edges[0];
	let bestDist = Infinity;
	for (const e of edges) {
		const eMid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
		const d = (mid.x - eMid.x) ** 2 + (mid.y - eMid.y) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = e;
		}
	}
	return best;
}

// --- Plugin ---

export const freeBoxesPlugin = defineExercise({
	id: 'free-boxes',
	unit: 'perspective',
	label: 'Free Boxes',
	icon: '⬙',
	description:
		'Draw complete boxes in 3-point perspective. All three vanishing points are on-canvas for rapid convergence practice.',
	availableModes: ['tracing', 'challenge'] as ExerciseMode[],
	requiredStrokes: 9,
	defaultCount: 10,
	manualCompletion: true,
	instructions:
		'Draw all 9 remaining edges of the box — each must converge toward one of the 3 vanishing points. Press Done to check your convergence.',

	generate(
		mode: ExerciseMode,
		canvasW: number,
		canvasH: number,
	): ExerciseConfig {
		let params: ThreePointBoxParams | null = null;
		for (let attempt = 0; attempt < 80; attempt++) {
			params = generate3PtBox(canvasW, canvasH);
			if (params) break;
		}
		if (!params) params = generateFallbackBox(canvasW, canvasH);

		return {
			unit: 'perspective',
			type: 'free-boxes',
			mode,
			strokeCount: 9,
			references: [{ type: 'free-boxes', params }],
			availableModes: ['tracing', 'challenge'],
		};
	},

	renderScaffold(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
	) {
		const p = params as unknown as ThreePointBoxParams;
		for (let i = 0; i < 3; i++) {
			drawDot(ctx, p.vps[i].x, p.vps[i].y, 6, VP_COLORS[i]);
			drawCrosshair(ctx, p.vps[i].x, p.vps[i].y, 10, VP_COLORS[i]);
		}
	},

	renderGuide(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
		visibility: GuideVisibility,
	) {
		const p = params as unknown as ThreePointBoxParams;

		for (const edge of p.yEdges) {
			ctx.beginPath();
			ctx.moveTo(edge.x1, edge.y1);
			ctx.lineTo(edge.x2, edge.y2);
			ctx.strokeStyle = GIVEN_EDGE_COLOR;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}
		drawDot(ctx, p.yCorner.x, p.yCorner.y, 4, GIVEN_EDGE_COLOR);
		for (const edge of p.yEdges) {
			drawDot(ctx, edge.x2, edge.y2, 3, GIVEN_EDGE_COLOR);
		}

		if (visibility === 'full') {
			for (const edge of p.expectedEdges) {
				ctx.beginPath();
				ctx.moveTo(edge.x1, edge.y1);
				ctx.lineTo(edge.x2, edge.y2);
				ctx.strokeStyle = GUIDE_COLOR_FAINT;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([6, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	},

	renderReview(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
		strokes: Stroke[],
	) {
		const p = params as unknown as ThreePointBoxParams;

		for (const stroke of strokes) {
			const pts = getStrokePoints(stroke);
			if (pts.length < 2) continue;

			const edge = matchStrokeToEdge(pts, p.expectedEdges);
			if (!edge) continue;

			const start = pts[0];
			const end = pts[pts.length - 1];
			const dx = end.x - start.x;
			const dy = end.y - start.y;
			const len = Math.sqrt(dx * dx + dy * dy);
			if (len < 1) continue;
			const dirX = dx / len;
			const dirY = dy / len;

			ctx.beginPath();
			ctx.moveTo(
				start.x - dirX * EXTENSION_LEN,
				start.y - dirY * EXTENSION_LEN,
			);
			ctx.lineTo(
				end.x + dirX * EXTENSION_LEN,
				end.y + dirY * EXTENSION_LEN,
			);
			ctx.strokeStyle = VP_EXT_COLORS[edge.vpIndex];
			ctx.lineWidth = 1;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
	},

	onReviewStroke(
		newStroke: Stroke,
		existingStrokes: Stroke[],
		reference: ReferenceShape,
	): Stroke[] {
		const p = reference.params as unknown as ThreePointBoxParams;
		const newPts = getStrokePoints(newStroke);
		const newEdge = matchStrokeToEdge(newPts, p.expectedEdges);
		if (!newEdge) return [...existingStrokes, newStroke];

		const replaceIdx = existingStrokes.findIndex((s) => {
			const pts = getStrokePoints(s);
			const edge = matchStrokeToEdge(pts, p.expectedEdges);
			return edge && edge.vpIndex === newEdge.vpIndex &&
				edge.x1 === newEdge.x1 && edge.y1 === newEdge.y1 &&
				edge.x2 === newEdge.x2 && edge.y2 === newEdge.y2;
		});

		if (replaceIdx >= 0) {
			const updated = [...existingStrokes];
			updated[replaceIdx] = newStroke;
			return updated;
		}
		return [...existingStrokes, newStroke];
	},

	scoreStrokesForRound(
		strokes: Stroke[],
		reference: ReferenceShape,
	): StrokeScore[] {
		const p = reference.params as unknown as ThreePointBoxParams;
		return strokes.map((stroke) => {
			const pts = getStrokePoints(stroke);
			if (pts.length < 2) {
				return buildMetricScore(pts.length > 0 ? pts : [{ x: 0, y: 0, pressure: 0, timestamp: 0 }], {
					smoothness: true,
				});
			}

			const edge = matchStrokeToEdge(pts, p.expectedEdges);
			if (!edge) {
				return buildMetricScore(pts, {
					smoothness: true,
					speedConsistency: true,
				});
			}

			const vp = p.vps[edge.vpIndex];
			const accuracy = scoreLineAccuracy(pts, edge);

			const start = pts[0];
			const end = pts[pts.length - 1];
			const strokeAngle = Math.atan2(end.y - start.y, end.x - start.x);
			const toVPAngle = Math.atan2(
				vp.y - start.y,
				vp.x - start.x,
			);
			let angleDev = Math.abs(strokeAngle - toVPAngle);
			if (angleDev > Math.PI) angleDev = 2 * Math.PI - angleDev;
			const convergenceScore = Math.max(
				0,
				100 - (angleDev / (Math.PI / 6)) * 100,
			);

			const combined = accuracy * 0.5 + convergenceScore * 0.5;
			const extra = highlightLineDivergent(pts, edge);

			return buildMetricScore(pts, {
				pathDeviation: combined,
				smoothness: true,
				speedConsistency: true,
				endpointAccuracy: {
					start: { x: edge.x1, y: edge.y1 },
					end: { x: edge.x2, y: edge.y2 },
				},
				extraSegments: extra,
			});
		});
	},

	scoreStroke(
		points: StrokePoint[],
		_reference: ReferenceShape,
		_strokeIndex: number,
	): StrokeScore {
		return buildMetricScore(points, {
			smoothness: true,
			speedConsistency: true,
		});
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		canvasW: number,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		if (strokeChord(pts) < canvasW * 0.02) return false;

		const p = reference.params as unknown as ThreePointBoxParams;
		const sampleStep = Math.max(1, Math.floor(pts.length / 10));

		for (const edge of p.yEdges) {
			const edgeLen = Math.sqrt(
				(edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2,
			);
			if (edgeLen < 1) continue;
			let totalD = 0;
			let samples = 0;
			for (let i = 0; i < pts.length; i += sampleStep) {
				totalD += pointToSegmentDist(pts[i].x, pts[i].y, edge);
				samples++;
			}
			const avgD = totalD / samples;
			const sLen = strokeChord(pts);
			if (avgD < Math.max(edgeLen * 0.12, 15) && sLen / edgeLen > 0.4)
				return false;
		}

		return true;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as ThreePointBoxParams;
		const pts = [
			p.yCorner,
			...p.yEdges.map((e) => ({ x: e.x2, y: e.y2 })),
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
		];
		return {
			x: pts.reduce((s, pt) => s + pt.x, 0) / pts.length,
			y: pts.reduce((s, pt) => s + pt.y, 0) / pts.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as ThreePointBoxParams;
		const pts = [
			p.yCorner,
			...p.yEdges.map((e) => ({ x: e.x2, y: e.y2 })),
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
			...p.vps,
		];
		const xs = pts.map((pt) => pt.x);
		const ys = pts.map((pt) => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

registerExercise(freeBoxesPlugin);
