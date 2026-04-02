import type { ExerciseConfig, ExerciseMode, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen } from './plugin';
import { registerExercise } from './registry';
import { drawDot } from './utils';
import type { PerspectiveSession } from './perspective';

type Pt = { x: number; y: number };

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

/**
 * Generate a perspective quadrilateral (rectangle receding toward VP).
 * corners[0..3] = A (near-left), B (near-right), C (far-right), D (far-left).
 * The inscribed curve is sampled via bilinear mapping of the unit circle.
 */
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

	const dxA = vp.x - A.x, dyA = vp.y - A.y;
	const dxB = vp.x - B.x, dyB = vp.y - B.y;
	if (Math.hypot(dxA, dyA) < 1 || Math.hypot(dxB, dyB) < 1) return null;

	const D: Pt = { x: A.x + dxA * depthFraction, y: A.y + dyA * depthFraction };
	const C: Pt = { x: B.x + dxB * depthFraction, y: B.y + dyB * depthFraction };
	const corners = [A, B, C, D];

	const N = 80;
	const curvePoints: Pt[] = [];
	for (let i = 0; i < N; i++) {
		const t = (i / N) * Math.PI * 2;
		const u = 0.5 + 0.5 * Math.cos(t);
		const v = 0.5 + 0.5 * Math.sin(t);
		const x = (1 - v) * ((1 - u) * A.x + u * B.x) + v * ((1 - u) * D.x + u * C.x);
		const y = (1 - v) * ((1 - u) * A.y + u * B.y) + v * ((1 - u) * D.y + u * C.y);
		curvePoints.push({ x, y });
	}

	// Reject if the curve is too thin (aspect ratio > 4:1)
	const cxs = curvePoints.map(p => p.x);
	const cys = curvePoints.map(p => p.y);
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

function scoreCurveAccuracy(points: StrokePoint[], curve: Pt[]): number {
	let totalDist = 0;
	for (const p of points) {
		let minD = Infinity;
		for (let i = 0; i < curve.length; i++) {
			const j = (i + 1) % curve.length;
			const d = pointToSegmentDist(p.x, p.y, {
				x1: curve[i].x, y1: curve[i].y,
				x2: curve[j].x, y2: curve[j].y,
			});
			if (d < minD) minD = d;
		}
		totalDist += minD;
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 40) * 100));
}

export const planeEllipsePlugin = defineExercise({
	id: 'plane-ellipse',
	unit: 'perspective',
	label: 'Plane Ellipses',
	icon: '▱',
	description: 'Draw ellipses inscribed in perspective rectangles — learn how circles look on tilted planes.',
	availableModes: ['guided', 'challenge'],
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
			const depthFraction = 0.22 + Math.random() * 0.20;
			const orientation: 'horizontal' | 'vertical' = Math.random() < 0.6 ? 'horizontal' : 'vertical';

			const maxSz = edgeLen * 2.5;
			const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxSz, h: maxSz }), 50, 30);
			const slot = slots[0];
			const cy = slot.y + slot.h / 2;

			if (Math.abs(cy - s.horizonY) < minHorizonDist) continue;

			const plane = generatePlane(s.vp, s.horizonY, slot.x + slot.w / 2, cy, edgeLen, depthFraction, orientation);
			if (plane) {
				const allInBounds = plane.corners.every(
					p => p.x > 20 && p.x < canvasW - 20 && p.y > 20 && p.y < canvasH - 20
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
			result = generatePlane(s.vp, s.horizonY, cx, cy, edgeLen, 0.30, 'horizontal')!;
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
			availableModes: ['guided', 'challenge'],
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
		} else if (visibility === 'hints') {
			// Midpoints of each side (where the ellipse is tangent)
			for (let i = 0; i < corners.length; i++) {
				const j = (i + 1) % corners.length;
				const mx = (corners[i].x + corners[j].x) / 2;
				const my = (corners[i].y + corners[j].y) / 2;
				drawDot(ctx, mx, my, 3, HINT_COLOR);
			}
			const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
			const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
			drawCrosshair(ctx, cx, cy, 6, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as PlaneEllipseParams;
		const accuracy = scoreCurveAccuracy(points, p.curvePoints);
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

		const quadSize = Math.max(...p.corners.map(c => Math.hypot(c.x - cx, c.y - cy)));
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
		const xs = p.corners.map(c => c.x);
		const ys = p.corners.map(c => c.y);
		return {
			minX: Math.min(...xs) - 15,
			minY: Math.min(...ys) - 15,
			maxX: Math.max(...xs) + 15,
			maxY: Math.max(...ys) + 15,
		};
	},
});

registerExercise(planeEllipsePlugin);
