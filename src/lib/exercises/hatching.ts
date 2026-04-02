import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, strokeArcLen, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

export interface HatchParams {
	lines: LineParams[];
	angle: number;
	spacing: number;
	bounds: { cx: number; cy: number; w: number; h: number; rotation: number };
}

function generateHatch(canvasW: number, canvasH: number, _toWorld?: CoordTransform): HatchParams {
	const minDim = Math.min(canvasW, canvasH);
	const lineCount = 6 + Math.floor(Math.random() * 5); // 6-10
	const angle = Math.random() * Math.PI;
	const regionW = minDim * (0.25 + Math.random() * 0.20);
	const regionH = minDim * (0.20 + Math.random() * 0.15);
	const cx = canvasW * (0.25 + Math.random() * 0.5);
	const cy = canvasH * (0.25 + Math.random() * 0.5);
	const rotation = angle;

	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const spacing = regionH / (lineCount - 1);
	const halfW = regionW / 2;
	const halfH = regionH / 2;

	const lines: LineParams[] = [];
	for (let i = 0; i < lineCount; i++) {
		const localY = -halfH + i * spacing;
		const lx1 = -halfW, ly1 = localY;
		const lx2 = halfW, ly2 = localY;
		lines.push({
			x1: cx + cos * lx1 - sin * ly1,
			y1: cy + sin * lx1 + cos * ly1,
			x2: cx + cos * lx2 - sin * ly2,
			y2: cy + sin * lx2 + cos * ly2,
		});
	}

	return { lines, angle, spacing, bounds: { cx, cy, w: regionW, h: regionH, rotation } };
}

export const hatchingPlugin = defineExercise({
	id: 'hatching',
	unit: 'strokes',
	label: 'Hatching',
	icon: '≡',
	description: 'Draw even, parallel, evenly-spaced strokes — the foundation of shading.',
	availableModes: ['guided', 'challenge', 'free'],
	requiredStrokes: 8,
	defaultCount: 8,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const params = generateHatch(canvasW, canvasH, toWorld);
		return {
			unit: 'strokes',
			type: 'hatching',
			mode,
			strokeCount: params.lines.length,
			references: [{ type: 'hatching', params }],
			availableModes: ['guided', 'challenge', 'free'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as HatchParams;
		if (visibility === 'hidden') return;

		const b = p.bounds;
		ctx.save();
		ctx.translate(b.cx, b.cy);
		ctx.rotate(b.rotation);
		ctx.strokeStyle = HINT_COLOR;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
		ctx.setLineDash([]);
		ctx.restore();

		if (visibility === 'full') {
			for (const line of p.lines) {
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = GUIDE_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([6, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		} else {
			// Challenge: show only first and last line
			const first = p.lines[0];
			const last = p.lines[p.lines.length - 1];
			for (const line of [first, last]) {
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = HINT_COLOR;
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number, mode: ExerciseMode): StrokeScore {
		const p = reference.params as unknown as HatchParams;
		if (mode === 'free' || strokeIndex >= p.lines.length) {
			return buildMetricScore(points, {
				pathDeviation: null,
				smoothness: true,
				speedConsistency: true,
			});
		}
		const line = p.lines[strokeIndex];
		const extra = highlightLineDivergent(points, line);
		return buildMetricScore(points, {
			pathDeviation: scoreLineAccuracy(points, line),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: { start: { x: line.x1, y: line.y1 }, end: { x: line.x2, y: line.y2 } },
			extraSegments: extra,
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
		const allPts = p.lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]);
		const xs = allPts.map(pt => pt.x);
		const ys = allPts.map(pt => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

registerExercise(hatchingPlugin);
