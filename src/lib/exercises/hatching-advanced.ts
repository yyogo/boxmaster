import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { BOUNDARY_OUTLINE_COLOR, GUIDE_COLOR, scoreLineAccuracy, highlightLineDivergent } from './utils';
import {
	ellipseHorizontalChords,
	transformLine,
	localToWorld,
	chordInConvexPolygon,
	projectRangeOnNormal,
	assignStrokesToLinesMinCost
} from './hatching-geometry';

export type HatchAdvancedKind = 'ellipse' | 'polygon' | 'blob';

export interface HatchAdvancedParams {
	kind: HatchAdvancedKind;
	lines: LineParams[];
	/** Closed path for dashed outline (world space). */
	outline: { x: number; y: number }[];
	cx: number;
	cy: number;
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

function sampleEllipseOutline(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	rot: number,
	steps: number
): { x: number; y: number }[] {
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = (i / steps) * Math.PI * 2;
		const lx = rx * Math.cos(t);
		const ly = ry * Math.sin(t);
		pts.push(localToWorld(lx, ly, cx, cy, cos, sin));
	}
	return pts;
}

function randomConvexBlob(
	cx: number,
	cy: number,
	baseR: number,
	n: number,
	jitter: number
): { x: number; y: number }[] {
	const angles: number[] = [];
	for (let i = 0; i < n; i++) {
		angles.push((i / n) * Math.PI * 2 + (Math.random() - 0.5) * jitter);
	}
	angles.sort((a, b) => a - b);
	return angles.map((th) => {
		const rad = baseR * (0.62 + Math.random() * 0.48);
		return { x: cx + Math.cos(th) * rad, y: cy + Math.sin(th) * rad };
	});
}

function parallelChordsInPolygon(
	poly: { x: number; y: number }[],
	lineCount: number,
	strokeAngle: number,
	marginFrac = 0.05
): LineParams[] {
	const d = { x: Math.cos(strokeAngle), y: Math.sin(strokeAngle) };
	const n = { x: -d.y, y: d.x };
	const { min, max } = projectRangeOnNormal(poly, n.x, n.y);
	const span = max - min;
	const margin = span * marginFrac;
	const lo = min + margin;
	const hi = max - margin;
	const lines: LineParams[] = [];
	if (lineCount < 1 || hi <= lo) return lines;
	for (let i = 0; i < lineCount; i++) {
		const s = lineCount === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (lineCount - 1);
		const chord = chordInConvexPolygon(poly, d, n, s);
		if (chord) lines.push(chord);
	}
	return lines;
}

function generateAdvanced(canvasW: number, canvasH: number, _toWorld?: CoordTransform): HatchAdvancedParams {
	const minDim = Math.min(canvasW, canvasH);
	const lineCount = 8 + Math.floor(Math.random() * 13);
	const roll = Math.random();
	const kind: HatchAdvancedKind = roll < 0.38 ? 'ellipse' : roll < 0.72 ? 'polygon' : 'blob';

	const cx = canvasW * (0.22 + Math.random() * 0.56);
	const cy = canvasH * (0.22 + Math.random() * 0.56);

	if (kind === 'ellipse') {
		const rx = minDim * (0.11 + Math.random() * 0.14);
		const ry = minDim * (0.09 + Math.random() * 0.13);
		const rot = Math.random() * Math.PI;
		const linesLocal = ellipseHorizontalChords(rx, ry, lineCount);
		const cos = Math.cos(rot);
		const sin = Math.sin(rot);
		const lines = linesLocal.map((l) => transformLine(l, cx, cy, cos, sin));
		const outline = sampleEllipseOutline(cx, cy, rx, ry, rot, 72);
		return { kind, lines, outline, cx, cy };
	}

	const nVerts = kind === 'blob' ? 7 + Math.floor(Math.random() * 5) : 5 + Math.floor(Math.random() * 4);
	const baseR = minDim * (0.14 + Math.random() * 0.12);
	const jitter = kind === 'blob' ? 0.55 : 0.22;
	let poly = randomConvexBlob(cx, cy, baseR, nVerts, jitter);
	let strokeAngle = Math.random() * Math.PI;
	let lines: LineParams[] = [];
	for (let attempt = 0; attempt < 12; attempt++) {
		for (const mf of [0.05, 0.03, 0.015, 0.008]) {
			lines = parallelChordsInPolygon(poly, lineCount, strokeAngle, mf);
			if (lines.length >= lineCount) break;
		}
		if (lines.length >= lineCount) break;
		strokeAngle += 0.28 + Math.random() * 0.2;
		if (attempt % 4 === 3) {
			poly = randomConvexBlob(cx, cy, baseR * (0.9 + Math.random() * 0.2), nVerts, jitter);
		}
	}
	if (lines.length < lineCount) {
		// Fallback: ellipse always yields full chord count
		const rx = minDim * (0.12 + Math.random() * 0.1);
		const ry = minDim * (0.1 + Math.random() * 0.1);
		const rot = Math.random() * Math.PI;
		const linesLocal = ellipseHorizontalChords(rx, ry, lineCount);
		const cos = Math.cos(rot);
		const sin = Math.sin(rot);
		lines = linesLocal.map((l) => transformLine(l, cx, cy, cos, sin));
		const outline = sampleEllipseOutline(cx, cy, rx, ry, rot, 72);
		return { kind: 'ellipse', lines, outline, cx, cy };
	}
	return { kind, lines, outline: [...poly, poly[0]], cx, cy };
}

function hintLineIndices(lineCount: number): number[] {
	if (lineCount <= 1) return [0];
	if (lineCount === 2) return [0];
	const lo = Math.max(1, Math.floor(lineCount / 4));
	const hi = Math.min(lineCount - 2, lineCount - 1 - Math.floor(lineCount / 4));
	if (lo >= hi) return [Math.floor(lineCount / 2)];
	return [lo, hi];
}

export const hatchingAdvancedPlugin = defineExercise({
	id: 'hatching-advanced',
	unit: 'strokes',
	label: 'Contour hatching',
	icon: '⌇',
	description:
		'Parallel hatching inside curved or irregular silhouettes — practice maintaining spacing and direction on real forms.',
	availableModes: ['tracing', 'challenge', 'free'],
	requiredStrokes: 14,
	defaultCount: 6,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const params = generateAdvanced(canvasW, canvasH, toWorld);
		return {
			unit: 'strokes',
			type: 'hatching-advanced',
			mode,
			strokeCount: params.lines.length,
			references: [{ type: 'hatching-advanced', params }],
			availableModes: ['tracing', 'challenge', 'free']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as HatchAdvancedParams;
		if (visibility === 'hidden') return;

		ctx.save();
		ctx.strokeStyle = BOUNDARY_OUTLINE_COLOR;
		ctx.lineWidth = 1.25;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		const o = p.outline;
		if (o.length > 0) {
			ctx.moveTo(o[0].x, o[0].y);
			for (let i = 1; i < o.length; i++) ctx.lineTo(o[i].x, o[i].y);
			ctx.closePath();
		}
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
			for (const idx of hintLineIndices(p.lines.length)) {
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
		const hp = reference.params as unknown as HatchAdvancedParams;
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
		const hp = reference.params as unknown as HatchAdvancedParams;
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
		const p = params as unknown as HatchAdvancedParams;
		return { x: p.cx, y: p.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as HatchAdvancedParams;
		const allPts = [...p.lines.flatMap((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]), ...p.outline];
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

registerExercise(hatchingAdvancedPlugin);
