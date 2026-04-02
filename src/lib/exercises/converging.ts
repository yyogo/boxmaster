import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, angleDiff, type CoordTransform } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

export interface ConvergingParams {
	vp: { x: number; y: number };
	lines: LineParams[];
}

const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';

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

interface ConvergingSession {
	vp: { x: number; y: number };
}

function generateConverging(
	vp: { x: number; y: number },
	canvasW: number,
	canvasH: number,
): ConvergingParams {
	const lineCount = 5 + Math.floor(Math.random() * 3); // 5-7
	const lines: LineParams[] = [];
	const margin = 40;

	// Pick which edge of the canvas to start lines from
	const edge = Math.floor(Math.random() * 4);

	for (let i = 0; i < lineCount; i++) {
		let sx: number, sy: number;
		const t = (i + 0.5) / lineCount;
		switch (edge) {
			case 0: sx = margin + t * (canvasW - 2 * margin); sy = canvasH - margin; break; // bottom
			case 1: sx = margin + t * (canvasW - 2 * margin); sy = margin; break; // top
			case 2: sx = margin; sy = margin + t * (canvasH - 2 * margin); break; // left
			default: sx = canvasW - margin; sy = margin + t * (canvasH - 2 * margin); break; // right
		}

		// Line goes from (sx, sy) toward VP, but clip at a reasonable length
		const dx = vp.x - sx;
		const dy = vp.y - sy;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const lineLen = Math.min(dist * 0.85, Math.max(canvasW, canvasH) * 0.7);
		const ex = sx + (dx / dist) * lineLen;
		const ey = sy + (dy / dist) * lineLen;

		lines.push({ x1: sx, y1: sy, x2: ex, y2: ey });
	}

	return { vp, lines };
}

export const convergingPlugin = defineExercise({
	id: 'converging',
	unit: 'perspective',
	label: 'Converging Lines',
	icon: '⟩',
	description: 'Draw lines that converge toward a vanishing point — builds perspective intuition.',
	availableModes: ['guided', 'challenge'],
	requiredStrokes: 6,
	defaultCount: 8,

	createSession(canvasW: number, canvasH: number): unknown {
		// VP can be on-canvas or slightly off
		const vpX = canvasW * (0.1 + Math.random() * 0.8);
		const vpY = canvasH * (0.1 + Math.random() * 0.3);
		return { vp: { x: vpX, y: vpY } } as ConvergingSession;
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const s = session as ConvergingSession;
		const params = generateConverging(s.vp, canvasW, canvasH);
		return {
			unit: 'perspective',
			type: 'converging',
			mode,
			strokeCount: params.lines.length,
			references: [{ type: 'converging', params }],
			availableModes: ['guided', 'challenge'],
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const session = this.createSession!(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		drawDot(ctx, p.vp.x, p.vp.y, 6, VP_COLOR);
		drawCrosshair(ctx, p.vp.x, p.vp.y, 10, VP_COLOR);
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as ConvergingParams;
		if (visibility === 'hidden') return;

		if (visibility === 'full') {
			for (const line of p.lines) {
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = GUIDE_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([8, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
				drawDot(ctx, line.x1, line.y1, 3, GUIDE_COLOR);
			}
		} else {
			// Challenge: only show start dots
			for (const line of p.lines) {
				drawDot(ctx, line.x1, line.y1, 4, HINT_COLOR);
			}
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number): StrokeScore {
		const p = reference.params as unknown as ConvergingParams;
		if (strokeIndex >= p.lines.length) {
			return buildMetricScore(points, { smoothness: true, speedConsistency: true });
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

	isStrokeRelevant(stroke: Stroke, reference: ReferenceShape, canvasW: number): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		return strokeChord(pts) >= canvasW * 0.05;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		const all = p.lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]);
		return {
			x: all.reduce((s, pt) => s + pt.x, 0) / all.length,
			y: all.reduce((s, pt) => s + pt.y, 0) / all.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		const all = [p.vp, ...p.lines.flatMap(l => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])];
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

registerExercise(convergingPlugin);
