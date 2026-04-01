import type { Stroke } from '$lib/input/stroke';
import type { StrokeScore, ScoredSegment } from '$lib/scoring/types';

const COLORS: Record<string, string> = {
	accurate: '#4ade80',
	divergent: '#f87171',
	jittery: '#fbbf24',
	pressure_spike: '#c084fc',
	hesitation: '#fb923c'
};

export function renderHighlights(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	score: StrokeScore
): void {
	const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
	if (pts.length < 2) return;

	if (score.segments.length === 0) {
		drawColoredStroke(ctx, pts, '#4ade80', 2.5);
		return;
	}

	const pointColors = new Array(pts.length).fill('#4ade80');

	for (const seg of score.segments) {
		const color = COLORS[seg.issue] || '#4ade80';
		const start = Math.max(0, seg.startIdx);
		const end = Math.min(pts.length - 1, seg.endIdx);
		for (let i = start; i <= end; i++) {
			if (seg.severity > 0.3) {
				pointColors[i] = color;
			}
		}
	}

	for (let i = 0; i < pts.length - 1; i++) {
		ctx.beginPath();
		ctx.moveTo(pts[i].x, pts[i].y);
		ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
		ctx.strokeStyle = pointColors[i];
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.stroke();
	}
}

function drawColoredStroke(
	ctx: CanvasRenderingContext2D,
	pts: { x: number; y: number }[],
	color: string,
	lineWidth: number
): void {
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) {
		ctx.lineTo(pts[i].x, pts[i].y);
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();
}
