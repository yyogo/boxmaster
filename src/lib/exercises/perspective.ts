import type { ExerciseConfig, ExerciseMode, LineParams, PerspectiveBoxParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, type CoordTransform } from './plugin';
import { registerExercise } from './registry';

import { drawDot } from './utils';

const GUIDE_COLOR_FAINT = 'rgba(100, 160, 255, 0.15)';
const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';
const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const GIVEN_EDGE_COLOR = 'rgba(180, 220, 255, 0.8)';

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
	ctx.beginPath();
	ctx.moveTo(x - size, y);
	ctx.lineTo(x + size, y);
	ctx.moveTo(x, y - size);
	ctx.lineTo(x, y + size);
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.stroke();
}

// --- Session ---

export interface PerspectiveSession {
	horizonY: number;
	vp: { x: number; y: number };
}

function createPerspSession(canvasW: number, canvasH: number): PerspectiveSession {
	const horizonY = canvasH * (0.3 + Math.random() * 0.15);
	const vpX = canvasW * (0.3 + Math.random() * 0.4);
	return { horizonY, vp: { x: vpX, y: horizonY } };
}

// --- Generation ---

function generateBox(
	vp: { x: number; y: number },
	horizonY: number,
	cx: number,
	cy: number,
	edgeW: number,
	edgeH: number
): PerspectiveBoxParams {
	const below = cy > horizonY;
	const corner = { x: cx, y: cy };
	const depthFraction = 0.20 + Math.random() * 0.30;
	const hDir = cx < vp.x ? 1 : -1;

	const horizontal: LineParams = { x1: corner.x, y1: corner.y, x2: corner.x + hDir * edgeW, y2: corner.y };
	const vDir = below ? -1 : 1;
	const vertical: LineParams = { x1: corner.x, y1: corner.y, x2: corner.x, y2: corner.y + vDir * edgeH };

	const toVP = { x: vp.x - corner.x, y: vp.y - corner.y };
	const toVPLen = Math.sqrt(toVP.x * toVP.x + toVP.y * toVP.y);
	const depthLen = toVPLen * depthFraction;
	const depth: LineParams = {
		x1: corner.x,
		y1: corner.y,
		x2: corner.x + (toVP.x / toVPLen) * depthLen,
		y2: corner.y + (toVP.y / toVPLen) * depthLen
	};

	const expectedEdges = computeExpectedEdges(corner, horizontal, vertical, depth, vp);
	return { horizon: { y: horizonY }, vanishingPoint: vp, givenCorner: corner, givenEdges: { horizontal, vertical, depth }, expectedEdges };
}

function computeExpectedEdges(
	corner: { x: number; y: number },
	horizontal: LineParams,
	vertical: LineParams,
	depth: LineParams,
	vp: { x: number; y: number }
): LineParams[] {
	const c0 = corner;
	const c1 = { x: horizontal.x2, y: horizontal.y2 };
	const c2 = { x: vertical.x2, y: vertical.y2 };
	const c3 = { x: c1.x + (c2.x - c0.x), y: c1.y + (c2.y - c0.y) };

	const toVP0 = { x: vp.x - c0.x, y: vp.y - c0.y };
	const toVP0Len = Math.sqrt(toVP0.x * toVP0.x + toVP0.y * toVP0.y);
	const depthVec = { x: depth.x2 - depth.x1, y: depth.y2 - depth.y1 };
	const depthLen = Math.sqrt(depthVec.x * depthVec.x + depthVec.y * depthVec.y);
	const ratio = depthLen / toVP0Len;

	function depthPoint(front: { x: number; y: number }) {
		const tv = { x: vp.x - front.x, y: vp.y - front.y };
		const tvLen = Math.sqrt(tv.x * tv.x + tv.y * tv.y);
		const dLen = tvLen * ratio;
		return { x: front.x + (tv.x / tvLen) * dLen, y: front.y + (tv.y / tvLen) * dLen };
	}

	const b0 = { x: depth.x2, y: depth.y2 };
	const b1 = depthPoint(c1);
	const b2 = depthPoint(c2);
	const b3 = depthPoint(c3);

	return [
		{ x1: c1.x, y1: c1.y, x2: c3.x, y2: c3.y },
		{ x1: c2.x, y1: c2.y, x2: c3.x, y2: c3.y },
		{ x1: c1.x, y1: c1.y, x2: b1.x, y2: b1.y },
		{ x1: c2.x, y1: c2.y, x2: b2.x, y2: b2.y },
		{ x1: c3.x, y1: c3.y, x2: b3.x, y2: b3.y },
		{ x1: b0.x, y1: b0.y, x2: b1.x, y2: b1.y },
		{ x1: b0.x, y1: b0.y, x2: b2.x, y2: b2.y },
		{ x1: b1.x, y1: b1.y, x2: b3.x, y2: b3.y },
		{ x1: b2.x, y1: b2.y, x2: b3.x, y2: b3.y }
	];
}

// --- Scoring ---

function scorePerspectiveStroke(points: StrokePoint[], boxes: PerspectiveBoxParams[]): number {
	if (points.length < 2 || boxes.length === 0) return 0;

	const allEdges: { edge: LineParams; isDepth: boolean; vp: { x: number; y: number } }[] = [];
	for (const box of boxes) {
		for (let i = 0; i < box.expectedEdges.length; i++) {
			allEdges.push({ edge: box.expectedEdges[i], isDepth: i >= 2 && i <= 4, vp: box.vanishingPoint });
		}
	}
	if (allEdges.length === 0) return 0;

	const strokeMid = { x: (points[0].x + points[points.length - 1].x) / 2, y: (points[0].y + points[points.length - 1].y) / 2 };
	let bestIdx = 0;
	let bestDist = Infinity;
	for (let i = 0; i < allEdges.length; i++) {
		const e = allEdges[i].edge;
		const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
		const d = Math.sqrt((strokeMid.x - mid.x) ** 2 + (strokeMid.y - mid.y) ** 2);
		if (d < bestDist) { bestDist = d; bestIdx = i; }
	}

	const info = allEdges[bestIdx];
	if (info.isDepth) {
		const start = points[0];
		const end = points[points.length - 1];
		const strokeAngle = Math.atan2(end.y - start.y, end.x - start.x);
		const vpAngle = Math.atan2(info.vp.y - start.y, info.vp.x - start.x);
		let angleDiff = Math.abs(strokeAngle - vpAngle);
		if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
		const angleScore = Math.max(0, 100 - (angleDiff / (Math.PI / 6)) * 100);
		const posScore = scoreEdge(points, info.edge);
		return angleScore * 0.6 + posScore * 0.4;
	}
	return scoreEdge(points, info.edge);
}

function scoreEdge(points: StrokePoint[], edge: LineParams): number {
	let totalDist = 0;
	for (const p of points) totalDist += pointToSegmentDist(p.x, p.y, edge);
	return Math.max(0, Math.min(100, 100 - (totalDist / points.length / 50) * 100));
}

// --- Stroke relevance ---

function perspStrokeRelevant(
	stroke: Stroke,
	reference: ReferenceShape,
	canvasW: number,
	canvasH: number,
	_mode: ExerciseMode
): boolean {
	const bp = reference.params as unknown as PerspectiveBoxParams;
	const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
	if (pts.length < 2) return false;

	const minDim = Math.min(canvasW, canvasH);
	const minThreshold = minDim * 0.25;
	const strokeCx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
	const strokeCy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

	const allPts = [
		bp.givenCorner,
		{ x: bp.givenEdges.horizontal.x2, y: bp.givenEdges.horizontal.y2 },
		{ x: bp.givenEdges.vertical.x2, y: bp.givenEdges.vertical.y2 },
		{ x: bp.givenEdges.depth.x2, y: bp.givenEdges.depth.y2 }
	];
	for (const e of bp.expectedEdges) allPts.push({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });

	const xs = allPts.map((p) => p.x);
	const ys = allPts.map((p) => p.y);
	const bCx = (Math.min(...xs) + Math.max(...xs)) / 2;
	const bCy = (Math.min(...ys) + Math.max(...ys)) / 2;
	const bRadius = Math.sqrt((Math.max(...xs) - Math.min(...xs)) ** 2 + (Math.max(...ys) - Math.min(...ys)) ** 2) / 2;

	const dist = Math.sqrt((strokeCx - bCx) ** 2 + (strokeCy - bCy) ** 2);
	if (dist > Math.max(bRadius * 2.5, minThreshold)) return false;

	const givenEdges = [bp.givenEdges.horizontal, bp.givenEdges.vertical, bp.givenEdges.depth];
	const sampleStep = Math.max(1, Math.floor(pts.length / 10));

	for (const edge of givenEdges) {
		const edgeLen = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
		if (edgeLen < 1) continue;
		let totalD = 0;
		let samples = 0;
		for (let i = 0; i < pts.length; i += sampleStep) {
			totalD += pointToSegmentDist(pts[i].x, pts[i].y, edge);
			samples++;
		}
		const avgD = totalD / samples;
		const strokeLen = Math.sqrt((pts[pts.length - 1].x - pts[0].x) ** 2 + (pts[pts.length - 1].y - pts[0].y) ** 2);
		if (avgD < Math.max(edgeLen * 0.12, 15) && strokeLen / edgeLen > 0.4) return false;
	}

	return true;
}

// --- Geometry validation ---

function edgeLen(e: LineParams): number {
	return Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2);
}

type Pt = { x: number; y: number };

function ptKey(p: Pt): string {
	return `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
}

function vectorAngle(v1: Pt, v2: Pt): number {
	const dot = v1.x * v2.x + v1.y * v2.y;
	const m1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
	const m2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
	if (m1 < 1 || m2 < 1) return 0;
	return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2))));
}

function isBoxGeometryValid(box: PerspectiveBoxParams, minLen: number): boolean {
	const given: LineParams[] = [box.givenEdges.horizontal, box.givenEdges.vertical, box.givenEdges.depth];
	const all = [...given, ...box.expectedEdges];

	for (const e of all) {
		if (edgeLen(e) < minLen) return false;
	}

	// Reject if any front-face corner is too close horizontally to the VP.
	// When a corner's x ≈ vp.x, its depth edge is nearly vertical, creating
	// degenerate angles with the vertical edges.
	const c0 = box.givenCorner;
	const c1 = { x: box.givenEdges.horizontal.x2, y: box.givenEdges.horizontal.y2 };
	const c2 = { x: box.givenEdges.vertical.x2, y: box.givenEdges.vertical.y2 };
	const c3 = { x: c1.x + (c2.x - c0.x), y: c1.y + (c2.y - c0.y) };
	const vpx = box.vanishingPoint.x;
	const minHDist = minLen * 3;
	for (const p of [c0, c1, c2, c3]) {
		if (Math.abs(p.x - vpx) < minHDist) return false;
	}

	// Build adjacency: for each vertex, collect outgoing direction vectors
	const vertexVecs = new Map<string, Pt[]>();
	for (const e of all) {
		const k1 = ptKey({ x: e.x1, y: e.y1 });
		const k2 = ptKey({ x: e.x2, y: e.y2 });
		if (!vertexVecs.has(k1)) vertexVecs.set(k1, []);
		if (!vertexVecs.has(k2)) vertexVecs.set(k2, []);
		vertexVecs.get(k1)!.push({ x: e.x2 - e.x1, y: e.y2 - e.y1 });
		vertexVecs.get(k2)!.push({ x: e.x1 - e.x2, y: e.y1 - e.y2 });
	}

	const minAngle = Math.PI / 6; // 30°
	for (const vecs of vertexVecs.values()) {
		for (let i = 0; i < vecs.length; i++) {
			for (let j = i + 1; j < vecs.length; j++) {
				const angle = vectorAngle(vecs[i], vecs[j]);
				if (angle < minAngle || angle > Math.PI - minAngle) return false;
			}
		}
	}

	return true;
}

// --- Plugin ---

export const perspectivePlugin = defineExercise({
	id: '1-point-box',
	unit: 'perspective',
	label: '1-Point Perspective Box',
	icon: '⬟',
	description: 'Complete boxes in single-point perspective. Three edges are given — draw the remaining nine.',
	availableModes: ['guided', 'challenge'],
	requiredStrokes: 9,
	defaultCount: 10,

	createSession(canvasW: number, canvasH: number): unknown {
		return createPerspSession(canvasW, canvasH);
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number, _toWorld?: CoordTransform): ExerciseConfig {
		const s = session as PerspectiveSession;
		const minDim = Math.min(canvasW, canvasH);
		const minEdgeLen = minDim * 0.04;

		const minHorizonDist = canvasH * 0.15;

		let params: PerspectiveBoxParams | null = null;
		for (let attempt = 0; attempt < 40; attempt++) {
			const edgeW = minDim * (0.18 + Math.random() * 0.20);
			const edgeH = edgeW * (0.6 + Math.random() * 0.6);

			const maxSz = Math.max(edgeW, edgeH) * 2;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 50, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			const candidate = generateBox(s.vp, s.horizonY, slot.x + slot.w / 2, cy, edgeW, edgeH);

			if (isBoxGeometryValid(candidate, minEdgeLen)) {
				params = candidate;
				break;
			}
		}
		if (!params) {
			// Fallback: place corner well away from VP horizontally
			const edgeW = minDim * 0.22;
			const edgeH = edgeW * 0.8;
			const cy = s.horizonY + canvasH * 0.25;
			const hDir = s.vp.x > canvasW / 2 ? -1 : 1;
			const cx = s.vp.x + hDir * (edgeW * 2 + canvasW * 0.1);
			const clamped = Math.max(edgeW, Math.min(canvasW - edgeW, cx));
			params = generateBox(s.vp, s.horizonY, clamped, cy, edgeW, edgeH);
		}

		return {
			unit: 'perspective',
			type: '1-point-box',
			mode,
			strokeCount: params.expectedEdges.length,
			references: [{ type: '1-point-box', params }],
			availableModes: ['guided', 'challenge']
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, _toWorld?: CoordTransform): ExerciseConfig {
		const session = createPerspSession(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as PerspectiveBoxParams;
		ctx.beginPath();
		ctx.moveTo(-5000, p.horizon.y);
		ctx.lineTo(5000, p.horizon.y);
		ctx.strokeStyle = SCAFFOLD_COLOR;
		ctx.lineWidth = 1;
		ctx.setLineDash([12, 8]);
		ctx.stroke();
		ctx.setLineDash([]);

		drawDot(ctx, p.vanishingPoint.x, p.vanishingPoint.y, 6, VP_COLOR);
		drawCrosshair(ctx, p.vanishingPoint.x, p.vanishingPoint.y, 10, VP_COLOR);
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as PerspectiveBoxParams;

		for (const edge of [p.givenEdges.horizontal, p.givenEdges.vertical, p.givenEdges.depth]) {
			ctx.beginPath();
			ctx.moveTo(edge.x1, edge.y1);
			ctx.lineTo(edge.x2, edge.y2);
			ctx.strokeStyle = GIVEN_EDGE_COLOR;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}
		drawDot(ctx, p.givenCorner.x, p.givenCorner.y, 4, GIVEN_EDGE_COLOR);

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

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const bp = reference.params as unknown as PerspectiveBoxParams;
		const accuracy = scorePerspectiveStroke(points, [bp]);
		return buildMetricScore(points, {
			pathDeviation: accuracy,
			smoothness: true,
			speedConsistency: true,
		});
	},

	isStrokeRelevant: perspStrokeRelevant,

	getCenter(params: Record<string, unknown>) {
		const bp = params as unknown as PerspectiveBoxParams;
		const pts = [
			bp.givenCorner,
			{ x: bp.givenEdges.horizontal.x2, y: bp.givenEdges.horizontal.y2 },
			{ x: bp.givenEdges.vertical.x2, y: bp.givenEdges.vertical.y2 },
			{ x: bp.givenEdges.depth.x2, y: bp.givenEdges.depth.y2 },
			...bp.expectedEdges.flatMap((e) => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }])
		];
		return {
			x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
			y: pts.reduce((s, p) => s + p.y, 0) / pts.length
		};
	},

	getBounds(params: Record<string, unknown>) {
		const bp = params as unknown as PerspectiveBoxParams;
		const pts = [
			bp.givenCorner,
			{ x: bp.givenEdges.horizontal.x2, y: bp.givenEdges.horizontal.y2 },
			{ x: bp.givenEdges.vertical.x2, y: bp.givenEdges.vertical.y2 },
			{ x: bp.givenEdges.depth.x2, y: bp.givenEdges.depth.y2 },
			...bp.expectedEdges.flatMap((e) => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }])
		];
		const xs = pts.map((p) => p.x);
		const ys = pts.map((p) => p.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10
		};
	}
});

registerExercise(perspectivePlugin);
