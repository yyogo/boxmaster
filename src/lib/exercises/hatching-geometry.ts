import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { LineParams } from '$lib/exercises/types';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { getStrokePoints } from './plugin';

export type HatchRegionKind = 'rect' | 'parallelogram' | 'trapezoid';

/** Local-space corners CCW for outline (before world rotation around origin). */
export function outlineCornersLocal(
	kind: HatchRegionKind,
	halfW: number,
	halfH: number,
	skew: number,
	halfWBottom: number,
): { x: number; y: number }[] {
	switch (kind) {
		case 'rect':
			return [
				{ x: -halfW, y: -halfH },
				{ x: halfW, y: -halfH },
				{ x: halfW, y: halfH },
				{ x: -halfW, y: halfH },
			];
		case 'parallelogram':
			return [
				{ x: -halfW, y: -halfH },
				{ x: halfW, y: -halfH },
				{ x: halfW + skew, y: halfH },
				{ x: -halfW + skew, y: halfH },
			];
		case 'trapezoid':
			return [
				{ x: -halfW, y: -halfH },
				{ x: halfW, y: -halfH },
				{ x: halfWBottom, y: halfH },
				{ x: -halfWBottom, y: halfH },
			];
	}
}

export function localToWorld(
	lx: number,
	ly: number,
	cx: number,
	cy: number,
	cos: number,
	sin: number,
): { x: number; y: number } {
	return { x: cx + cos * lx - sin * ly, y: cy + sin * lx + cos * ly };
}

/** Horizontal hatch segments in local frame (stroke along +local X), at given localY. */
export function xExtentAtLocalY(
	kind: HatchRegionKind,
	localY: number,
	halfW: number,
	halfH: number,
	skew: number,
	halfWBottom: number,
): { x0: number; x1: number } {
	const denom = 2 * halfH;
	const t = denom > 1e-6 ? (localY + halfH) / denom : 0;
	if (kind === 'rect') {
		return { x0: -halfW, x1: halfW };
	}
	if (kind === 'parallelogram') {
		const sh = skew * t;
		return { x0: -halfW + sh, x1: halfW + sh };
	}
	const hw = halfW + (halfWBottom - halfW) * t;
	return { x0: -hw, x1: hw };
}

function meanDistToLine(pts: StrokePoint[], line: LineParams): number {
	if (pts.length === 0) return 1e9;
	let s = 0;
	for (const p of pts) {
		s += pointToSegmentDist(p.x, p.y, line);
	}
	return s / pts.length;
}

/**
 * Hungarian (Kuhn–Munkres-style) min-cost assignment for a square cost matrix.
 * Returns `assignment[i] = j` meaning row i is matched to column j (0-based).
 */
export function minCostSquareAssignment(cost: number[][]): number[] {
	const n = cost.length;
	if (n === 0) return [];
	for (const row of cost) {
		if (row.length !== n) {
			throw new Error('minCostSquareAssignment: matrix must be square');
		}
	}
	const u = new Array(n + 1).fill(0);
	const v = new Array(n + 1).fill(0);
	const p = new Array(n + 1).fill(0);
	const way = new Array(n + 1).fill(0);
	for (let i = 1; i <= n; i++) {
		p[0] = i;
		let j0 = 0;
		const minv = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
		const used = new Array(n + 1).fill(false);
		do {
			used[j0] = true;
			const i0 = p[j0];
			let delta = Number.POSITIVE_INFINITY;
			let j1 = 0;
			for (let j = 1; j <= n; j++) {
				if (!used[j]) {
					const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
					if (cur < minv[j]) {
						minv[j] = cur;
						way[j] = j0;
					}
					if (minv[j] < delta) {
						delta = minv[j];
						j1 = j;
					}
				}
			}
			for (let j = 0; j <= n; j++) {
				if (used[j]) {
					u[p[j]] += delta;
					v[j] -= delta;
				} else {
					minv[j] -= delta;
				}
			}
			j0 = j1;
		} while (p[j0] !== 0);
		do {
			const j1 = way[j0];
			p[j0] = p[j1];
			j0 = j1;
		} while (j0 !== 0);
	}
	const assignment = new Array<number>(n).fill(-1);
	for (let j = 1; j <= n; j++) {
		if (p[j] !== 0) {
			assignment[p[j] - 1] = j - 1;
		}
	}
	return assignment;
}

/**
 * Optimal stroke-to-line assignment minimizing mean point-to-segment distance
 * (each stroke paired with exactly one reference line).
 */
export function assignStrokesToLinesMinCost(strokes: Stroke[], lines: LineParams[]): number[] {
	const n = strokes.length;
	if (n !== lines.length) {
		throw new Error('assignStrokesToLinesMinCost: stroke count must match line count');
	}
	if (n === 0) return [];
	const ptsPerStroke = strokes.map((s) => getStrokePoints(s));
	const cost: number[][] = [];
	for (let i = 0; i < n; i++) {
		const row: number[] = [];
		for (let j = 0; j < n; j++) {
			row.push(meanDistToLine(ptsPerStroke[i], lines[j]));
		}
		cost.push(row);
	}
	return minCostSquareAssignment(cost);
}

// --- Advanced: convex polygon parallel hatch ---

function lineEdgeIntersection(
	nx: number,
	ny: number,
	s: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): { x: number; y: number } | null {
	const dx = bx - ax;
	const dy = by - ay;
	const denom = nx * dx + ny * dy;
	if (Math.abs(denom) < 1e-12) return null;
	const t = (s - nx * ax - ny * ay) / denom;
	if (t < -1e-8 || t > 1 + 1e-8) return null;
	return { x: ax + t * dx, y: ay + t * dy };
}

/**
 * Stroke direction unit vector `d`; lines are parallel to `d`.
 * Normal `n` (perpendicular to strokes) defines parallel family n·x = offset.
 * Returns chord segment inside convex `poly` for n·x = s.
 */
export function chordInConvexPolygon(
	poly: { x: number; y: number }[],
	d: { x: number; y: number },
	n: { x: number; y: number },
	s: number,
): LineParams | null {
	const hits: { x: number; y: number }[] = [];
	const m = poly.length;
	for (let i = 0; i < m; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % m];
		const h = lineEdgeIntersection(n.x, n.y, s, a.x, a.y, b.x, b.y);
		if (h) hits.push(h);
	}
	if (hits.length < 2) return null;
	// Dedupe near-duplicates (corner hits)
	const dedup: { x: number; y: number }[] = [];
	for (const h of hits) {
		if (!dedup.some((q) => (q.x - h.x) ** 2 + (q.y - h.y) ** 2 < 9)) dedup.push(h);
	}
	if (dedup.length < 2) return null;
	dedup.sort((p, q) => p.x * d.x + p.y * d.y - (q.x * d.x + q.y * d.y));
	const p0 = dedup[0];
	const p1 = dedup[dedup.length - 1];
	return { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y };
}

export function projectRangeOnNormal(
	poly: { x: number; y: number }[],
	nx: number,
	ny: number,
): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;
	for (const p of poly) {
		const v = nx * p.x + ny * p.y;
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	return { min, max };
}

/** Parallel chords inside axis-aligned ellipse (before world transform). */
export function ellipseHorizontalChords(a: number, b: number, lineCount: number): LineParams[] {
	const lines: LineParams[] = [];
	if (lineCount < 1) return lines;
	const eps = 0.04 * Math.min(a, b);
	const y0 = -b + eps;
	const y1 = b - eps;
	for (let i = 0; i < lineCount; i++) {
		const y = lineCount === 1 ? 0 : y0 + ((y1 - y0) * i) / (lineCount - 1);
		const inner = 1 - (y * y) / (b * b);
		if (inner <= 0) continue;
		const xm = a * Math.sqrt(inner);
		lines.push({ x1: -xm, y1: y, x2: xm, y2: y });
	}
	return lines;
}

export function transformLine(line: LineParams, cx: number, cy: number, cos: number, sin: number): LineParams {
	const t = (x: number, y: number) => localToWorld(x, y, cx, cy, cos, sin);
	const p1 = t(line.x1, line.y1);
	const p2 = t(line.x2, line.y2);
	return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}
