import type { ExerciseConfig, ExerciseMode, LineParams, ThreePointBoxParams, ReferenceShape } from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import { defineExercise, buildMetricScore, getStrokePoints, strokeChord, strokeArcLen, angleDiff } from './plugin';
import { registerExercise } from './registry';
import { drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

type Pt = { x: number; y: number };
type TaggedEdge = LineParams & { vpIndex: 0 | 1 | 2 };

interface BoxStudyParams extends ThreePointBoxParams {
	mode: ExerciseMode;
	/** Which Y-arm endpoint gets 2 extra seed edges in challenge mode (0, 1, or 2). */
	challengeCorner: number;
}

const VP_COLORS = ['rgba(255, 120, 80, 0.9)', 'rgba(80, 200, 255, 0.9)', 'rgba(160, 255, 80, 0.9)'];
const VP_EXT_COLORS = ['rgba(255, 120, 80, 0.4)', 'rgba(80, 200, 255, 0.4)', 'rgba(160, 255, 80, 0.4)'];
const VP_ARC_COLORS = ['rgba(255, 120, 80, 0.7)', 'rgba(80, 200, 255, 0.7)', 'rgba(160, 255, 80, 0.7)'];
const IDEAL_LINE_COLORS = ['rgba(255, 120, 80, 0.22)', 'rgba(80, 200, 255, 0.22)', 'rgba(160, 255, 80, 0.22)'];
const VP_LABEL_NAMES = ['orange', 'cyan', 'green'];
const GIVEN_EDGE_COLOR = 'rgba(180, 220, 255, 0.8)';
const GUIDE_COLOR_FAINT = 'rgba(130, 185, 255, 0.35)';
const EXTENSION_LEN = 9000;
const ARC_RADIUS = 50;
const ARC_ANGLE_THRESHOLD = 0.04;

// Indices into expectedEdges[] that are connected to each Y-arm endpoint.
// Corner 0 (c1, VP0 arm): edges toward VP1 and VP2
// Corner 1 (c2, VP1 arm): edges toward VP0 and VP2
// Corner 2 (c3, VP2 arm): edges toward VP0 and VP1
const CHALLENGE_SEED_INDICES: [number, number][] = [
	[3, 6], // c1→c4 (VP1), c1→c5 (VP2)
	[0, 7], // c2→c4 (VP0), c2→c6 (VP2)
	[1, 4], // c3→c5 (VP0), c3→c6 (VP1)
];

// --- Geometry helpers ---

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

function lineLineIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
	const d1x = p2.x - p1.x;
	const d1y = p2.y - p1.y;
	const d2x = p4.x - p3.x;
	const d2y = p4.y - p3.y;
	const denom = d1x * d2y - d1y * d2x;
	if (Math.abs(denom) < 1e-10) return null;
	const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
	return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

function rayCanvasExtent(origin: Pt, dx: number, dy: number, canvasW: number, canvasH: number): number {
	let tMax = Infinity;
	if (dx > 1e-9) tMax = Math.min(tMax, (canvasW - origin.x) / dx);
	else if (dx < -1e-9) tMax = Math.min(tMax, -origin.x / dx);
	if (dy > 1e-9) tMax = Math.min(tMax, (canvasH - origin.y) / dy);
	else if (dy < -1e-9) tMax = Math.min(tMax, -origin.y / dy);
	return Math.max(0, tMax);
}

function buildExpectedEdges(c1: Pt, c2: Pt, c3: Pt, c4: Pt, c5: Pt, c6: Pt, c7: Pt): TaggedEdge[] {
	return [
		{ x1: c2.x, y1: c2.y, x2: c4.x, y2: c4.y, vpIndex: 0 },
		{ x1: c3.x, y1: c3.y, x2: c5.x, y2: c5.y, vpIndex: 0 },
		{ x1: c6.x, y1: c6.y, x2: c7.x, y2: c7.y, vpIndex: 0 },
		{ x1: c1.x, y1: c1.y, x2: c4.x, y2: c4.y, vpIndex: 1 },
		{ x1: c3.x, y1: c3.y, x2: c6.x, y2: c6.y, vpIndex: 1 },
		{ x1: c5.x, y1: c5.y, x2: c7.x, y2: c7.y, vpIndex: 1 },
		{ x1: c1.x, y1: c1.y, x2: c5.x, y2: c5.y, vpIndex: 2 },
		{ x1: c2.x, y1: c2.y, x2: c6.x, y2: c6.y, vpIndex: 2 },
		{ x1: c4.x, y1: c4.y, x2: c7.x, y2: c7.y, vpIndex: 2 },
	];
}

function computeBoxVertices(endpoints: Pt[], vps: [Pt, Pt, Pt]): { c4: Pt; c5: Pt; c6: Pt; c7: Pt } | null {
	const [c1, c2, c3] = endpoints;
	const c4 = lineLineIntersect(c1, vps[1], c2, vps[0]);
	const c5 = lineLineIntersect(c1, vps[2], c3, vps[0]);
	const c6 = lineLineIntersect(c2, vps[2], c3, vps[1]);
	if (!c4 || !c5 || !c6) return null;
	const c7 = lineLineIntersect(c4, vps[2], c5, vps[1]);
	if (!c7) return null;
	return { c4, c5, c6, c7 };
}

// --- Mode-specific edge sets ---

function taggedYEdges(p: ThreePointBoxParams): TaggedEdge[] {
	return [
		{ x1: p.yEdges[0].x1, y1: p.yEdges[0].y1, x2: p.yEdges[0].x2, y2: p.yEdges[0].y2, vpIndex: 0 },
		{ x1: p.yEdges[1].x1, y1: p.yEdges[1].y1, x2: p.yEdges[1].x2, y2: p.yEdges[1].y2, vpIndex: 1 },
		{ x1: p.yEdges[2].x1, y1: p.yEdges[2].y1, x2: p.yEdges[2].x2, y2: p.yEdges[2].y2, vpIndex: 2 },
	];
}

/** All 12 edges of the box, tagged by VP family. */
function allEdges(p: ThreePointBoxParams): TaggedEdge[] {
	return [...taggedYEdges(p), ...p.expectedEdges];
}

/** The 2 seed edge indices for a given challenge corner. */
function challengeSeedIndices(corner: number): [number, number] {
	return CHALLENGE_SEED_INDICES[corner];
}

/** Edges the user is expected to draw, given the mode. */
function drawableEdges(p: BoxStudyParams): TaggedEdge[] {
	if (p.mode === 'tracing') return allEdges(p);
	if (p.mode === 'challenge') {
		const seedIdx = new Set(challengeSeedIndices(p.challengeCorner));
		return p.expectedEdges.filter((_, i) => !seedIdx.has(i));
	}
	return [...p.expectedEdges]; // free: all 9 expected edges
}

/** Edges shown as solid scaffold (not drawn by the user). */
function seedEdges(p: BoxStudyParams): TaggedEdge[] {
	if (p.mode === 'tracing') return []; // user traces everything
	const yTagged = taggedYEdges(p);
	if (p.mode === 'challenge') {
		const [i0, i1] = challengeSeedIndices(p.challengeCorner);
		return [...yTagged, p.expectedEdges[i0], p.expectedEdges[i1]];
	}
	return yTagged; // free: just Y
}

// --- Generation (moderate off-canvas VPs) ---

function generateBoxStudy(canvasW: number, canvasH: number): ThreePointBoxParams | null {
	const minDim = Math.min(canvasW, canvasH);
	const margin = minDim * 0.15;

	const c0: Pt = {
		x: margin + Math.random() * (canvasW - 2 * margin),
		y: margin + Math.random() * (canvasH - 2 * margin),
	};

	const u1 = Math.random() * (Math.PI / 2);
	const u2 = Math.random() * (Math.PI / 2);
	const lo = Math.min(u1, u2);
	const hi = Math.max(u1, u2);
	const gaps = [lo + Math.PI / 2, hi - lo + Math.PI / 2, Math.PI / 2 - hi + Math.PI / 2];

	const theta0 = Math.random() * Math.PI * 2;
	const thetas = [theta0, theta0 + gaps[0], theta0 + gaps[0] + gaps[1]];

	const arms: { endpoint: Pt; vp: Pt }[] = [];
	for (let i = 0; i < 3; i++) {
		const dx = Math.cos(thetas[i]);
		const dy = Math.sin(thetas[i]);
		const maxExt = rayCanvasExtent(c0, dx, dy, canvasW, canvasH);
		if (maxExt < minDim * 0.15) return null;

		const vpDist = maxExt * (1.3 + Math.random() * 3.7);
		const armLen = maxExt * (0.28 + Math.random() * 0.32);
		if (armLen < minDim * 0.07) return null;

		arms.push({
			endpoint: { x: c0.x + dx * armLen, y: c0.y + dy * armLen },
			vp: { x: c0.x + dx * vpDist, y: c0.y + dy * vpDist },
		});
	}

	const endpoints = arms.map((a) => a.endpoint);
	const vps: [Pt, Pt, Pt] = [arms[0].vp, arms[1].vp, arms[2].vp];

	const verts = computeBoxVertices(endpoints, vps);
	if (!verts) return null;
	const { c4, c5, c6, c7 } = verts;

	for (const pt of [c4, c5, c6, c7]) {
		if (pt.x < -canvasW * 0.3 || pt.x > canvasW * 1.3 || pt.y < -canvasH * 0.3 || pt.y > canvasH * 1.3) return null;
	}

	const expectedEdges = buildExpectedEdges(endpoints[0], endpoints[1], endpoints[2], c4, c5, c6, c7);

	const minEdgeLen = minDim * 0.035;
	for (const e of expectedEdges) {
		if (Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < minEdgeLen) return null;
	}

	return {
		vps,
		yCorner: c0,
		yEdges: [
			{ x1: c0.x, y1: c0.y, x2: endpoints[0].x, y2: endpoints[0].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[1].x, y2: endpoints[1].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[2].x, y2: endpoints[2].y },
		],
		expectedEdges,
	};
}

function generateFallbackBoxStudy(canvasW: number, canvasH: number): ThreePointBoxParams {
	const cx = canvasW / 2;
	const cy = canvasH / 2;
	const minDim = Math.min(canvasW, canvasH);
	const armLen = minDim * 0.18;
	const vpDist = minDim * 2.5;

	const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
	const c0: Pt = { x: cx, y: cy };
	const endpoints = angles.map((a) => ({
		x: cx + Math.cos(a) * armLen,
		y: cy + Math.sin(a) * armLen,
	}));
	const vps = angles.map((a) => ({
		x: cx + Math.cos(a) * vpDist,
		y: cy + Math.sin(a) * vpDist,
	})) as [Pt, Pt, Pt];

	const { c4, c5, c6, c7 } = computeBoxVertices(endpoints, vps)!;

	return {
		vps,
		yCorner: c0,
		yEdges: [
			{ x1: c0.x, y1: c0.y, x2: endpoints[0].x, y2: endpoints[0].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[1].x, y2: endpoints[1].y },
			{ x1: c0.x, y1: c0.y, x2: endpoints[2].x, y2: endpoints[2].y },
		],
		expectedEdges: buildExpectedEdges(endpoints[0], endpoints[1], endpoints[2], c4, c5, c6, c7),
	};
}

// --- Stroke matching ---

function strokeFollowsEdge(pts: { x: number; y: number }[], edges: TaggedEdge[]): boolean {
	if (pts.length < 2) return false;
	const chord = strokeChord(pts);
	const sampleStep = Math.max(1, Math.floor(pts.length / 10));
	for (const exp of edges) {
		const el = Math.hypot(exp.x2 - exp.x1, exp.y2 - exp.y1);
		if (el < 1) continue;
		let totalD = 0;
		let samples = 0;
		for (let i = 0; i < pts.length; i += sampleStep) {
			totalD += pointToSegmentDist(pts[i].x, pts[i].y, exp);
			samples++;
		}
		const avgD = totalD / samples;
		if (avgD < Math.max(el * 0.12, 12) && chord >= el * 0.22) return true;
	}
	return false;
}

function matchStrokeToEdge(pts: { x: number; y: number }[], edges: TaggedEdge[]): TaggedEdge | null {
	if (pts.length < 2 || edges.length === 0) return null;
	const mid = {
		x: (pts[0].x + pts[pts.length - 1].x) / 2,
		y: (pts[0].y + pts[pts.length - 1].y) / 2,
	};
	let best: TaggedEdge = edges[0];
	let bestDist = Infinity;
	for (const e of edges) {
		const eMid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
		const d = (mid.x - eMid.x) ** 2 + (mid.y - eMid.y) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = e;
		}
	}
	return best;
}

// --- Review helpers ---

interface StrokeDir {
	stroke: Stroke;
	edge: TaggedEdge;
	start: Pt;
	end: Pt;
	dx: number;
	dy: number;
	len: number;
}

function getStrokeDir(stroke: Stroke, edges: TaggedEdge[]): StrokeDir | null {
	const pts = getStrokePoints(stroke);
	if (pts.length < 2) return null;
	const edge = matchStrokeToEdge(pts, edges);
	if (!edge) return null;
	const start = pts[0];
	const end = pts[pts.length - 1];
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const len = Math.hypot(dx, dy);
	if (len < 1) return null;
	return { stroke, edge, start, end, dx, dy, len };
}

function inferGroupVP(dirs: StrokeDir[]): Pt | null {
	if (dirs.length < 2) return null;
	const intersections: Pt[] = [];
	for (let i = 0; i < dirs.length; i++) {
		for (let j = i + 1; j < dirs.length; j++) {
			const a = dirs[i];
			const b = dirs[j];
			const ip = lineLineIntersect(a.start, a.end, b.start, b.end);
			if (ip) intersections.push(ip);
		}
	}
	if (intersections.length === 0) return null;
	const cx = intersections.reduce((s, pt) => s + pt.x, 0) / intersections.length;
	const cy = intersections.reduce((s, pt) => s + pt.y, 0) / intersections.length;
	return { x: cx, y: cy };
}

function vpClusterSpread(dirs: StrokeDir[], vp: Pt): number {
	if (dirs.length < 2) return 0;
	const intersections: Pt[] = [];
	for (let i = 0; i < dirs.length; i++) {
		for (let j = i + 1; j < dirs.length; j++) {
			const ip = lineLineIntersect(dirs[i].start, dirs[i].end, dirs[j].start, dirs[j].end);
			if (ip) intersections.push(ip);
		}
	}
	if (intersections.length === 0) return 0;
	let variance = 0;
	for (const pt of intersections) {
		variance += (pt.x - vp.x) ** 2 + (pt.y - vp.y) ** 2;
	}
	return Math.sqrt(variance / intersections.length);
}

function normalizeAngle(a: number): number {
	let r = a % (Math.PI * 2);
	if (r < 0) r += Math.PI * 2;
	return r;
}

function signedAngleDiff(from: number, to: number): number {
	let d = to - from;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	return d;
}

function farEndpoint(sd: StrokeDir, vp: Pt): { origin: Pt; angle: number } {
	const angleStartToEnd = Math.atan2(sd.dy, sd.dx);
	const angleToVPFromStart = Math.atan2(vp.y - sd.start.y, vp.x - sd.start.x);
	let dFromStart = Math.abs(angleStartToEnd - angleToVPFromStart);
	if (dFromStart > Math.PI) dFromStart = Math.PI * 2 - dFromStart;

	if (dFromStart < Math.PI / 2) {
		return { origin: sd.end, angle: angleStartToEnd };
	} else {
		return {
			origin: sd.start,
			angle: Math.atan2(-sd.dy, -sd.dx),
		};
	}
}

// --- Coherence scoring ---

function familyCoherenceScore(dirs: StrokeDir[]): number {
	if (dirs.length < 2) return 100;

	const angles = dirs.map((sd) => Math.atan2(sd.dy / sd.len, sd.dx / sd.len));
	let sumSin = 0;
	let sumCos = 0;
	for (const a of angles) {
		sumSin += Math.sin(a);
		sumCos += Math.cos(a);
	}
	const meanAngle = Math.atan2(sumSin / angles.length, sumCos / angles.length);

	let sumDev = 0;
	for (const a of angles) {
		sumDev += Math.abs(signedAngleDiff(meanAngle, a));
	}
	const meanDev = sumDev / angles.length;

	const threshold = Math.PI / 12;
	return Math.max(0, Math.round(100 - (meanDev / threshold) * 100));
}

function straightnessScore(pts: StrokePoint[]): number {
	if (pts.length < 2) return 100;
	const chord = strokeChord(pts);
	const arc = strokeArcLen(pts);
	if (arc < 1) return 100;
	const ratio = chord / arc;
	return Math.max(0, Math.round(Math.min(100, ((ratio - 0.85) / 0.15) * 100)));
}

// --- Diagnosis ---

function buildDiagnosis(groups: [StrokeDir[], StrokeDir[], StrokeDir[]], inferredVPs: (Pt | null)[]): string {
	const issues: string[] = [];

	for (let i = 0; i < 3; i++) {
		const g = groups[i];
		if (g.length < 2) continue;

		const angles = g.map((sd) => Math.atan2(sd.dy / sd.len, sd.dx / sd.len));
		let sumSin = 0;
		let sumCos = 0;
		for (const a of angles) {
			sumSin += Math.sin(a);
			sumCos += Math.cos(a);
		}
		const meanAngle = Math.atan2(sumSin / angles.length, sumCos / angles.length);
		let sumDev = 0;
		for (const a of angles) {
			sumDev += Math.abs(signedAngleDiff(meanAngle, a));
		}
		const meanDev = sumDev / angles.length;
		const degDev = (meanDev * 180) / Math.PI;

		if (degDev > 10) {
			issues.push(`${VP_LABEL_NAMES[i]} family inconsistent`);
		} else if (degDev > 5) {
			issues.push(`${VP_LABEL_NAMES[i]} family drifting`);
		}

		if (inferredVPs[i]) {
			const spread = vpClusterSpread(g, inferredVPs[i]!);
			const avgEdge = g.reduce((s, sd) => s + sd.len, 0) / g.length;
			if (spread > avgEdge * 4) {
				issues.push(`${VP_LABEL_NAMES[i]} convergence loose`);
			}
		}
	}

	if (issues.length === 0) return 'Strong family coherence across all three groups.';
	return issues.join(' · ');
}

// --- Plugin ---

export const boxStudyPlugin = defineExercise({
	id: 'box-study',
	unit: 'perspective',
	label: 'Box Study',
	icon: '⬟',
	description:
		'Draw boxes with hidden VPs. Tracing: trace the full wireframe. Challenge: complete from a 5-edge seed. Free: complete from Y-corner only.',
	availableModes: ['tracing', 'challenge', 'free'] as ExerciseMode[],
	requiredStrokes: 12,
	defaultCount: 10,
	manualCompletion: true,
	reviewAllowsDrawing: false,
	instructions:
		'Complete the box — each set of parallel edges should converge toward the same hidden VP. Press Done to see your convergence analysis.',

	generate(mode: ExerciseMode, canvasW: number, canvasH: number): ExerciseConfig {
		let base: ThreePointBoxParams | null = null;
		for (let attempt = 0; attempt < 100; attempt++) {
			base = generateBoxStudy(canvasW, canvasH);
			if (base) break;
		}
		if (!base) base = generateFallbackBoxStudy(canvasW, canvasH);

		const params: BoxStudyParams = {
			...base,
			mode,
			challengeCorner: Math.floor(Math.random() * 3),
		};

		let strokeCount: number;
		if (mode === 'tracing') strokeCount = 12;
		else if (mode === 'challenge') strokeCount = 7;
		else strokeCount = 9;

		return {
			unit: 'perspective',
			type: 'box-study',
			mode,
			strokeCount,
			references: [{ type: 'box-study', params }],
			availableModes: ['tracing', 'challenge', 'free'],
		};
	},

	renderScaffold(ctx: CanvasRenderingContext2D, params: Record<string, unknown>) {
		const p = params as unknown as BoxStudyParams;
		if (p.mode === 'tracing') return;

		const seed = seedEdges(p);
		for (const edge of seed) {
			ctx.beginPath();
			ctx.moveTo(edge.x1, edge.y1);
			ctx.lineTo(edge.x2, edge.y2);
			ctx.strokeStyle = GIVEN_EDGE_COLOR;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}

		drawDot(ctx, p.yCorner.x, p.yCorner.y, 4, GIVEN_EDGE_COLOR);
		for (const edge of p.yEdges) {
			drawDot(ctx, edge.x2, edge.y2, 3, GIVEN_EDGE_COLOR);
		}
		if (p.mode === 'challenge') {
			const [i0, i1] = challengeSeedIndices(p.challengeCorner);
			const e0 = p.expectedEdges[i0];
			const e1 = p.expectedEdges[i1];
			drawDot(ctx, e0.x2, e0.y2, 3, GIVEN_EDGE_COLOR);
			drawDot(ctx, e1.x2, e1.y2, 3, GIVEN_EDGE_COLOR);
		}
	},

	renderGuide(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, visibility: GuideVisibility) {
		const p = params as unknown as BoxStudyParams;

		if (visibility === 'hidden') return;

		if (visibility === 'full') {
			if (p.mode === 'tracing') {
				// Active tracing: show all 12 edges faintly, NO VPs
				const all = allEdges(p);
				for (const edge of all) {
					ctx.beginPath();
					ctx.moveTo(edge.x1, edge.y1);
					ctx.lineTo(edge.x2, edge.y2);
					ctx.strokeStyle = GUIDE_COLOR_FAINT;
					ctx.lineWidth = 1.5;
					ctx.setLineDash([6, 6]);
					ctx.stroke();
					ctx.setLineDash([]);
				}
				drawDot(ctx, p.yCorner.x, p.yCorner.y, 3, GUIDE_COLOR_FAINT);
			} else {
				// Checked phase for challenge/free: reveal VPs + all expected edges
				for (let i = 0; i < 3; i++) {
					drawDot(ctx, p.vps[i].x, p.vps[i].y, 5, VP_COLORS[i]);
					drawCrosshair(ctx, p.vps[i].x, p.vps[i].y, 8, VP_COLORS[i]);
				}
				for (const edge of p.expectedEdges) {
					ctx.beginPath();
					ctx.moveTo(edge.x1, edge.y1);
					ctx.lineTo(edge.x2, edge.y2);
					ctx.strokeStyle = GUIDE_COLOR_FAINT;
					ctx.lineWidth = 1.5;
					ctx.setLineDash([6, 6]);
					ctx.stroke();
					ctx.setLineDash([]);
				}
			}
			return;
		}

		// 'hints' (challenge active drawing): scaffold handles seed edges
	},

	renderReview(ctx: CanvasRenderingContext2D, params: Record<string, unknown>, strokes: Stroke[]) {
		const p = params as unknown as BoxStudyParams;
		const matchEdges = allEdges(p);

		const allDirs: StrokeDir[] = [];
		for (const s of strokes) {
			const sd = getStrokeDir(s, matchEdges);
			if (sd) allDirs.push(sd);
		}

		const groups: [StrokeDir[], StrokeDir[], StrokeDir[]] = [[], [], []];
		for (const sd of allDirs) {
			groups[sd.edge.vpIndex].push(sd);
		}

		const inferredVPs: (Pt | null)[] = [inferGroupVP(groups[0]), inferGroupVP(groups[1]), inferGroupVP(groups[2])];

		for (const sd of allDirs) {
			const vpIdx = sd.edge.vpIndex;
			const ivp = inferredVPs[vpIdx];

			if (!ivp) {
				const dirX = sd.dx / sd.len;
				const dirY = sd.dy / sd.len;
				ctx.beginPath();
				ctx.moveTo(sd.start.x - dirX * EXTENSION_LEN, sd.start.y - dirY * EXTENSION_LEN);
				ctx.lineTo(sd.end.x + dirX * EXTENSION_LEN, sd.end.y + dirY * EXTENSION_LEN);
				ctx.strokeStyle = VP_EXT_COLORS[vpIdx];
				ctx.lineWidth = 1;
				ctx.setLineDash([8, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
				continue;
			}

			const { origin, angle: strokeAngle } = farEndpoint(sd, ivp);
			const idealAngle = Math.atan2(ivp.y - origin.y, ivp.x - origin.x);
			const angleDeviation = signedAngleDiff(strokeAngle, idealAngle);
			const absAngle = Math.abs(angleDeviation);

			const sDirX = Math.cos(strokeAngle);
			const sDirY = Math.sin(strokeAngle);
			ctx.beginPath();
			ctx.moveTo(origin.x, origin.y);
			ctx.lineTo(origin.x + sDirX * EXTENSION_LEN, origin.y + sDirY * EXTENSION_LEN);
			ctx.strokeStyle = VP_EXT_COLORS[vpIdx];
			ctx.lineWidth = 1;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);

			const iDirX = Math.cos(idealAngle);
			const iDirY = Math.sin(idealAngle);
			ctx.beginPath();
			ctx.moveTo(origin.x, origin.y);
			ctx.lineTo(origin.x + iDirX * EXTENSION_LEN, origin.y + iDirY * EXTENSION_LEN);
			ctx.strokeStyle = IDEAL_LINE_COLORS[vpIdx];
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 8]);
			ctx.stroke();
			ctx.setLineDash([]);

			if (absAngle > ARC_ANGLE_THRESHOLD) {
				const startA = normalizeAngle(strokeAngle);
				const endA = normalizeAngle(idealAngle);

				let arcStart: number, arcEnd: number;
				if (angleDeviation > 0) {
					arcStart = startA;
					arcEnd = endA;
				} else {
					arcStart = endA;
					arcEnd = startA;
				}

				ctx.beginPath();
				ctx.arc(origin.x, origin.y, ARC_RADIUS, arcStart, arcEnd, false);
				ctx.strokeStyle = VP_ARC_COLORS[vpIdx];
				ctx.lineWidth = 2;
				ctx.setLineDash([]);
				ctx.stroke();

				const midAngle = strokeAngle + angleDeviation / 2;
				const labelR = ARC_RADIUS + 14;
				const lx = origin.x + Math.cos(midAngle) * labelR;
				const ly = origin.y + Math.sin(midAngle) * labelR;
				const degText = `${((absAngle * 180) / Math.PI).toFixed(1)}°`;

				ctx.font = '11px system-ui, sans-serif';
				ctx.fillStyle = VP_ARC_COLORS[vpIdx];
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(degText, lx, ly);
			}
		}

		for (let i = 0; i < 3; i++) {
			const ivp = inferredVPs[i];
			if (!ivp || groups[i].length < 2) continue;
			const spread = vpClusterSpread(groups[i], ivp);
			const avgEdge = groups[i].reduce((s, sd) => s + sd.len, 0) / groups[i].length;
			if (spread < avgEdge * 3) {
				drawCrosshair(ctx, ivp.x, ivp.y, 8, VP_COLORS[i]);
				drawDot(ctx, ivp.x, ivp.y, 3, VP_COLORS[i]);
			}
		}

		const msg = buildDiagnosis(groups, inferredVPs);
		if (msg) {
			ctx.font = '13px system-ui, sans-serif';
			ctx.fillStyle = 'rgba(220, 225, 245, 0.92)';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.fillText(msg, 14, 14);
		}
	},

	scoreStrokesForRound(strokes: Stroke[], reference: ReferenceShape, mode: ExerciseMode): StrokeScore[] {
		const p = reference.params as unknown as BoxStudyParams;
		const matchEdges = mode === 'tracing' ? allEdges(p) : drawableEdges(p);

		const dirs: (StrokeDir | null)[] = strokes.map((s) => getStrokeDir(s, matchEdges));
		const groups: [StrokeDir[], StrokeDir[], StrokeDir[]] = [[], [], []];
		for (const sd of dirs) {
			if (sd) groups[sd.edge.vpIndex].push(sd);
		}

		const familyScores = [
			familyCoherenceScore(groups[0]),
			familyCoherenceScore(groups[1]),
			familyCoherenceScore(groups[2]),
		];

		return strokes.map((stroke, i) => {
			const pts = getStrokePoints(stroke);
			if (pts.length < 2) {
				return buildMetricScore(pts.length > 0 ? pts : [{ x: 0, y: 0, pressure: 0, timestamp: 0 }], {
					smoothness: true,
				});
			}

			const sd = dirs[i];
			if (!sd) {
				return buildMetricScore(pts, {
					smoothness: true,
					speedConsistency: true,
				});
			}

			const familySc = familyScores[sd.edge.vpIndex];
			const straightSc = straightnessScore(pts);
			const refAcc = scoreLineAccuracy(pts, sd.edge);

			let combined: number;
			if (mode === 'free') {
				combined = familySc * 0.7 + straightSc * 0.3;
			} else if (mode === 'challenge') {
				combined = familySc * 0.6 + straightSc * 0.25 + refAcc * 0.15;
			} else {
				combined = refAcc * 0.5 + familySc * 0.3 + straightSc * 0.2;
			}

			const extra = highlightLineDivergent(pts, sd.edge);

			return buildMetricScore(pts, {
				pathDeviation: combined,
				smoothness: true,
				speedConsistency: true,
				endpointAccuracy: {
					start: { x: sd.edge.x1, y: sd.edge.y1 },
					end: { x: sd.edge.x2, y: sd.edge.y2 },
				},
				extraSegments: extra,
			});
		});
	},

	scoreStroke(points: StrokePoint[], _reference: ReferenceShape, _strokeIndex: number): StrokeScore {
		return buildMetricScore(points, {
			smoothness: true,
			speedConsistency: true,
		});
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		canvasW: number,
		_canvasH: number,
		mode: ExerciseMode,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		if (strokeChord(pts) < canvasW * 0.02) return false;

		const p = reference.params as unknown as BoxStudyParams;
		const drawable = drawableEdges(p);

		if (strokeFollowsEdge(pts, drawable)) return true;

		// Reject strokes retracing the seed edges
		const seed = seedEdges(p);
		if (seed.length > 0) {
			const sampleStep = Math.max(1, Math.floor(pts.length / 10));
			for (const edge of seed) {
				const edgeLen = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
				if (edgeLen < 1) continue;
				let totalD = 0;
				let samples = 0;
				for (let i = 0; i < pts.length; i += sampleStep) {
					totalD += pointToSegmentDist(pts[i].x, pts[i].y, edge);
					samples++;
				}
				const avgD = totalD / samples;
				const sLen = strokeChord(pts);
				if (avgD < Math.max(edgeLen * 0.12, 15) && sLen / edgeLen > 0.4) return false;
			}
		}

		return true;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as BoxStudyParams;
		const pts = [
			p.yCorner,
			...p.yEdges.map((e) => ({ x: e.x2, y: e.y2 })),
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
		];
		return {
			x: pts.reduce((s, pt) => s + pt.x, 0) / pts.length,
			y: pts.reduce((s, pt) => s + pt.y, 0) / pts.length,
		};
	},

	getBounds(params: Record<string, unknown>) {
		const p = params as unknown as BoxStudyParams;
		const pts = [
			p.yCorner,
			...p.yEdges.map((e) => ({ x: e.x2, y: e.y2 })),
			...p.expectedEdges.flatMap((e) => [
				{ x: e.x1, y: e.y1 },
				{ x: e.x2, y: e.y2 },
			]),
		];
		const xs = pts.map((pt) => pt.x);
		const ys = pts.map((pt) => pt.y);
		return {
			minX: Math.min(...xs) - 10,
			minY: Math.min(...ys) - 10,
			maxX: Math.max(...xs) + 10,
			maxY: Math.max(...ys) + 10,
		};
	},
});

registerExercise(boxStudyPlugin);
