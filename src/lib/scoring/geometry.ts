import type { LineParams, RectParams } from '$lib/exercises/types';

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
		{ x: rect.cx + cos * -hw - sin * hh, y: rect.cy + sin * -hw + cos * hh }
	];

	return [
		{ x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
		{ x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
		{ x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
		{ x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y }
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
		{ x: rect.cx + cos * -hw - sin * hh, y: rect.cy + sin * -hw + cos * hh }
	];
}
