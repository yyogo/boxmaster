import type { ExerciseConfig, ExerciseMode, LineParams, PerspectiveBoxParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';
import type { PerspectiveSession } from './perspective';

export interface DrawThroughParams {
	horizon: { y: number };
	vanishingPoint: { x: number; y: number };
	visibleEdges: LineParams[];
	hiddenEdges: LineParams[];
}

const GUIDE_COLOR_FAINT = 'rgba(100, 160, 255, 0.15)';
const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';
const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const VISIBLE_COLOR = 'rgba(180, 220, 255, 0.8)';
const HIDDEN_GUIDE_COLOR = 'rgba(100, 160, 255, 0.3)';

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

function generateBox(
	vp: { x: number; y: number },
	horizonY: number,
	cx: number,
	cy: number,
	edgeW: number,
	edgeH: number,
): { visibleEdges: LineParams[]; hiddenEdges: LineParams[]; allPts: { x: number; y: number }[] } | null {
	const below = cy > horizonY;
	const corner = { x: cx, y: cy };
	const depthFraction = 0.20 + Math.random() * 0.30;
	const hDir = cx < vp.x ? 1 : -1;

	const horizontal: LineParams = { x1: corner.x, y1: corner.y, x2: corner.x + hDir * edgeW, y2: corner.y };
	const vDir = below ? -1 : 1;
	const vertical: LineParams = { x1: corner.x, y1: corner.y, x2: corner.x, y2: corner.y + vDir * edgeH };

	const toVP = { x: vp.x - corner.x, y: vp.y - corner.y };
	const toVPLen = Math.sqrt(toVP.x * toVP.x + toVP.y * toVP.y);
	if (toVPLen < 1) return null;
	const depthLen = toVPLen * depthFraction;
	const depth: LineParams = {
		x1: corner.x, y1: corner.y,
		x2: corner.x + (toVP.x / toVPLen) * depthLen,
		y2: corner.y + (toVP.y / toVPLen) * depthLen,
	};

	const c0 = corner;
	const c1 = { x: horizontal.x2, y: horizontal.y2 };
	const c2 = { x: vertical.x2, y: vertical.y2 };
	const c3 = { x: c1.x + (c2.x - c0.x), y: c1.y + (c2.y - c0.y) };

	const ratio = depthLen / toVPLen;
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

	// c3 is the nearest front-face corner to the viewer (diagonal from c0,
	// where horizontal/vertical edges converge toward the VP and horizon).
	// The hidden corner is b0 — directly behind c0, the farthest from the viewer.
	// Visible: front face (4) + depth edges from c3,c1,c2 + back edges b1→b3, b2→b3
	const visibleEdges: LineParams[] = [
		horizontal,                                                      // c0→c1
		vertical,                                                        // c0→c2
		{ x1: c1.x, y1: c1.y, x2: c3.x, y2: c3.y },                   // c1→c3
		{ x1: c2.x, y1: c2.y, x2: c3.x, y2: c3.y },                   // c2→c3
		{ x1: c3.x, y1: c3.y, x2: b3.x, y2: b3.y },                   // c3→b3 (depth from nearest corner)
		{ x1: c1.x, y1: c1.y, x2: b1.x, y2: b1.y },                   // c1→b1
		{ x1: c2.x, y1: c2.y, x2: b2.x, y2: b2.y },                   // c2→b2
		{ x1: b1.x, y1: b1.y, x2: b3.x, y2: b3.y },                   // b1→b3 (back face)
		{ x1: b2.x, y1: b2.y, x2: b3.x, y2: b3.y },                   // b2→b3 (back face)
	];

	// Hidden: 3 edges meeting at b0 (the farthest corner from the viewer)
	const hiddenEdges: LineParams[] = [
		{ x1: c0.x, y1: c0.y, x2: b0.x, y2: b0.y },                   // c0→b0 (depth from far corner)
		{ x1: b0.x, y1: b0.y, x2: b1.x, y2: b1.y },                   // b0→b1 (back face)
		{ x1: b0.x, y1: b0.y, x2: b2.x, y2: b2.y },                   // b0→b2 (back face)
	];

	const allPts = [c0, c1, c2, c3, b0, b1, b2, b3];
	return { visibleEdges, hiddenEdges, allPts };
}

export const drawThroughPlugin = defineExercise({
	id: 'draw-through',
	unit: 'perspective',
	label: 'Draw-Through Boxes',
	icon: '⬡',
	description: 'See a nearly-complete box — draw the 3 hidden back edges to develop 3D thinking.',
	availableModes: ['guided', 'challenge'],
	requiredStrokes: 3,
	defaultCount: 10,

	createSession(canvasW: number, canvasH: number): unknown {
		const horizonY = canvasH * (0.3 + Math.random() * 0.15);
		const vpX = canvasW * (0.3 + Math.random() * 0.4);
		return { horizonY, vp: { x: vpX, y: horizonY } } as PerspectiveSession;
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const s = session as PerspectiveSession;
		const minDim = Math.min(canvasW, canvasH);
		const minHorizonDist = canvasH * 0.15;

		let result: { visibleEdges: LineParams[]; hiddenEdges: LineParams[] } | null = null;

		for (let attempt = 0; attempt < 40; attempt++) {
			const edgeW = minDim * (0.25 + Math.random() * 0.20);
			const edgeH = edgeW * (0.6 + Math.random() * 0.6);
			const maxSz = Math.max(edgeW, edgeH) * 2;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 50, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			const box = generateBox(s.vp, s.horizonY, slot.x + slot.w / 2, cy, edgeW, edgeH);
			if (box) {
				result = box;
				break;
			}
		}

		if (!result) {
			const edgeW = minDim * 0.30;
			const edgeH = edgeW * 0.8;
			const cy = s.horizonY + canvasH * 0.25;
			const hDir = s.vp.x > canvasW / 2 ? -1 : 1;
			const cx = Math.max(edgeW, Math.min(canvasW - edgeW, s.vp.x + hDir * (edgeW * 2 + canvasW * 0.1)));
			result = generateBox(s.vp, s.horizonY, cx, cy, edgeW, edgeH)!;
		}

		const params: DrawThroughParams = {
			horizon: { y: s.horizonY },
			vanishingPoint: s.vp,
			visibleEdges: result!.visibleEdges,
			hiddenEdges: result!.hiddenEdges,
		};

		return {
			unit: 'perspective',
			type: 'draw-through',
			mode,
			strokeCount: 3,
			references: [{ type: 'draw-through', params }],
			availableModes: ['guided', 'challenge'],
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const session = this.createSession!(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as DrawThroughParams;
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
		const p = params as unknown as DrawThroughParams;

		// Always draw the visible edges
		for (const edge of p.visibleEdges) {
			ctx.beginPath();
			ctx.moveTo(edge.x1, edge.y1);
			ctx.lineTo(edge.x2, edge.y2);
			ctx.strokeStyle = VISIBLE_COLOR;
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Show hidden edge guides based on visibility
		if (visibility === 'full') {
			for (const edge of p.hiddenEdges) {
				ctx.beginPath();
				ctx.moveTo(edge.x1, edge.y1);
				ctx.lineTo(edge.x2, edge.y2);
				ctx.strokeStyle = HIDDEN_GUIDE_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([6, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
		// In challenge/hints mode: no hidden edge guides, just the visible box
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number): StrokeScore {
		const p = reference.params as unknown as DrawThroughParams;
		if (strokeIndex >= p.hiddenEdges.length) {
			return buildMetricScore(points, { smoothness: true, speedConsistency: true });
		}

		// Find the closest hidden edge to this stroke
		const strokeMid = {
			x: (points[0].x + points[points.length - 1].x) / 2,
			y: (points[0].y + points[points.length - 1].y) / 2,
		};
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < p.hiddenEdges.length; i++) {
			const e = p.hiddenEdges[i];
			const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
			const d = Math.sqrt((strokeMid.x - mid.x) ** 2 + (strokeMid.y - mid.y) ** 2);
			if (d < bestDist) { bestDist = d; bestIdx = i; }
		}

		const edge = p.hiddenEdges[bestIdx];
		const extra = highlightLineDivergent(points, edge);
		return buildMetricScore(points, {
			pathDeviation: scoreLineAccuracy(points, edge),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start: { x: edge.x1, y: edge.y1 }, end: { x: edge.x2, y: edge.y2 } },
			extraSegments: extra,
		});
	},

	isStrokeRelevant(stroke: Stroke, _reference: ReferenceShape, canvasW: number): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		return strokeChord(pts) >= canvasW * 0.03;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as DrawThroughParams;
		const all = [...p.visibleEdges, ...p.hiddenEdges].flatMap(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
		return {
			x: all.reduce((s, pt) => s + pt.x, 0) / all.length,
			y: all.reduce((s, pt) => s + pt.y, 0) / all.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as DrawThroughParams;
		const all = [...p.visibleEdges, ...p.hiddenEdges].flatMap(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
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

registerExercise(drawThroughPlugin);
