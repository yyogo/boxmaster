import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { BOUNDARY_OUTLINE_COLOR, GUIDE_COLOR, scoreLineAccuracy, highlightLineDivergent } from './utils';
import {
	type HatchRegionKind,
	outlineCornersLocal,
	localToWorld,
	xExtentAtLocalY,
	assignStrokesToLinesMinCost
} from './hatching-geometry';

export interface HatchParams {
	lines: LineParams[];
	angle: number;
	spacing: number;
	bounds: { cx: number; cy: number; w: number; h: number; rotation: number };
	regionKind: HatchRegionKind;
	/** Parallelogram: extra x offset on bottom edge vs top (local space). */
	skew: number;
	/** Trapezoid: half-width at bottom (local); top uses w/2. */
	halfWBottom: number;
	/** Interior hatch band in local Y (same frame as guide lines). */
	localYMin: number;
	localYMax: number;
}

function pickRegionKind(): HatchRegionKind {
	const r = Math.random();
	if (r < 0.4) return 'rect';
	if (r < 0.75) return 'parallelogram';
	return 'trapezoid';
}

function hintLineIndices(lineCount: number): number[] {
	if (lineCount <= 1) return [0];
	if (lineCount === 2) return [0];
	const lo = Math.max(1, Math.floor(lineCount / 4));
	const hi = Math.min(lineCount - 2, lineCount - 1 - Math.floor(lineCount / 4));
	if (lo >= hi) return [Math.floor(lineCount / 2)];
	return [lo, hi];
}

function generateHatch(canvasW: number, canvasH: number, _toWorld?: CoordTransform): HatchParams {
	const minDim = Math.min(canvasW, canvasH);
	const lineCount = 8 + Math.floor(Math.random() * 13); // 8–20
	const regionKind = pickRegionKind();
	const angle = Math.random() * Math.PI;
	// Larger footprint so dense hatches stay readable
	const regionW = minDim * (0.28 + Math.random() * 0.22);
	const regionH = minDim * (0.24 + Math.random() * 0.18);
	const cx = canvasW * (0.22 + Math.random() * 0.56);
	const cy = canvasH * (0.22 + Math.random() * 0.56);
	const rotation = angle;

	const halfW = regionW / 2;
	const halfH = regionH / 2;
	const skew = regionKind === 'parallelogram' ? (Math.random() - 0.5) * regionW * 0.55 : 0;
	const halfWBottom =
		regionKind === 'trapezoid' ? halfW * (0.55 + Math.random() * 0.45) : halfW;

	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	// Inset from top/bottom so guides are never on the outer boundary (only internal strokes count).
	const insetY = Math.min(halfH * 0.08, regionH * 0.04);
	let yMin = -halfH + insetY;
	let yMax = halfH - insetY;
	if (yMax <= yMin + 1e-3) {
		yMin = -halfH * 0.35;
		yMax = halfH * 0.35;
	}
	const spacing = lineCount > 1 ? (yMax - yMin) / (lineCount - 1) : 0;

	const lines: LineParams[] = [];
	for (let i = 0; i < lineCount; i++) {
		const localY =
			lineCount === 1 ? (yMin + yMax) / 2 : yMin + ((yMax - yMin) * i) / (lineCount - 1);
		const { x0, x1 } = xExtentAtLocalY(regionKind, localY, halfW, halfH, skew, halfWBottom);
		const p0 = localToWorld(x0, localY, cx, cy, cos, sin);
		const p1 = localToWorld(x1, localY, cx, cy, cos, sin);
		lines.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
	}

	return {
		lines,
		angle,
		spacing,
		bounds: { cx, cy, w: regionW, h: regionH, rotation },
		regionKind,
		skew,
		halfWBottom,
		localYMin: yMin,
		localYMax: yMax
	};
}

/** Inverse of localToWorld for hatch frame (origin at bounds.cx, bounds.cy). */
export function worldToLocalHatch(wx: number, wy: number, p: HatchParams): { lx: number; ly: number } {
	const dx = wx - p.bounds.cx;
	const dy = wy - p.bounds.cy;
	const c = Math.cos(p.bounds.rotation);
	const s = Math.sin(p.bounds.rotation);
	return { lx: c * dx + s * dy, ly: -s * dx + c * dy };
}

/** After the first stroke: fill grows from the side of the band this centroid lies on. */
export function computeHatchFillFromLow(stroke: Stroke, p: HatchParams): boolean {
	const pts = getStrokePoints(stroke);
	if (pts.length === 0) return true;
	let sx = 0;
	let sy = 0;
	for (const q of pts) {
		sx += q.x;
		sy += q.y;
	}
	sx /= pts.length;
	sy /= pts.length;
	const { ly } = worldToLocalHatch(sx, sy, p);
	const mid = (p.localYMin + p.localYMax) / 2;
	return ly < mid;
}

type LocalPt = { x: number; y: number };

function intersectSegWithHorizontalY(a: LocalPt, b: LocalPt, yCut: number): LocalPt | null {
	if (Math.abs(b.y - a.y) < 1e-12) return null;
	const t = (yCut - a.y) / (b.y - a.y);
	if (t < -1e-8 || t > 1 + 1e-8) return null;
	return { x: a.x + t * (b.x - a.x), y: yCut };
}

/** Convex polygon clip: keep ly <= yCut. */
function clipConvexBelowY(poly: LocalPt[], yCut: number): LocalPt[] {
	const n = poly.length;
	if (n < 3) return [];
	const out: LocalPt[] = [];
	for (let i = 0; i < n; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % n];
		const aIn = a.y <= yCut + 1e-9;
		const bIn = b.y <= yCut + 1e-9;
		if (aIn && bIn) {
			out.push(b);
		} else if (aIn && !bIn) {
			const inter = intersectSegWithHorizontalY(a, b, yCut);
			if (inter) out.push(inter);
		} else if (!aIn && bIn) {
			const inter = intersectSegWithHorizontalY(a, b, yCut);
			if (inter) out.push(inter);
			out.push(b);
		}
	}
	return out;
}

/** Convex polygon clip: keep ly >= yCut. */
function clipConvexAboveY(poly: LocalPt[], yCut: number): LocalPt[] {
	const n = poly.length;
	if (n < 3) return [];
	const out: LocalPt[] = [];
	for (let i = 0; i < n; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % n];
		const aIn = a.y >= yCut - 1e-9;
		const bIn = b.y >= yCut - 1e-9;
		if (aIn && bIn) {
			out.push(b);
		} else if (aIn && !bIn) {
			const inter = intersectSegWithHorizontalY(a, b, yCut);
			if (inter) out.push(inter);
		} else if (!aIn && bIn) {
			const inter = intersectSegWithHorizontalY(a, b, yCut);
			if (inter) out.push(inter);
			out.push(b);
		}
	}
	return out;
}

/**
 * Progressive fill along the hatch sweep (perpendicular to guide lines), in world space.
 * `progress` ∈ [0, 1]; `fillFromLowY` true = grow from low local Y toward high.
 */
export function renderHatchFillProgress(
	ctx: CanvasRenderingContext2D,
	p: HatchParams,
	progress: number,
	fillFromLowY: boolean,
	lightTheme: boolean
): void {
	if (progress <= 0) return;
	const t = Math.min(1, Math.max(0, progress));
	const b = p.bounds;
	const cos = Math.cos(b.rotation);
	const sin = Math.sin(b.rotation);
	const halfW = b.w / 2;
	const halfH = b.h / 2;
	const cornersLocal = outlineCornersLocal(p.regionKind, halfW, halfH, p.skew, p.halfWBottom);
	// Sweep across the full outline in local Y so the last step fills the entire shape.
	const yLo = -halfH;
	const yHi = halfH;
	const span = yHi - yLo;
	let clipped: LocalPt[];
	if (fillFromLowY) {
		const yCut = yLo + t * span;
		clipped = clipConvexBelowY(cornersLocal, yCut);
	} else {
		const yCut = yHi - t * span;
		clipped = clipConvexAboveY(cornersLocal, yCut);
	}
	if (clipped.length < 3) return;

	ctx.save();
	ctx.beginPath();
	const p0 = localToWorld(clipped[0].x, clipped[0].y, b.cx, b.cy, cos, sin);
	ctx.moveTo(p0.x, p0.y);
	for (let i = 1; i < clipped.length; i++) {
		const w = localToWorld(clipped[i].x, clipped[i].y, b.cx, b.cy, cos, sin);
		ctx.lineTo(w.x, w.y);
	}
	ctx.closePath();
	ctx.fillStyle = lightTheme ? 'rgba(70, 120, 200, 0.16)' : 'rgba(100, 160, 255, 0.22)';
	ctx.fill();
	ctx.restore();
}

function scoreOneLine(points: StrokePoint[], line: LineParams): StrokeScore {
	const extra = highlightLineDivergent(points, line);
	return buildMetricScore(points, {
		pathDeviation: scoreLineAccuracy(points, line),
		smoothness: true,
		speedConsistency: true,
		endpointAccuracy: { start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 } },
		extraSegments: extra
	});
}

export const hatchingPlugin = defineExercise({
	id: 'hatching',
	unit: 'strokes',
	label: 'Hatching',
	icon: '≡',
	description: 'Draw even, parallel, evenly-spaced strokes — the foundation of shading.',
	availableModes: ['guided', 'challenge', 'free'],
	requiredStrokes: 14,
	defaultCount: 8,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const params = generateHatch(canvasW, canvasH, toWorld);
		return {
			unit: 'strokes',
			type: 'hatching',
			mode,
			strokeCount: params.lines.length,
			references: [{ type: 'hatching', params }],
			availableModes: ['guided', 'challenge', 'free']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as HatchParams;
		if (visibility === 'hidden') return;

		const b = p.bounds;
		const cos = Math.cos(b.rotation);
		const sin = Math.sin(b.rotation);
		const halfW = b.w / 2;
		const halfH = b.h / 2;

		ctx.save();
		ctx.strokeStyle = BOUNDARY_OUTLINE_COLOR;
		ctx.lineWidth = 1.25;
		ctx.setLineDash([4, 4]);
		const corners = outlineCornersLocal(p.regionKind, halfW, halfH, p.skew, p.halfWBottom).map((c) =>
			localToWorld(c.x, c.y, b.cx, b.cy, cos, sin)
		);
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (let i = 1; i < corners.length; i++) {
			ctx.lineTo(corners[i].x, corners[i].y);
		}
		ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.restore();

		if (visibility === 'full') {
			for (const line of p.lines) {
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = GUIDE_COLOR;
				ctx.lineWidth = 1.25;
				ctx.setLineDash([5, 5]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		} else {
			const idxs = hintLineIndices(p.lines.length);
			for (const idx of idxs) {
				const line = p.lines[idx];
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = GUIDE_COLOR;
				ctx.lineWidth = 1.35;
				ctx.setLineDash([6, 5]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number, mode: ExerciseMode): StrokeScore {
		const hp = reference.params as unknown as HatchParams;
		if (mode === 'free' || strokeIndex >= hp.lines.length) {
			return buildMetricScore(points, {
				pathDeviation: null,
				smoothness: true,
				speedConsistency: true
			});
		}
		const line = hp.lines[strokeIndex];
		return scoreOneLine(points, line);
	},

	scoreStrokesForRound(strokes: Stroke[], reference: ReferenceShape, mode: ExerciseMode): StrokeScore[] {
		const hp = reference.params as unknown as HatchParams;
		if (mode === 'free') {
			return strokes.map((s) => {
				const pts = getStrokePoints(s);
				return buildMetricScore(pts, { pathDeviation: null, smoothness: true, speedConsistency: true });
			});
		}
		const n = Math.min(strokes.length, hp.lines.length);
		const subStrokes = strokes.slice(0, n);
		const subLines = hp.lines.slice(0, n);
		const lineForStroke = assignStrokesToLinesMinCost(subStrokes, subLines);
		return subStrokes.map((stroke, si) => {
			const pts = getStrokePoints(stroke);
			const li = lineForStroke[si];
			const line = hp.lines[li];
			return scoreOneLine(pts, line);
		});
	},

	computeShapeScore(strokeScores: StrokeScore[]): number {
		if (strokeScores.length === 0) return 0;
		const compositeAvg = strokeScores.reduce((s, sc) => s + sc.composite, 0) / strokeScores.length;
		return Math.round(compositeAvg);
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		const chord = strokeChord(pts);
		return chord >= canvasW * 0.03;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as HatchParams;
		return { x: p.bounds.cx, y: p.bounds.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as HatchParams;
		const b = p.bounds;
		const cos = Math.cos(b.rotation);
		const sin = Math.sin(b.rotation);
		const halfW = b.w / 2;
		const halfH = b.h / 2;
		const outline = outlineCornersLocal(p.regionKind, halfW, halfH, p.skew, p.halfWBottom).map((c) =>
			localToWorld(c.x, c.y, b.cx, b.cy, cos, sin)
		);
		const allPts = [...p.lines.flatMap((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]), ...outline];
		const xs = allPts.map((pt) => pt.x);
		const ys = allPts.map((pt) => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10
		};
	}
});

registerExercise(hatchingPlugin);
