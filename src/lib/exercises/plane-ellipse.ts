import type { ExerciseConfig, ExerciseMode, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen } from './plugin';
import { registerExercise } from './registry';
import { drawDot } from './utils';
import type { PerspectiveSession } from './perspective';

type Pt = { x: number; y: number };

/**
 * 3x3 homography stored row-major, normalised so h9 = 1:
 *   | h1 h2 h3 |     [u]     [w·x]
 *   | h4 h5 h6 |  ×  [v]  =  [w·y]
 *   | h7 h8  1 |     [1]     [ w ]
 */
interface Homography {
	h1: number;
	h2: number;
	h3: number;
	h4: number;
	h5: number;
	h6: number;
	h7: number;
	h8: number;
}

function computeHomography(A: Pt, B: Pt, C: Pt, D: Pt): Homography {
	const a = C.x - B.x,
		b = C.x - D.x,
		c = B.x + D.x - A.x - C.x;
	const d = C.y - B.y,
		e = C.y - D.y,
		f = B.y + D.y - A.y - C.y;
	const det = a * e - b * d;
	const h7 = (c * e - b * f) / det;
	const h8 = (a * f - c * d) / det;
	return {
		h1: B.x * (h7 + 1) - A.x,
		h2: D.x * (h8 + 1) - A.x,
		h3: A.x,
		h4: B.y * (h7 + 1) - A.y,
		h5: D.y * (h8 + 1) - A.y,
		h6: A.y,
		h7,
		h8,
	};
}

function applyH(H: Homography, u: number, v: number): Pt {
	const w = H.h7 * u + H.h8 * v + 1;
	return {
		x: (H.h1 * u + H.h2 * v + H.h3) / w,
		y: (H.h4 * u + H.h5 * v + H.h6) / w,
	};
}

function invertH(H: Homography): Homography {
	const { h1: a, h2: b, h3: c, h4: d, h5: e, h6: f, h7: g, h8: h } = H;
	const det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
	const raw = [
		e - f * h,
		c * h - b,
		b * f - c * e,
		f * g - d,
		a - c * g,
		c * d - a * f,
		d * h - e * g,
		b * g - a * h,
		a * e - b * d,
	];
	const s = raw[8] / det;
	return {
		h1: raw[0] / det / s,
		h2: raw[1] / det / s,
		h3: raw[2] / det / s,
		h4: raw[3] / det / s,
		h5: raw[4] / det / s,
		h6: raw[5] / det / s,
		h7: raw[6] / det / s,
		h8: raw[7] / det / s,
	};
}

export interface PlaneEllipseParams {
	corners: Pt[];
	curvePoints: Pt[];
	horizon: { y: number };
	vanishingPoint: Pt;
}

const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';
const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const QUAD_COLOR = 'rgba(180, 220, 255, 0.8)';
const GUIDE_COLOR = 'rgba(100, 160, 255, 0.4)';
const HINT_COLOR = 'rgba(100, 160, 255, 0.5)';

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

function generatePlane(
	vp: Pt,
	horizonY: number,
	cx: number,
	cy: number,
	edgeLen: number,
	depthFraction: number,
	orientation: 'horizontal' | 'vertical',
): { corners: Pt[]; curvePoints: Pt[] } | null {
	const below = cy > horizonY;

	let A: Pt, B: Pt;
	if (orientation === 'horizontal') {
		const hDir = cx < vp.x ? 1 : -1;
		A = { x: cx, y: cy };
		B = { x: cx + hDir * edgeLen, y: cy };
	} else {
		const vDir = below ? -1 : 1;
		A = { x: cx, y: cy };
		B = { x: cx, y: cy + vDir * edgeLen };
	}

	const dxA = vp.x - A.x,
		dyA = vp.y - A.y;
	const dxB = vp.x - B.x,
		dyB = vp.y - B.y;
	if (Math.hypot(dxA, dyA) < 1 || Math.hypot(dxB, dyB) < 1) return null;

	const D: Pt = { x: A.x + dxA * depthFraction, y: A.y + dyA * depthFraction };
	const C: Pt = { x: B.x + dxB * depthFraction, y: B.y + dyB * depthFraction };
	const corners = [A, B, C, D];

	const H = computeHomography(A, B, C, D);

	const N = 80;
	const curvePoints: Pt[] = [];
	for (let i = 0; i < N; i++) {
		const t = (i / N) * Math.PI * 2;
		curvePoints.push(applyH(H, 0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)));
	}

	const cxs = curvePoints.map((p) => p.x);
	const cys = curvePoints.map((p) => p.y);
	const spanX = Math.max(...cxs) - Math.min(...cxs);
	const spanY = Math.max(...cys) - Math.min(...cys);
	const minSpan = Math.min(spanX, spanY);
	const maxSpan = Math.max(spanX, spanY);
	if (minSpan < 1 || maxSpan / minSpan > 4) return null;

	return { corners, curvePoints };
}

function curvePerimeter(pts: Pt[]): number {
	let len = 0;
	for (let i = 0; i < pts.length; i++) {
		const j = (i + 1) % pts.length;
		len += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
	}
	return len;
}

function scoreCurveAccuracy(points: StrokePoint[], corners: Pt[]): number {
	const Hinv = invertH(computeHomography(corners[0], corners[1], corners[2], corners[3]));

	let totalDist = 0;
	for (const p of points) {
		const uv = applyH(Hinv, p.x, p.y);
		const dx = uv.x - 0.5;
		const dy = uv.y - 0.5;
		totalDist += Math.abs(Math.sqrt(dx * dx + dy * dy) - 0.5);
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 0.2) * 100));
}

export const planeEllipsePlugin = defineExercise({
	id: 'plane-ellipse',
	unit: 'perspective',
	label: 'Plane Ellipses',
	icon: '▱',
	description: 'Draw ellipses inscribed in perspective rectangles — learn how circles look on tilted planes.',
	availableModes: ['tracing', 'challenge'],
	requiredStrokes: 1,
	defaultCount: 15,

	createSession(canvasW: number, canvasH: number): unknown {
		const horizonY = canvasH * (0.3 + Math.random() * 0.15);
		const vpX = canvasW * (0.3 + Math.random() * 0.4);
		return { horizonY, vp: { x: vpX, y: horizonY } } as PerspectiveSession;
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const s = session as PerspectiveSession;
		const minDim = Math.min(canvasW, canvasH);
		const minHorizonDist = canvasH * 0.12;

		let result: { corners: Pt[]; curvePoints: Pt[] } | null = null;

		for (let attempt = 0; attempt < 40; attempt++) {
			const edgeLen = minDim * (0.28 + Math.random() * 0.22);
			const depthFraction = 0.22 + Math.random() * 0.2;
			const orientation: 'horizontal' | 'vertical' = Math.random() < 0.6 ? 'horizontal' : 'vertical';

			const maxSz = edgeLen * 2.5;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 50, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			const plane = generatePlane(s.vp, s.horizonY, slot.x + slot.w / 2, cy, edgeLen, depthFraction, orientation);
			if (plane) {
				const allInBounds = plane.corners.every(
					(p) => p.x > 20 && p.x < canvasW - 20 && p.y > 20 && p.y < canvasH - 20,
				);
				if (allInBounds) {
					result = plane;
					break;
				}
			}
		}

		if (!result) {
			const edgeLen = minDim * 0.35;
			const cy = s.horizonY + canvasH * 0.25;
			const hDir = s.vp.x > canvasW / 2 ? -1 : 1;
			const cx = Math.max(edgeLen, Math.min(canvasW - edgeLen, s.vp.x + hDir * (edgeLen * 2)));
			result = generatePlane(s.vp, s.horizonY, cx, cy, edgeLen, 0.3, 'horizontal')!;
		}

		const params: PlaneEllipseParams = {
			corners: result.corners,
			curvePoints: result.curvePoints,
			horizon: { y: s.horizonY },
			vanishingPoint: s.vp,
		};

		return {
			unit: 'perspective',
			type: 'plane-ellipse',
			mode,
			strokeCount: 1,
			references: [{ type: 'plane-ellipse', params }],
			availableModes: ['tracing', 'challenge'],
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const session = this.createSession!(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as PlaneEllipseParams;
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
		const p = params as unknown as PlaneEllipseParams;
		const corners = p.corners;

		// Always draw the perspective rectangle
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (let i = 1; i < corners.length; i++) {
			ctx.lineTo(corners[i].x, corners[i].y);
		}
		ctx.closePath();
		ctx.strokeStyle = QUAD_COLOR;
		ctx.lineWidth = 2;
		ctx.stroke();

		// True tangent points: map the unit-circle contact points through H
		const H = computeHomography(corners[0], corners[1], corners[2], corners[3]);
		const tangents: Pt[] = [
			applyH(H, 0.5, 0), // on AB
			applyH(H, 1, 0.5), // on BC
			applyH(H, 0.5, 1), // on CD
			applyH(H, 0, 0.5), // on DA
		];

		if (visibility === 'full') {
			ctx.beginPath();
			ctx.moveTo(p.curvePoints[0].x, p.curvePoints[0].y);
			for (let i = 1; i < p.curvePoints.length; i++) {
				ctx.lineTo(p.curvePoints[i].x, p.curvePoints[i].y);
			}
			ctx.closePath();
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([6, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		if (visibility === 'full' || visibility === 'hints') {
			const AXIS_COLOR = 'rgba(100, 160, 255, 0.3)';
			for (let i = 0; i < 2; i++) {
				ctx.beginPath();
				ctx.moveTo(tangents[i].x, tangents[i].y);
				ctx.lineTo(tangents[i + 2].x, tangents[i + 2].y);
				ctx.strokeStyle = AXIS_COLOR;
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
			for (const t of tangents) drawDot(ctx, t.x, t.y, 3, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as PlaneEllipseParams;
		const accuracy = scoreCurveAccuracy(points, p.corners);
		const perimeter = curvePerimeter(p.curvePoints);
		return buildMetricScore(points, {
			pathDeviation: accuracy,
			smoothness: true,
			speedConsistency: true,
			closureGap: { perimeter },
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, _canvasW: number): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 3) return false;
		const p = reference.params as unknown as PlaneEllipseParams;

		const cx = p.corners.reduce((s, c) => s + c.x, 0) / p.corners.length;
		const cy = p.corners.reduce((s, c) => s + c.y, 0) / p.corners.length;
		const sx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
		const sy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;

		const quadSize = Math.max(...p.corners.map((c) => Math.hypot(c.x - cx, c.y - cy)));
		if (Math.hypot(sx - cx, sy - cy) > quadSize * 2.5) return false;

		const arc = strokeArcLen(pts);
		const perim = curvePerimeter(p.curvePoints);
		return arc >= perim * 0.2;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as PlaneEllipseParams;
		return {
			x: p.corners.reduce((s, c) => s + c.x, 0) / p.corners.length,
			y: p.corners.reduce((s, c) => s + c.y, 0) / p.corners.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as PlaneEllipseParams;
		const xs = p.corners.map((c) => c.x);
		const ys = p.corners.map((c) => c.y);
		return {
			minX: Math.min(...xs) - 15,
			minY: Math.min(...ys) - 15,
			maxX: Math.max(...xs) + 15,
			maxY: Math.max(...ys) + 15,
		};
	},
});

registerExercise(planeEllipsePlugin);
