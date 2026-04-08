import type { LineParams, RectParams, QuadParams, CurveParams } from '$lib/exercises/types';

export function pointToSegmentDist(px: number, py: number, seg: LineParams): number {
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

export function rectEdges(rect: RectParams): LineParams[] {
	const cos = Math.cos(rect.rotation);
	const sin = Math.sin(rect.rotation);
	const hw = rect.w / 2;
	const hh = rect.h / 2;

	const corners = [
		{ x: rect.cx + cos * -hw - sin * -hh, y: rect.cy + sin * -hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * -hh, y: rect.cy + sin * hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * hh, y: rect.cy + sin * hw + cos * hh },
		{ x: rect.cx + cos * -hw - sin * hh, y: rect.cy + sin * -hw + cos * hh },
	];

	return [
		{ x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
		{ x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
		{ x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
		{ x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y },
	];
}

export function rectCorners(rect: RectParams): { x: number; y: number }[] {
	const cos = Math.cos(rect.rotation);
	const sin = Math.sin(rect.rotation);
	const hw = rect.w / 2;
	const hh = rect.h / 2;
	return [
		{ x: rect.cx + cos * -hw - sin * -hh, y: rect.cy + sin * -hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * -hh, y: rect.cy + sin * hw + cos * -hh },
		{ x: rect.cx + cos * hw - sin * hh, y: rect.cy + sin * hw + cos * hh },
		{ x: rect.cx + cos * -hw - sin * hh, y: rect.cy + sin * -hw + cos * hh },
	];
}

export function rectDiagonals(rect: RectParams): LineParams[] {
	const corners = rectCorners(rect);
	return [
		{ x1: corners[0].x, y1: corners[0].y, x2: corners[2].x, y2: corners[2].y },
		{ x1: corners[1].x, y1: corners[1].y, x2: corners[3].x, y2: corners[3].y },
	];
}

export function quadEdges(q: QuadParams): LineParams[] {
	const c = q.corners;
	return [
		{ x1: c[0].x, y1: c[0].y, x2: c[1].x, y2: c[1].y },
		{ x1: c[1].x, y1: c[1].y, x2: c[2].x, y2: c[2].y },
		{ x1: c[2].x, y1: c[2].y, x2: c[3].x, y2: c[3].y },
		{ x1: c[3].x, y1: c[3].y, x2: c[0].x, y2: c[0].y },
	];
}

export function quadDiagonals(q: QuadParams): LineParams[] {
	const c = q.corners;
	return [
		{ x1: c[0].x, y1: c[0].y, x2: c[2].x, y2: c[2].y },
		{ x1: c[1].x, y1: c[1].y, x2: c[3].x, y2: c[3].y },
	];
}

export function sampleBezier(
	p0: { x: number; y: number },
	p1: { x: number; y: number },
	p2: { x: number; y: number },
	p3: { x: number; y: number },
	n = 100,
): { x: number; y: number }[] {
	const points: { x: number; y: number }[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const u = 1 - t;
		points.push({
			x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
			y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
		});
	}
	return points;
}

export function pointToBezierDist(px: number, py: number, curve: CurveParams): number {
	const samples = sampleBezier(
		{ x: curve.x1, y: curve.y1 },
		{ x: curve.cp1x, y: curve.cp1y },
		{ x: curve.cp2x, y: curve.cp2y },
		{ x: curve.x2, y: curve.y2 },
	);
	let minDist = Infinity;
	for (let i = 0; i < samples.length - 1; i++) {
		const seg: LineParams = {
			x1: samples[i].x,
			y1: samples[i].y,
			x2: samples[i + 1].x,
			y2: samples[i + 1].y,
		};
		minDist = Math.min(minDist, pointToSegmentDist(px, py, seg));
	}
	return minDist;
}

export function bezierArcLen(curve: CurveParams, n = 100): number {
	const samples = sampleBezier(
		{ x: curve.x1, y: curve.y1 },
		{ x: curve.cp1x, y: curve.cp1y },
		{ x: curve.cp2x, y: curve.cp2y },
		{ x: curve.x2, y: curve.y2 },
		n,
	);
	let len = 0;
	for (let i = 1; i < samples.length; i++) {
		len += Math.sqrt((samples[i].x - samples[i - 1].x) ** 2 + (samples[i].y - samples[i - 1].y) ** 2);
	}
	return len;
}
