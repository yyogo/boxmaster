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
	verticalIndices: number[];
}

const GUIDE_COLOR_FAINT = 'rgba(130, 185, 255, 0.48)';
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

function yOnLine(from: { x: number; y: number }, to: { x: number; y: number }, atX: number): number {
	const dx = to.x - from.x;
	if (Math.abs(dx) < 0.001) return from.y;
	return from.y + ((atX - from.x) / dx) * (to.y - from.y);
}

function generate2PtBox(
	vpLeft: { x: number; y: number },
	vpRight: { x: number; y: number },
	horizonY: number,
	cx: number,
	cy: number,
	edgeH: number,
	widthL: number,
	widthR: number,
): TwoPointBoxParams {
	const below = cy > horizonY;
	const vDir = below ? -1 : 1;

	// 1. Front edge
	const fTop = { x: cx, y: cy };
	const fBot = { x: cx, y: cy + vDir * edgeH };
	const givenEdge: LineParams = { x1: fTop.x, y1: fTop.y, x2: fBot.x, y2: fBot.y };

	// 2. Side edge x positions
	const leftX = cx - widthL;
	const rightX = cx + widthR;

	// 3. Side corners: intersect VP→front-corner lines with side verticals
	const lTop = { x: leftX, y: yOnLine(vpLeft, fTop, leftX) };
	const lBot = { x: leftX, y: yOnLine(vpLeft, fBot, leftX) };
	const rTop = { x: rightX, y: yOnLine(vpRight, fTop, rightX) };
	const rBot = { x: rightX, y: yOnLine(vpRight, fBot, rightX) };

	// 4. Back corners: intersect left-side→vpRight with right-side→vpLeft
	const slopeR = (vpRight.y - lTop.y) / (vpRight.x - lTop.x);
	const slopeL = (vpLeft.y - rTop.y) / (vpLeft.x - rTop.x);
	const backTopX = (rTop.y - lTop.y + slopeR * lTop.x - slopeL * rTop.x) / (slopeR - slopeL);
	const backTopY = lTop.y + slopeR * (backTopX - lTop.x);
	const backTop = { x: backTopX, y: backTopY };

	const slopeBR = (vpRight.y - lBot.y) / (vpRight.x - lBot.x);
	const slopeBL = (vpLeft.y - rBot.y) / (vpLeft.x - rBot.x);
	const backBotX = (rBot.y - lBot.y + slopeBR * lBot.x - slopeBL * rBot.x) / (slopeBR - slopeBL);
	const backBotY = lBot.y + slopeBR * (backBotX - lBot.x);
	const backBot = { x: backBotX, y: backBotY };

	const expectedEdges: LineParams[] = [
		// Top receding
		{ x1: fTop.x, y1: fTop.y, x2: lTop.x, y2: lTop.y }, // 0: front-top → left-top
		{ x1: fTop.x, y1: fTop.y, x2: rTop.x, y2: rTop.y }, // 1: front-top → right-top
		// Bottom receding
		{ x1: fBot.x, y1: fBot.y, x2: lBot.x, y2: lBot.y }, // 2: front-bot → left-bot
		{ x1: fBot.x, y1: fBot.y, x2: rBot.x, y2: rBot.y }, // 3: front-bot → right-bot
		// Side verticals
		{ x1: lTop.x, y1: lTop.y, x2: lBot.x, y2: lBot.y }, // 4: left vertical
		{ x1: rTop.x, y1: rTop.y, x2: rBot.x, y2: rBot.y }, // 5: right vertical
		// Back top edges
		{ x1: lTop.x, y1: lTop.y, x2: backTop.x, y2: backTop.y }, // 6: left-top → back-top (→ vpRight)
		{ x1: rTop.x, y1: rTop.y, x2: backTop.x, y2: backTop.y }, // 7: right-top → back-top (→ vpLeft)
		// Back bottom edges
		{ x1: lBot.x, y1: lBot.y, x2: backBot.x, y2: backBot.y }, // 8: left-bot → back-bot
		{ x1: rBot.x, y1: rBot.y, x2: backBot.x, y2: backBot.y }, // 9: right-bot → back-bot
		// Back vertical
		{ x1: backTop.x, y1: backTop.y, x2: backBot.x, y2: backBot.y }, // 10
	];

	return {
		horizon: { y: horizonY },
		vpLeft,
		vpRight,
		givenEdge,
		expectedEdges,
		verticalIndices: [4, 5, 10],
	};
}

export const perspective2PtPlugin = defineExercise({
	id: '2-point-box',
	unit: 'perspective',
	label: '2-Point Perspective Box',
	icon: '⬢',
	description: 'Build boxes with two vanishing points — the most common perspective in scene drawing.',
	availableModes: ['tracing', 'challenge'],
	requiredStrokes: 11,
	defaultCount: 8,

	createSession(canvasW: number, canvasH: number): unknown {
		const horizonY = canvasH * (0.35 + Math.random() * 0.1);
		const vpLeftX = canvasW * (0.02 + Math.random() * 0.13);
		const vpRightX = canvasW * (0.85 + Math.random() * 0.13);
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
			const edgeH = minDim * (0.18 + Math.random() * 0.2);
			const widthL = minDim * (0.15 + Math.random() * 0.18);
			const widthR = minDim * (0.15 + Math.random() * 0.18);

			const maxSz = Math.max(widthL + widthR, edgeH) * 2;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 60, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			params = generate2PtBox(s.vpLeft, s.vpRight, s.horizonY, slot.x + slot.w / 2, cy, edgeH, widthL, widthR);
			break;
		}

		if (!params) {
			const edgeH = minDim * 0.25;
			const widthL = minDim * 0.18;
			const widthR = minDim * 0.18;
			params = generate2PtBox(
				s.vpLeft,
				s.vpRight,
				s.horizonY,
				canvasW / 2,
				s.horizonY + canvasH * 0.2,
				edgeH,
				widthL,
				widthR,
			);
		}

		return {
			unit: 'perspective',
			type: '2-point-box',
			mode,
			strokeCount: params.expectedEdges.length,
			references: [{ type: '2-point-box', params }],
			availableModes: ['tracing', 'challenge'],
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
		const VERT_HINT_COLOR = 'rgba(190, 225, 255, 0.55)';

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
		} else if (visibility === 'hints') {
			const BACK_VERT_COLOR = 'rgba(255, 195, 120, 0.55)';
			const backIdx = p.verticalIndices[p.verticalIndices.length - 1];

			for (const idx of p.verticalIndices) {
				const edge = p.expectedEdges[idx];
				if (!edge) continue;

				ctx.beginPath();
				ctx.moveTo(edge.x1, p.givenEdge.y1);
				ctx.lineTo(edge.x1, p.givenEdge.y2);
				ctx.strokeStyle = idx === backIdx ? BACK_VERT_COLOR : VERT_HINT_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([4, 8]);
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
			if (d < bestDist) {
				bestDist = d;
				bestIdx = i;
			}
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
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
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
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
		];
		const xs = all.map((pt) => pt.x);
		const ys = all.map((pt) => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

registerExercise(perspective2PtPlugin);
