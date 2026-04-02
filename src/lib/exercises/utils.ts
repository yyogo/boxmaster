import type { StrokePoint } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';
import type { CurveParams } from './types';
import { pointToSegmentDist } from '$lib/scoring/geometry';

export const GUIDE_COLOR = 'rgba(100, 160, 255, 0.6)';
export const HINT_COLOR = 'rgba(100, 160, 255, 0.5)';

export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

export function randomLine(
	canvasW: number, canvasH: number, diagonal: number, margin: number, lenRange = 0.65
): { x1: number; y1: number; x2: number; y2: number } {
	const targetLen = diagonal * (0.15 + Math.random() * lenRange);
	const angle = Math.random() * Math.PI * 2;

	const halfDx = (Math.cos(angle) * targetLen) / 2;
	const halfDy = (Math.sin(angle) * targetLen) / 2;

	const cxMin = margin + Math.max(0, halfDx, -halfDx);
	const cxMax = canvasW - margin - Math.max(0, halfDx, -halfDx);
	const cyMin = margin + Math.max(0, halfDy, -halfDy);
	const cyMax = canvasH - margin - Math.max(0, halfDy, -halfDy);

	if (cxMin < cxMax && cyMin < cyMax) {
		const cx = cxMin + Math.random() * (cxMax - cxMin);
		const cy = cyMin + Math.random() * (cyMax - cyMin);
		return { x1: cx - halfDx, y1: cy - halfDy, x2: cx + halfDx, y2: cy + halfDy };
	}

	const x1 = margin + Math.random() * (canvasW - 2 * margin);
	const y1 = margin + Math.random() * (canvasH - 2 * margin);
	const x2 = margin + Math.random() * (canvasW - 2 * margin);
	const y2 = margin + Math.random() * (canvasH - 2 * margin);
	return { x1, y1, x2, y2 };
}

export function randomCurve(canvasW: number, canvasH: number, diagonal: number, margin: number): CurveParams {
	const targetLen = diagonal * (0.15 + Math.random() * 0.65);
	const angle = Math.random() * Math.PI * 2;

	const halfDx = (Math.cos(angle) * targetLen) / 2;
	const halfDy = (Math.sin(angle) * targetLen) / 2;

	const cxMin = margin + Math.max(0, halfDx, -halfDx);
	const cxMax = canvasW - margin - Math.max(0, halfDx, -halfDx);
	const cyMin = margin + Math.max(0, halfDy, -halfDy);
	const cyMax = canvasH - margin - Math.max(0, halfDy, -halfDy);

	let x1: number, y1: number, x2: number, y2: number;
	if (cxMin < cxMax && cyMin < cyMax) {
		const cx = cxMin + Math.random() * (cxMax - cxMin);
		const cy = cyMin + Math.random() * (cyMax - cyMin);
		x1 = cx - halfDx;
		y1 = cy - halfDy;
		x2 = cx + halfDx;
		y2 = cy + halfDy;
	} else {
		x1 = margin + Math.random() * (canvasW - 2 * margin);
		y1 = margin + Math.random() * (canvasH - 2 * margin);
		x2 = margin + Math.random() * (canvasW - 2 * margin);
		y2 = margin + Math.random() * (canvasH - 2 * margin);
	}

	const chordLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
	const perpX = -(y2 - y1) / (chordLen || 1);
	const perpY = (x2 - x1) / (chordLen || 1);

	const offset1 = chordLen * (0.2 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1);
	const offset2 = chordLen * (0.2 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1);

	const cp1x = x1 + (x2 - x1) * 0.33 + perpX * offset1;
	const cp1y = y1 + (y2 - y1) * 0.33 + perpY * offset1;
	const cp2x = x1 + (x2 - x1) * 0.66 + perpX * offset2;
	const cp2y = y1 + (y2 - y1) * 0.66 + perpY * offset2;

	return { x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y };
}

export function scoreLineAccuracy(
	points: StrokePoint[],
	line: { x1: number; y1: number; x2: number; y2: number }
): number {
	const len = Math.sqrt((line.x2 - line.x1) ** 2 + (line.y2 - line.y1) ** 2);
	if (len === 0) return 0;
	let totalDist = 0;
	for (const p of points) totalDist += pointToSegmentDist(p.x, p.y, line);
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
}

export function highlightLineDivergent(
	points: StrokePoint[],
	line: { x1: number; y1: number; x2: number; y2: number }
): ScoredSegment[] {
	const segments: ScoredSegment[] = [];
	const windowSize = 15;
	const threshold = 15;

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) totalDist += pointToSegmentDist(points[j].x, points[j].y, line);
		const avgDist = totalDist / (end - i);

		if (avgDist > threshold) {
			const severity = Math.min(1, avgDist / 50);
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last.issue === 'divergent' && last.endIdx >= i - 2) {
					last.endIdx = end - 1;
					last.severity = Math.max(last.severity, severity);
					continue;
				}
			}
			segments.push({ startIdx: i, endIdx: end - 1, issue: 'divergent', severity });
		}
	}
	return segments;
}

export function drawRibbon(
	ctx: CanvasRenderingContext2D,
	x1: number, y1: number, x2: number, y2: number,
	width: number, color: string
): void {
	const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
	if (len === 0) return;
	const nx = -(y2 - y1) / len;
	const ny = (x2 - x1) / len;
	const hw = width / 2;

	ctx.beginPath();
	ctx.moveTo(x1 + nx * hw, y1 + ny * hw);
	ctx.lineTo(x2 + nx * hw, y2 + ny * hw);
	ctx.lineTo(x2 - nx * hw, y2 - ny * hw);
	ctx.lineTo(x1 - nx * hw, y1 - ny * hw);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
}

export function drawTaperedRibbon(
	ctx: CanvasRenderingContext2D,
	pathPoints: { x: number; y: number }[],
	startWidth: number, endWidth: number, color: string
): void {
	if (pathPoints.length < 2) return;

	const top: { x: number; y: number }[] = [];
	const bottom: { x: number; y: number }[] = [];
	const count = pathPoints.length;

	for (let i = 0; i < count; i++) {
		const t = count > 1 ? i / (count - 1) : 0;
		const hw = (startWidth + (endWidth - startWidth) * t) / 2;

		let nx: number, ny: number;
		if (i === 0) {
			const dx = pathPoints[1].x - pathPoints[0].x;
			const dy = pathPoints[1].y - pathPoints[0].y;
			const len = Math.sqrt(dx * dx + dy * dy) || 1;
			nx = -dy / len;
			ny = dx / len;
		} else if (i === count - 1) {
			const dx = pathPoints[i].x - pathPoints[i - 1].x;
			const dy = pathPoints[i].y - pathPoints[i - 1].y;
			const len = Math.sqrt(dx * dx + dy * dy) || 1;
			nx = -dy / len;
			ny = dx / len;
		} else {
			const dx = pathPoints[i + 1].x - pathPoints[i - 1].x;
			const dy = pathPoints[i + 1].y - pathPoints[i - 1].y;
			const len = Math.sqrt(dx * dx + dy * dy) || 1;
			nx = -dy / len;
			ny = dx / len;
		}

		top.push({ x: pathPoints[i].x + nx * hw, y: pathPoints[i].y + ny * hw });
		bottom.push({ x: pathPoints[i].x - nx * hw, y: pathPoints[i].y - ny * hw });
	}

	ctx.beginPath();
	ctx.moveTo(top[0].x, top[0].y);
	for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
	for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i].x, bottom[i].y);
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
}

export function lineToPathPoints(
	x1: number, y1: number, x2: number, y2: number, n = 40
): { x: number; y: number }[] {
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
	}
	return pts;
}

export function projectOntoLine(
	p: { x: number; y: number },
	line: { x1: number; y1: number; x2: number; y2: number }
): number {
	const dx = line.x2 - line.x1;
	const dy = line.y2 - line.y1;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return 0;
	return ((p.x - line.x1) * dx + (p.y - line.y1) * dy) / lenSq;
}

export function pressureShapeScore(strokeScores: StrokeScore[]): number {
	if (strokeScores.length === 0) return 0;
	return Math.round(
		strokeScores.reduce((s, sc) => s + sc.composite, 0) / strokeScores.length,
	);
}
