import type { StrokePoint } from '$lib/input/stroke';
import type {
	ExerciseType,
	LineParams,
	CircleParams,
	EllipseParams,
	RectParams,
	ReferenceShape
} from '$lib/exercises/types';

export function scoreAccuracy(
	points: StrokePoint[],
	reference: ReferenceShape,
	strokeIndex: number
): number {
	if (points.length < 2) return 0;

	switch (reference.type) {
		case 'line':
			return scoreLineAccuracy(points, reference.params as LineParams);
		case 'circle':
			return scoreCircleAccuracy(points, reference.params as CircleParams);
		case 'ellipse':
			return scoreEllipseAccuracy(points, reference.params as EllipseParams);
		case 'rectangle':
			return scoreRectAccuracy(points, reference.params as RectParams, strokeIndex);
		default:
			return 0;
	}
}

function scoreLineAccuracy(points: StrokePoint[], line: LineParams): number {
	const dx = line.x2 - line.x1;
	const dy = line.y2 - line.y1;
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len === 0) return 0;

	let totalDist = 0;
	for (const p of points) {
		totalDist += pointToSegmentDist(p.x, p.y, line);
	}
	const avgDist = totalDist / points.length;

	// Normalize: 0 dist = 100, >50px average = 0
	return Math.max(0, Math.min(100, 100 - (avgDist / 50) * 100));
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

function scoreEllipseAccuracy(points: StrokePoint[], ellipse: EllipseParams): number {
	const cos = Math.cos(-ellipse.rotation);
	const sin = Math.sin(-ellipse.rotation);

	let totalDist = 0;
	for (const p of points) {
		const dx = p.x - ellipse.cx;
		const dy = p.y - ellipse.cy;
		const lx = cos * dx - sin * dy;
		const ly = sin * dx + cos * dy;
		// Algebraic distance to ellipse
		const norm = (lx / ellipse.rx) ** 2 + (ly / ellipse.ry) ** 2;
		const dist = Math.abs(Math.sqrt(norm) - 1) * Math.max(ellipse.rx, ellipse.ry);
		totalDist += dist;
	}
	const avgDist = totalDist / points.length;
	return Math.max(0, Math.min(100, 100 - (avgDist / 40) * 100));
}

function scoreRectAccuracy(points: StrokePoint[], rect: RectParams, strokeIndex: number): number {
	const edges = rectEdges(rect);
	const edgeIdx = strokeIndex % 4;
	const edge = edges[edgeIdx];
	return scoreLineAccuracy(points, edge);
}

export function rectEdges(rect: RectParams): LineParams[] {
	const cos = Math.cos(rect.rotation);
	const sin = Math.sin(rect.rotation);
	const hw = rect.w / 2;
	const hh = rect.h / 2;

	const corners = [
		{ x: rect.cx + cos * -hw - sin * -hh, y: rect.cy + sin * -hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * -hh, y: rect.cy + sin * hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * hh, y: rect.cy + sin * hw + cos * hh },
		{ x: rect.cx + cos * -hw - sin * hh, y: rect.cy + sin * -hw + cos * hh }
	];

	return [
		{ x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
		{ x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
		{ x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
		{ x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y }
	];
}

export function pointToSegmentDist(
	px: number,
	py: number,
	seg: LineParams
): number {
	const dx = seg.x2 - seg.x1;
	const dy = seg.y2 - seg.y1;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.sqrt((px - seg.x1) ** 2 + (py - seg.y1) ** 2);

	let t = ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	const projX = seg.x1 + t * dx;
	const projY = seg.y1 + t * dy;
	return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}
