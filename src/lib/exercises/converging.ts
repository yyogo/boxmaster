import type { ExerciseConfig, ExerciseMode, LineParams, ReferenceShape } from './types';
import type { Stroke, StrokePoint } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, angleDiff } from './plugin';
import { registerExercise } from './registry';
import { GUIDE_COLOR, HINT_COLOR, drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';
import { assignStrokesToLinesMinCost } from './hatching-geometry';

export interface ConvergingParams {
	mode: ExerciseMode;
	vp: { x: number; y: number };
	witnessLines: [LineParams, LineParams];
	targetLines: LineParams[];
}

const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const WITNESS_COLOR = 'rgba(255, 200, 100, 0.85)';
const EXT_COLOR = 'rgba(255, 200, 100, 0.35)';
const USER_EXT_COLOR = 'rgba(200, 210, 255, 0.45)';
const EXTENSION_LEN = 9000;
const MIN_WITNESS_ANGLE = 0.18; // radians — keep witness family readable
const ANGLE_FULL_SCORE = Math.PI / 12; // 15° → 0 path points for angle component

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

function allGuideLines(p: ConvergingParams): LineParams[] {
	return [p.witnessLines[0], p.witnessLines[1], ...p.targetLines];
}

function segmentTowardVp(
	sx: number,
	sy: number,
	vp: { x: number; y: number },
	canvasW: number,
	canvasH: number,
): LineParams {
	const dx = vp.x - sx;
	const dy = vp.y - sy;
	const dist = Math.hypot(dx, dy);
	if (dist < 1e-6) return { x1: sx, y1: sy, x2: sx, y2: sy };
	const maxDim = Math.max(canvasW, canvasH);
	const lineLen = Math.min(dist * 0.88, maxDim * 0.78);
	const ux = dx / dist;
	const uy = dy / dist;
	return { x1: sx, y1: sy, x2: sx + ux * lineLen, y2: sy + uy * lineLen };
}

function witnessSeparation(w0: LineParams, w1: LineParams, vp: { x: number; y: number }): number {
	const a0 = Math.atan2(vp.y - w0.y1, vp.x - w0.x1);
	const a1 = Math.atan2(vp.y - w1.y1, vp.x - w1.x1);
	return angleDiff(a0, a1);
}

function randomEdgePoint(
	edge: number,
	t: number,
	canvasW: number,
	canvasH: number,
	margin: number,
): { x: number; y: number } {
	switch (edge) {
		case 0:
			return { x: margin + t * (canvasW - 2 * margin), y: canvasH - margin };
		case 1:
			return { x: margin + t * (canvasW - 2 * margin), y: margin };
		case 2:
			return { x: margin, y: margin + t * (canvasH - 2 * margin) };
		default:
			return { x: canvasW - margin, y: margin + t * (canvasH - 2 * margin) };
	}
}

function generateVp(canvasW: number, canvasH: number): { x: number; y: number } {
	const far = Math.random() < 0.38;
	const maxDim = Math.max(canvasW, canvasH);
	if (far) {
		const side = Math.floor(Math.random() * 4);
		const extra = (0.35 + Math.random() * 1.15) * maxDim;
		switch (side) {
			case 0:
				return { x: -extra, y: canvasH * (0.15 + Math.random() * 0.7) };
			case 1:
				return { x: canvasW + extra, y: canvasH * (0.15 + Math.random() * 0.7) };
			case 2:
				return { x: canvasW * (0.15 + Math.random() * 0.7), y: -extra };
			default:
				return { x: canvasW * (0.15 + Math.random() * 0.7), y: canvasH + extra };
		}
	}
	return {
		x: canvasW * (0.12 + Math.random() * 0.76),
		y: canvasH * (0.08 + Math.random() * 0.42),
	};
}

function generateConverging(
	vp: { x: number; y: number },
	canvasW: number,
	canvasH: number,
	mode: ExerciseMode,
): ConvergingParams | null {
	const margin = 48;
	const targetCount = 4 + Math.floor(Math.random() * 3); // 4–6

	for (let attempt = 0; attempt < 90; attempt++) {
		const edgeA = Math.floor(Math.random() * 4);
		let edgeB = Math.floor(Math.random() * 4);
		if (edgeB === edgeA) edgeB = (edgeA + 1 + Math.floor(Math.random() * 3)) % 4;

		const tA = 0.2 + Math.random() * 0.6;
		const tB = 0.2 + Math.random() * 0.6;
		const startA = randomEdgePoint(edgeA, tA, canvasW, canvasH, margin);
		const startB = randomEdgePoint(edgeB, tB, canvasW, canvasH, margin);

		const w0 = segmentTowardVp(startA.x, startA.y, vp, canvasW, canvasH);
		const w1 = segmentTowardVp(startB.x, startB.y, vp, canvasW, canvasH);

		if (witnessSeparation(w0, w1, vp) < MIN_WITNESS_ANGLE) continue;

		const witnessLines: [LineParams, LineParams] = [w0, w1];
		const occupied = [
			{ x: w0.x1, y: w0.y1 },
			{ x: w1.x1, y: w1.y1 },
		];
		const targetLines: LineParams[] = [];
		const minDim = Math.min(canvasW, canvasH);

		for (let k = 0; k < targetCount * 8 && targetLines.length < targetCount; k++) {
			const ax = margin + Math.random() * (canvasW - 2 * margin);
			const ay = margin + Math.random() * (canvasH - 2 * margin);

			let ok = true;
			for (const o of occupied) {
				if (Math.hypot(ax - o.x, ay - o.y) < minDim * 0.09) {
					ok = false;
					break;
				}
			}
			if (!ok) continue;

			const seg = segmentTowardVp(ax, ay, vp, canvasW, canvasH);
			const el = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
			if (el < minDim * 0.06) continue;

			targetLines.push(seg);
			occupied.push({ x: ax, y: ay });
		}

		if (targetLines.length < targetCount) continue;

		return { mode, vp, witnessLines, targetLines };
	}

	return null;
}

function generateFallback(
	vp: { x: number; y: number },
	canvasW: number,
	canvasH: number,
	mode: ExerciseMode,
): ConvergingParams {
	const margin = 56;
	const w0 = segmentTowardVp(margin, canvasH - margin, vp, canvasW, canvasH);
	const w1 = segmentTowardVp(canvasW - margin, margin, vp, canvasW, canvasH);
	const targetLines: LineParams[] = [];
	const cx = canvasW / 2;
	const cy = canvasH / 2;
	const pts = [
		{ x: cx - 80, y: cy - 40 },
		{ x: cx + 90, y: cy - 30 },
		{ x: cx - 60, y: cy + 70 },
		{ x: cx + 70, y: cy + 60 },
	];
	for (const pt of pts) {
		targetLines.push(segmentTowardVp(pt.x, pt.y, vp, canvasW, canvasH));
	}
	return { mode, vp, witnessLines: [w0, w1], targetLines };
}

function angleTowardVpScore(
	pts: StrokePoint[],
	anchor: { x: number; y: number },
	vp: { x: number; y: number },
): number {
	if (pts.length < 2) return 0;
	const s = pts[0];
	const e = pts[pts.length - 1];
	const chordAngle = Math.atan2(e.y - s.y, e.x - s.x);
	const ideal = Math.atan2(vp.y - anchor.y, vp.x - anchor.x);
	const dev = angleDiff(chordAngle, ideal);
	return Math.max(0, 100 - (dev / ANGLE_FULL_SCORE) * 100);
}

function startAnchorScore(pts: StrokePoint[], ax: number, ay: number, maxDist: number): number {
	if (pts.length < 1) return 0;
	const d = Math.hypot(pts[0].x - ax, pts[0].y - ay);
	return Math.max(0, Math.min(100, 100 - (d / maxDist) * 100));
}

function buildChallengeStrokeScore(pts: StrokePoint[], line: LineParams, vp: { x: number; y: number }): StrokeScore {
	const anchor = { x: line.x1, y: line.y1 };
	const refLen = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
	const maxStartDist = Math.max(28, refLen * 0.14);
	const angleSc = angleTowardVpScore(pts, anchor, vp);
	const lineAcc = scoreLineAccuracy(pts, line);
	const startSc = startAnchorScore(pts, anchor.x, anchor.y, maxStartDist);
	const combined = angleSc * 0.65 + lineAcc * 0.2 + startSc * 0.15;
	const extra = highlightLineDivergent(pts, line);
	return buildMetricScore(pts, {
		pathDeviation: combined,
		smoothness: true,
		speedConsistency: true,
		extraSegments: extra,
	});
}

function convergenceDiagnosis(p: ConvergingParams, strokes: Stroke[]): string {
	if (strokes.length !== p.targetLines.length) {
		return `Draw exactly ${p.targetLines.length} lines from the dots.`;
	}
	let lineForStroke: number[];
	try {
		lineForStroke = assignStrokesToLinesMinCost(strokes, p.targetLines);
	} catch {
		return 'Keep lines straight and start at each dot.';
	}
	const errs: number[] = [];
	for (let si = 0; si < strokes.length; si++) {
		const pts = getStrokePoints(strokes[si]);
		const line = p.targetLines[lineForStroke[si]];
		if (pts.length < 2) continue;
		const s = pts[0];
		const e = pts[pts.length - 1];
		const chordAngle = Math.atan2(e.y - s.y, e.x - s.x);
		const ideal = Math.atan2(p.vp.y - line.y1, p.vp.x - line.x1);
		errs.push(angleDiff(chordAngle, ideal));
	}
	if (errs.length === 0) return '';
	const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
	const deg = (meanErr * 180) / Math.PI;
	if (deg < 4) return 'Strong match to the witness convergence.';
	if (deg < 9) return 'Good convergence — minor angular drift.';
	if (deg < 16) return 'Noticeable drift from the witness family.';
	return 'Lines diverge — re-check direction toward the implied VP.';
}

function drawInfiniteLine(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	color: string,
	dash: number[],
) {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return;
	const ux = dx / len;
	const uy = dy / len;
	ctx.beginPath();
	ctx.moveTo(x1 - ux * EXTENSION_LEN, y1 - uy * EXTENSION_LEN);
	ctx.lineTo(x2 + ux * EXTENSION_LEN, y2 + uy * EXTENSION_LEN);
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.setLineDash(dash);
	ctx.stroke();
	ctx.setLineDash([]);
}

export const convergingPlugin = defineExercise({
	id: 'converging',
	unit: 'perspective',
	label: 'Converging Lines',
	icon: '⟩',
	description:
		'Tracing: follow guides to a VP. Challenge: infer convergence from two witness lines, then draw from each dot toward the same hidden VP.',
	availableModes: ['tracing', 'challenge', 'memory'],
	requiredStrokes: 8,
	defaultCount: 8,
	manualCompletionModes: ['challenge'],
	reviewAllowsDrawing: false,
	instructions:
		'Challenge: use the two witness lines to find the vanishing direction. Draw from each dot toward that VP. Done → review extensions → Done again to reveal VP → Next to score.',

	createSession(canvasW: number, canvasH: number): unknown {
		return { vp: generateVp(canvasW, canvasH) } as ConvergingSession;
	},

	generateFromSession(session: unknown, mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const s = session as ConvergingSession;
		let params = generateConverging(s.vp, canvasW, canvasH, mode) ?? generateFallback(s.vp, canvasW, canvasH, mode);

		const strokeCount = mode === 'tracing' ? 2 + params.targetLines.length : params.targetLines.length;

		return {
			unit: 'perspective',
			type: 'converging',
			mode,
			strokeCount,
			references: [{ type: 'converging', params }],
			availableModes: ['tracing', 'challenge', 'memory'],
		};
	},

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		const session = this.createSession!(canvasW, canvasH);
		return this.generateFromSession!(session, mode, canvasW, canvasH);
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		if (p.mode === 'challenge') return;
		drawDot(ctx, p.vp.x, p.vp.y, 6, VP_COLOR);
		drawCrosshair(ctx, p.vp.x, p.vp.y, 10, VP_COLOR);
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as ConvergingParams;
		if (visibility === 'hidden') return;

		if (p.mode === 'challenge') {
			for (const line of p.witnessLines) {
				ctx.beginPath();
				ctx.moveTo(line.x1, line.y1);
				ctx.lineTo(line.x2, line.y2);
				ctx.strokeStyle = WITNESS_COLOR;
				ctx.lineWidth = 2.25;
				ctx.stroke();
			}
			if (visibility === 'hints') {
				for (const line of p.targetLines) {
					drawDot(ctx, line.x1, line.y1, 4, HINT_COLOR);
				}
			} else {
				drawDot(ctx, p.vp.x, p.vp.y, 6, VP_COLOR);
				drawCrosshair(ctx, p.vp.x, p.vp.y, 10, VP_COLOR);
				for (const line of p.targetLines) {
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
			}
			return;
		}

		// Tracing
		if (visibility === 'full') {
			for (const line of allGuideLines(p)) {
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
		}
	},

	renderReview(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, strokes: Stroke[]) {
		const p = params as unknown as ConvergingParams;
		if (p.mode !== 'challenge') return;

		for (const line of p.witnessLines) {
			drawInfiniteLine(ctx, line.x1, line.y1, line.x2, line.y2, EXT_COLOR, [10, 8]);
		}
		for (const stroke of strokes) {
			const pts = getStrokePoints(stroke);
			if (pts.length < 2) continue;
			const s = pts[0];
			const e = pts[pts.length - 1];
			drawInfiniteLine(ctx, s.x, s.y, e.x, e.y, USER_EXT_COLOR, [6, 10]);
		}

		const msg = convergenceDiagnosis(p, strokes);
		if (msg) {
			ctx.font = '13px system-ui, sans-serif';
			ctx.fillStyle = 'rgba(220, 225, 245, 0.92)';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const pad = 14;
			ctx.fillText(msg, pad, pad);
		}
	},

	scoreStroke(points: StrokePoint[], reference: ReferenceShape, strokeIndex: number, mode: ExerciseMode): StrokeScore {
		const p = reference.params as unknown as ConvergingParams;
		const lines = mode === 'tracing' ? allGuideLines(p) : p.targetLines;
		if (strokeIndex >= lines.length) {
			return buildMetricScore(points, { smoothness: true, speedConsistency: true });
		}
		const line = lines[strokeIndex];
		if (mode === 'challenge') {
			return buildChallengeStrokeScore(points, line, p.vp);
		}
		const extra = highlightLineDivergent(points, line);
		return buildMetricScore(points, {
			pathDeviation: scoreLineAccuracy(points, line),
			smoothness: true,
			speedConsistency: true,
			endpointAccuracy: {
				start: { x: line.x1, y: line.y1 },
				end: { x: line.x2, y: line.y2 },
			},
			extraSegments: extra,
		});
	},

	scoreStrokesForRound(strokes: Stroke[], reference: ReferenceShape, mode: ExerciseMode): StrokeScore[] {
		const p = reference.params as unknown as ConvergingParams;

		if (mode === 'challenge') {
			if (strokes.length !== p.targetLines.length) {
				return strokes.map((stroke) => {
					const pts = getStrokePoints(stroke);
					return buildMetricScore(pts, {
						smoothness: true,
						speedConsistency: true,
						pathDeviation: 18,
					});
				});
			}
			const lineForStroke = assignStrokesToLinesMinCost(strokes, p.targetLines);
			return strokes.map((stroke, si) => {
				const pts = getStrokePoints(stroke);
				const li = lineForStroke[si];
				return buildChallengeStrokeScore(pts, p.targetLines[li], p.vp);
			});
		}

		const guides = allGuideLines(p);
		if (strokes.length !== guides.length) {
			return strokes.map((stroke) => {
				const pts = getStrokePoints(stroke);
				return buildMetricScore(pts, { smoothness: true, speedConsistency: true });
			});
		}
		const lineForStroke = assignStrokesToLinesMinCost(strokes, guides);
		return strokes.map((stroke, si) => {
			const pts = getStrokePoints(stroke);
			const li = lineForStroke[si];
			const line = guides[li];
			const extra = highlightLineDivergent(pts, line);
			return buildMetricScore(pts, {
				pathDeviation: scoreLineAccuracy(pts, line),
				smoothness: true,
				speedConsistency: true,
				endpointAccuracy: {
					start: { x: line.x1, y: line.y1 },
					end: { x: line.x2, y: line.y2 },
				},
				extraSegments: extra,
			});
		});
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		canvasW: number,
		_canvasH: number,
		_mode: ExerciseMode,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		return strokeChord(pts) >= canvasW * 0.05;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		const all = allGuideLines(p).flatMap((l) => [
			{ x: l.x1, y: l.y1 },
			{ x: l.x2, y: l.y2 },
		]);
		return {
			x: all.reduce((s, pt) => s + pt.x, 0) / all.length,
			y: all.reduce((s, pt) => s + pt.y, 0) / all.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as ConvergingParams;
		const all = [
			p.vp,
			...allGuideLines(p).flatMap((l) => [
				{ x: l.x1, y: l.y1 },
				{ x: l.x2, y: l.y2 },
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

registerExercise(convergingPlugin);
