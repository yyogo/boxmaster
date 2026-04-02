import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

export interface TwoPointSession {
	horizonY: number;
	vpLeft: { x: number; y: number };
	vpRight: { x: number; y: number };
}

export interface TwoPointBoxParams {
	horizon: { y: number };
	vpLeft: { x: number; y: number };
	vpRight: { x: number; y: number };
	givenEdge: LineParams;
	expectedEdges: LineParams[];
}

const GUIDE_COLOR_FAINT = 'rgba(100, 160, 255, 0.15)';
const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';
const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const VP2_COLOR = 'rgba(80, 200, 255, 0.9)';
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

function towardVP(from: { x: number; y: number }, vp: { x: number; y: number }, length: number): { x: number; y: number } {
	const dx = vp.x - from.x;
	const dy = vp.y - from.y;
	const dist = Math.sqrt(dx * dx + dy * dy);
	if (dist < 1) return from;
	return { x: from.x + (dx / dist) * length, y: from.y + (dy / dist) * length };
}

function generate2PtBox(
	vpLeft: { x: number; y: number },
	vpRight: { x: number; y: number },
	horizonY: number,
	cx: number, cy: number,
	edgeH: number, widthL: number, widthR: number,
): TwoPointBoxParams {
	// The given edge is a vertical line at (cx, cy) with height edgeH
	const below = cy > horizonY;
	const vDir = below ? -1 : 1;
	const top = { x: cx, y: cy };
	const bottom = { x: cx, y: cy + vDir * edgeH };

	const givenEdge: LineParams = { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y };

	// Left receding edges from top and bottom toward vpLeft
	const tl = towardVP(top, vpLeft, widthL);
	const bl = towardVP(bottom, vpLeft, widthL);

	// Right receding edges from top and bottom toward vpRight
	const tr = towardVP(top, vpRight, widthR);
	const br = towardVP(bottom, vpRight, widthR);

	// Far vertical edges
	const leftVertical: LineParams = { x1: tl.x, y1: tl.y, x2: bl.x, y2: bl.y };
	const rightVertical: LineParams = { x1: tr.x, y1: tr.y, x2: br.x, y2: br.y };

	// Back edges: from far-left corners toward vpRight, from far-right corners toward vpLeft
	// We need to find the back corner where these meet
	const backTopL = towardVP(tl, vpRight, widthR * 0.8);
	const backBottomL = towardVP(bl, vpRight, widthR * 0.8);
	const backTopR = towardVP(tr, vpLeft, widthL * 0.8);
	const backBottomR = towardVP(br, vpLeft, widthL * 0.8);

	// For simplicity, use the average as back corner positions
	const backTop = { x: (backTopL.x + backTopR.x) / 2, y: (backTopL.y + backTopR.y) / 2 };
	const backBottom = { x: (backBottomL.x + backBottomR.x) / 2, y: (backBottomL.y + backBottomR.y) / 2 };

	const expectedEdges: LineParams[] = [
		// Top receding edges
		{ x1: top.x, y1: top.y, x2: tl.x, y2: tl.y },   // top -> left
		{ x1: top.x, y1: top.y, x2: tr.x, y2: tr.y },   // top -> right
		// Bottom receding edges
		{ x1: bottom.x, y1: bottom.y, x2: bl.x, y2: bl.y }, // bottom -> left
		{ x1: bottom.x, y1: bottom.y, x2: br.x, y2: br.y }, // bottom -> right
		// Far vertical edges
		leftVertical,
		rightVertical,
		// Back edges
		{ x1: tl.x, y1: tl.y, x2: backTop.x, y2: backTop.y },
		{ x1: tr.x, y1: tr.y, x2: backTop.x, y2: backTop.y },
		{ x1: bl.x, y1: bl.y, x2: backBottom.x, y2: backBottom.y },
		{ x1: br.x, y1: br.y, x2: backBottom.x, y2: backBottom.y },
		// Back vertical
		{ x1: backTop.x, y1: backTop.y, x2: backBottom.x, y2: backBottom.y },
	];

	return {
		horizon: { y: horizonY },
		vpLeft, vpRight,
		givenEdge,
		expectedEdges,
	};
}

export const perspective2PtPlugin = defineExercise({
	id: '2-point-box',
	unit: 'perspective',
	label: '2-Point Perspective Box',
	icon: '⬢',
	description: 'Build boxes with two vanishing points — the most common perspective in scene drawing.',
	availableModes: ['guided', 'challenge'],
	requiredStrokes: 11,
	defaultCount: 8,

	createSession(canvasW: number, canvasH: number): unknown {
		const horizonY = canvasH * (0.35 + Math.random() * 0.1);
		// VPs are typically far off-canvas
		const vpLeftX = -canvasW * (0.3 + Math.random() * 0.7);
		const vpRightX = canvasW * (1.3 + Math.random() * 0.7);
		return {
			horizonY,
			vpLeft: { x: vpLeftX, y: horizonY },
			vpRight: { x: vpRightX, y: horizonY },
		} as TwoPointSession;
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const s = session as TwoPointSession;
		const minDim = Math.min(canvasW, canvasH);
		const minHorizonDist = canvasH * 0.12;

		let params: TwoPointBoxParams | null = null;

		for (let attempt = 0; attempt < 30; attempt++) {
			const edgeH = minDim * (0.12 + Math.random() * 0.18);
			const widthL = minDim * (0.10 + Math.random() * 0.15);
			const widthR = minDim * (0.10 + Math.random() * 0.15);

			const maxSz = Math.max(widthL + widthR, edgeH) * 2;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 60, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			params = generate2PtBox(s.vpLeft, s.vpRight, s.horizonY, slot.x + slot.w / 2, cy, edgeH, widthL, widthR);
			break;
		}

		if (!params) {
			const edgeH = minDim * 0.18;
			const widthL = minDim * 0.12;
			const widthR = minDim * 0.12;
			params = generate2PtBox(s.vpLeft, s.vpRight, s.horizonY, canvasW / 2, s.horizonY + canvasH * 0.2, edgeH, widthL, widthR);
		}

		return {
			unit: 'perspective',
			type: '2-point-box',
			mode,
			strokeCount: params.expectedEdges.length,
			references: [{ type: '2-point-box', params }],
			availableModes: ['guided', 'challenge'],
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const session = this.createSession!(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as TwoPointBoxParams;
		// Horizon line
		ctx.beginPath();
		ctx.moveTo(-10000, p.horizon.y);
		ctx.lineTo(10000, p.horizon.y);
		ctx.strokeStyle = SCAFFOLD_COLOR;
		ctx.lineWidth = 1;
		ctx.setLineDash([12, 8]);
		ctx.stroke();
		ctx.setLineDash([]);

		// VP indicators
		drawDot(ctx, p.vpLeft.x, p.vpLeft.y, 6, VP_COLOR);
		drawCrosshair(ctx, p.vpLeft.x, p.vpLeft.y, 10, VP_COLOR);
		drawDot(ctx, p.vpRight.x, p.vpRight.y, 6, VP2_COLOR);
		drawCrosshair(ctx, p.vpRight.x, p.vpRight.y, 10, VP2_COLOR);
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as TwoPointBoxParams;

		// Draw given vertical edge
		ctx.beginPath();
		ctx.moveTo(p.givenEdge.x1, p.givenEdge.y1);
		ctx.lineTo(p.givenEdge.x2, p.givenEdge.y2);
		ctx.strokeStyle = GIVEN_EDGE_COLOR;
		ctx.lineWidth = 2.5;
		ctx.stroke();
		drawDot(ctx, p.givenEdge.x1, p.givenEdge.y1, 4, GIVEN_EDGE_COLOR);
		drawDot(ctx, p.givenEdge.x2, p.givenEdge.y2, 4, GIVEN_EDGE_COLOR);

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

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number): StrokeScore {
		const p = reference.params as unknown as TwoPointBoxParams;

		// Match stroke to the closest expected edge
		const strokeMid = {
			x: (points[0].x + points[points.length - 1].x) / 2,
			y: (points[0].y + points[points.length - 1].y) / 2,
		};

		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < p.expectedEdges.length; i++) {
			const e = p.expectedEdges[i];
			const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
			const d = Math.sqrt((strokeMid.x - mid.x) ** 2 + (strokeMid.y - mid.y) ** 2);
			if (d < bestDist) { bestDist = d; bestIdx = i; }
		}

		const edge = p.expectedEdges[bestIdx];
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
		return strokeChord(pts) >= canvasW * 0.02;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as TwoPointBoxParams;
		const all = [
			{ x: p.givenEdge.x1, y: p.givenEdge.y1 },
			{ x: p.givenEdge.x2, y: p.givenEdge.y2 },
			...p.expectedEdges.flatMap(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]),
		];
		return {
			x: all.reduce((s, pt) => s + pt.x, 0) / all.length,
			y: all.reduce((s, pt) => s + pt.y, 0) / all.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as TwoPointBoxParams;
		const all = [
			{ x: p.givenEdge.x1, y: p.givenEdge.y1 },
			{ x: p.givenEdge.x2, y: p.givenEdge.y2 },
			...p.expectedEdges.flatMap(e => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]),
		];
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

registerExercise(perspective2PtPlugin);
