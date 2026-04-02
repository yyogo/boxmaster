import type { ExerciseConfig, ExerciseMode, CircleParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildStrokeScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';

const GUIDE_COLOR = 'rgba(100, 160, 255, 0.6)';
const HINT_COLOR = 'rgba(100, 160, 255, 0.5)';

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

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

function scoreCircleAccuracy(points: StrokePoint[], circle: CircleParams): number {
	let totalDist = 0;
	for (const p of points) {
		const d = Math.sqrt((p.x - circle.cx) ** 2 + (p.y - circle.cy) ** 2);
		totalDist += Math.abs(d - circle.r);
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 40) * 100));
}

export const circlePlugin = defineExercise({
	id: 'circle',
	unit: 'basic-shapes',
	label: 'Circles',
	icon: '○',
	description: 'Draw circles. Aim for round, even shapes with a single confident stroke.',
	availableModes: ['guided', 'semi-guided'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const minDim = Math.min(canvasW, canvasH);
		const r = minDim * (0.05 + Math.random() * 0.13);

		const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: r * 2, h: r * 2 }), 30, 18);
		const slot = slots[0];
		const center = toWorld
			? toWorld(slot.x + slot.w / 2, slot.y + slot.h / 2)
			: { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
		const params: CircleParams = { cx: center.x, cy: center.y, r };
		return {
			unit: 'basic-shapes',
			type: 'circle',
			mode,
			strokeCount: 1,
			references: [{ type: 'circle', params }],
			availableModes: ['guided', 'semi-guided']
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as CircleParams;
		if (visibility === 'hidden') return;

		if (visibility === 'full') {
			ctx.beginPath();
			ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
			drawCrosshair(ctx, p.cx, p.cy, 6, GUIDE_COLOR);
		} else {
			drawCrosshair(ctx, p.cx, p.cy, 8, HINT_COLOR);
			const angle = (p.cx * 7 + p.cy * 13) % (Math.PI * 2);
			const rx = p.cx + Math.cos(angle) * p.r;
			const ry = p.cy + Math.sin(angle) * p.r;
			ctx.beginPath();
			ctx.moveTo(p.cx, p.cy);
			ctx.lineTo(rx, ry);
			ctx.strokeStyle = HINT_COLOR;
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.stroke();
			ctx.setLineDash([]);
			drawDot(ctx, rx, ry, 3, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as CircleParams;
		return buildStrokeScore(scoreCircleAccuracy(points, p), points);
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, _canvasW: number, _canvasH: number, _mode: ExerciseMode): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 3) return false;
		const p = reference.params as unknown as CircleParams;

		// Stroke centroid should be within 2x radius of center
		const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
		const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
		const dist = Math.sqrt((cx - p.cx) ** 2 + (cy - p.cy) ** 2);
		if (dist > p.r * 2.5) return false;

		// Arc length should be at least 20% of circumference
		const arc = strokeArcLen(pts);
		return arc >= p.r * 2 * Math.PI * 0.2;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as CircleParams;
		return { x: p.cx, y: p.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as CircleParams;
		return { minX: p.cx - p.r - 10, minY: p.cy - p.r - 10, maxX: p.cx + p.r + 10, maxY: p.cy + p.r + 10 };
	}
});

registerExercise(circlePlugin);
