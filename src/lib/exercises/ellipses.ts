import type { ExerciseConfig, ExerciseMode, EllipseParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot } from './utils';

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

function scoreEllipseAccuracy(points: StrokePoint[], ellipse: EllipseParams): number {
	const cos = Math.cos(-ellipse.rotation);
	const sin = Math.sin(-ellipse.rotation);
	let totalDist = 0;
	for (const p of points) {
		const dx = p.x - ellipse.cx;
		const dy = p.y - ellipse.cy;
		const lx = cos * dx - sin * dy;
		const ly = sin * dx + cos * dy;
		const norm = (lx / ellipse.rx) ** 2 + (ly / ellipse.ry) ** 2;
		totalDist += Math.abs(Math.sqrt(norm) - 1) * Math.max(ellipse.rx, ellipse.ry);
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 40) * 100));
}

export const ellipsePlugin = defineExercise({
	id: 'ellipse',
	unit: 'basic-shapes',
	label: 'Ellipses',
	icon: '⬮',
	description: 'Draw ellipses at various orientations. Keep your strokes smooth and even.',
	availableModes: ['tracing', 'challenge', 'memory'],
	requiredStrokes: 1,
	defaultCount: 20,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const minDim = Math.min(canvasW, canvasH);
		const rx = minDim * (0.06 + Math.random() * 0.12);
		const ratio = 0.4 + Math.random() * 0.5;
		const ry = rx * ratio;
		const rotation = Math.random() * Math.PI;

		const maxR = Math.max(rx, ry);
		const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: maxR * 2, h: maxR * 2 }), 30, 18);
		const slot = slots[0];
		const center = toWorld
			? toWorld(slot.x + slot.w / 2, slot.y + slot.h / 2)
			: { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
		const params: EllipseParams = { cx: center.x, cy: center.y, rx, ry, rotation };

		return {
			unit: 'basic-shapes',
			type: 'ellipse',
			mode,
			strokeCount: 1,
			references: [{ type: 'ellipse', params }],
			availableModes: ['tracing', 'challenge', 'memory'],
		};
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as EllipseParams;
		if (visibility === 'hidden') return;

		if (visibility === 'full') {
			ctx.beginPath();
			ctx.ellipse(p.cx, p.cy, p.rx, p.ry, p.rotation, 0, Math.PI * 2);
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
			drawCrosshair(ctx, p.cx, p.cy, 6, GUIDE_COLOR);
		} else {
			drawCrosshair(ctx, p.cx, p.cy, 8, HINT_COLOR);
			const cos = Math.cos(p.rotation);
			const sin = Math.sin(p.rotation);
			const ax1 = { x: p.cx + cos * p.rx, y: p.cy + sin * p.rx };
			const ax2 = { x: p.cx - cos * p.rx, y: p.cy - sin * p.rx };
			const bx1 = { x: p.cx - sin * p.ry, y: p.cy + cos * p.ry };
			const bx2 = { x: p.cx + sin * p.ry, y: p.cy - cos * p.ry };

			ctx.beginPath();
			ctx.moveTo(ax1.x, ax1.y);
			ctx.lineTo(ax2.x, ax2.y);
			ctx.moveTo(bx1.x, bx1.y);
			ctx.lineTo(bx2.x, bx2.y);
			ctx.strokeStyle = HINT_COLOR;
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.stroke();
			ctx.setLineDash([]);

			drawDot(ctx, ax1.x, ax1.y, 3, HINT_COLOR);
			drawDot(ctx, ax2.x, ax2.y, 3, HINT_COLOR);
			drawDot(ctx, bx1.x, bx1.y, 3, HINT_COLOR);
			drawDot(ctx, bx2.x, bx2.y, 3, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as EllipseParams;
		const perimeter = Math.PI * (3 * (p.rx + p.ry) - Math.sqrt((3 * p.rx + p.ry) * (p.rx + 3 * p.ry)));
		return buildMetricScore(points, {
			pathDeviation: scoreEllipseAccuracy(points, p),
			smoothness: true,
			speedConsistency: true,
			closureGap: { perimeter },
		});
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		_canvasW: number,
		_canvasH: number,
		_mode: ExerciseMode,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 3) return false;
		const p = reference.params as unknown as EllipseParams;
		const maxR = Math.max(p.rx, p.ry);

		const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
		const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
		const dist = Math.sqrt((cx - p.cx) ** 2 + (cy - p.cy) ** 2);
		if (dist > maxR * 2.5) return false;

		const arc = strokeArcLen(pts);
		const approxPerimeter = Math.PI * (3 * (p.rx + p.ry) - Math.sqrt((3 * p.rx + p.ry) * (p.rx + 3 * p.ry)));
		return arc >= approxPerimeter * 0.2;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as EllipseParams;
		return { x: p.cx, y: p.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as EllipseParams;
		const maxR = Math.max(p.rx, p.ry);
		return { minX: p.cx - maxR - 10, minY: p.cy - maxR - 10, maxX: p.cx + maxR + 10, maxY: p.cy + maxR + 10 };
	},
});

registerExercise(ellipsePlugin);
