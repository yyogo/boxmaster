import type { ExerciseConfig, ExerciseMode, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { placeNonOverlapping } from './placement';
import { defineExercise, buildMetricScore, getStrokePoints, strokeArcLen, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot } from './utils';

export interface SphereContourParams {
	cx: number;
	cy: number;
	r: number;
	tilt: number;
	rotation: number;
	/** Signed distance of the cutting plane from the sphere center along the
	 *  tilt axis. 0 = great circle; non-zero = small circle. */
	offset: number;
	hintStart: number;
	hintSpan: number;
}

const SPHERE_COLOR = 'rgba(180, 200, 230, 0.35)';
const HINT_ARC_COLOR = 'rgba(100, 200, 160, 0.8)';

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

/** Projected ellipse geometry for a contour circle (great or small) on the sphere. */
function contourEllipse(p: SphereContourParams): {
	ecx: number; ecy: number; rx: number; ry: number;
} {
	const rSmall = Math.sqrt(p.r * p.r - p.offset * p.offset);
	const rx = rSmall;
	const ry = rSmall * Math.abs(Math.cos(p.tilt));
	const shift = p.offset * Math.sin(p.tilt);
	return {
		ecx: p.cx - shift * Math.sin(p.rotation),
		ecy: p.cy + shift * Math.cos(p.rotation),
		rx,
		ry,
	};
}

function contourPerimeter(rx: number, ry: number): number {
	return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

function scoreContourAccuracy(points: StrokePoint[], params: SphereContourParams): number {
	const { ecx, ecy, rx, ry } = contourEllipse(params);
	const cos = Math.cos(-params.rotation);
	const sin = Math.sin(-params.rotation);
	let totalDist = 0;
	for (const p of points) {
		const dx = p.x - ecx;
		const dy = p.y - ecy;
		const lx = cos * dx - sin * dy;
		const ly = sin * dx + cos * dy;
		const norm = (lx / rx) ** 2 + (ly / ry) ** 2;
		totalDist += Math.abs(Math.sqrt(norm) - 1) * Math.max(rx, ry);
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 40) * 100));
}

function ellipsePoint(
	cx: number, cy: number, rx: number, ry: number, rotation: number, t: number,
): { x: number; y: number } {
	const cosR = Math.cos(rotation);
	const sinR = Math.sin(rotation);
	const ex = rx * Math.cos(t);
	const ey = ry * Math.sin(t);
	return { x: cx + cosR * ex - sinR * ey, y: cy + sinR * ex + cosR * ey };
}

export const sphereContourPlugin = defineExercise({
	id: 'sphere-contour',
	unit: 'basic-shapes',
	label: 'Sphere Contours',
	icon: '◑',
	description: 'Draw cross-contour lines around a sphere. Train your sense of 3D form with confident, wraparound strokes.',
	availableModes: ['tracing', 'challenge'],
	requiredStrokes: 1,
	defaultCount: 15,

	generate(mode: ExerciseMode, canvasW: number, canvasH: number, toWorld?: CoordTransform): ExerciseConfig {
		const minDim = Math.min(canvasW, canvasH);
		const r = minDim * (0.08 + Math.random() * 0.12);

		const slots = placeNonOverlapping(1, canvasW, canvasH, () => ({ w: r * 2, h: r * 2 }), 30, 18);
		const slot = slots[0];
		const center = toWorld
			? toWorld(slot.x + slot.w / 2, slot.y + slot.h / 2)
			: { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };

		const tiltDeg = 15 + Math.random() * 60;
		const tilt = (tiltDeg * Math.PI) / 180;
		const rotation = Math.random() * Math.PI;

		// ~50% great circles, ~50% small circles
		let offset = 0;
		if (Math.random() < 0.5) {
			const sign = Math.random() < 0.5 ? 1 : -1;
			offset = sign * r * (0.2 + Math.random() * 0.5);
		}

		const hintStart = Math.random() * Math.PI * 2;
		const hintSpan = Math.PI / 3 + Math.random() * (Math.PI / 6);

		const params: SphereContourParams = {
			cx: center.x, cy: center.y, r,
			tilt, rotation, offset, hintStart, hintSpan,
		};

		return {
			unit: 'basic-shapes',
			type: 'sphere-contour',
			mode,
			strokeCount: 1,
			references: [{ type: 'sphere-contour', params }],
			availableModes: ['tracing', 'challenge'],
		};
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as SphereContourParams;
		ctx.beginPath();
		ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
		ctx.strokeStyle = SPHERE_COLOR;
		ctx.lineWidth = 2;
		ctx.stroke();
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as SphereContourParams;
		if (visibility === 'hidden') return;

		const { ecx, ecy, rx, ry } = contourEllipse(p);

		if (visibility === 'full') {
			ctx.beginPath();
			ctx.ellipse(ecx, ecy, rx, ry, p.rotation, 0, Math.PI * 2);
			ctx.strokeStyle = GUIDE_COLOR;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([6, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		drawCrosshair(ctx, ecx, ecy, 6, HINT_COLOR);

		ctx.beginPath();
		ctx.ellipse(ecx, ecy, rx, ry, p.rotation, p.hintStart, p.hintStart + p.hintSpan);
		ctx.strokeStyle = HINT_ARC_COLOR;
		ctx.lineWidth = 2.5;
		ctx.stroke();

		if (p.offset === 0) {
			const touch1 = ellipsePoint(ecx, ecy, rx, ry, p.rotation, 0);
			const touch2 = ellipsePoint(ecx, ecy, rx, ry, p.rotation, Math.PI);
			drawDot(ctx, touch1.x, touch1.y, 3.5, HINT_COLOR);
			drawDot(ctx, touch2.x, touch2.y, 3.5, HINT_COLOR);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape): StrokeScore {
		const p = reference.params as unknown as SphereContourParams;
		const { rx, ry } = contourEllipse(p);
		const perimeter = contourPerimeter(rx, ry);
		return buildMetricScore(points, {
			pathDeviation: scoreContourAccuracy(points, p),
			smoothness: true,
			speedConsistency: true,
			closureGap: { perimeter },
		});
	},

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 3) return false;
		const p = reference.params as unknown as SphereContourParams;
		const { ecx, ecy, rx, ry } = contourEllipse(p);

		const sx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
		const sy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
		const dist = Math.sqrt((sx - ecx) ** 2 + (sy - ecy) ** 2);
		if (dist > p.r * 2.5) return false;

		const arc = strokeArcLen(pts);
		return arc >= contourPerimeter(rx, ry) * 0.2;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as SphereContourParams;
		return { x: p.cx, y: p.cy };
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as SphereContourParams;
		return {
			minX: p.cx - p.r - 10,
			minY: p.cy - p.r - 10,
			maxX: p.cx + p.r + 10,
			maxY: p.cy + p.r + 10,
		};
	},
});

registerExercise(sphereContourPlugin);
