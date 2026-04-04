import type {
	ExerciseConfig,
	ExerciseMode,
	LineParams,
	ThreePointBoxParams,
	ReferenceShape,
} from './types';
import type { StrokePoint, Stroke } from '$lib/input/stroke';
import type { StrokeScore } from '$lib/scoring/types';
import type { GuideVisibility } from '$lib/canvas/guides';
import { pointToSegmentDist } from '$lib/scoring/geometry';
import {
	defineExercise,
	buildMetricScore,
	getStrokePoints,
	strokeChord,
} from './plugin';
import { registerExercise } from './registry';
import { drawDot, scoreLineAccuracy, highlightLineDivergent } from './utils';

type Pt = { x: number; y: number };
type TaggedEdge = LineParams & { vpIndex: 0 | 1 | 2 };

const VP_COLORS = [
	'rgba(255, 120, 80, 0.9)',
	'rgba(80, 200, 255, 0.9)',
	'rgba(160, 255, 80, 0.9)',
];
const VP_EXT_COLORS = [
	'rgba(255, 120, 80, 0.4)',
	'rgba(80, 200, 255, 0.4)',
	'rgba(160, 255, 80, 0.4)',
];
const VP_ARC_COLORS = [
	'rgba(255, 120, 80, 0.7)',
	'rgba(80, 200, 255, 0.7)',
	'rgba(160, 255, 80, 0.7)',
];
const IDEAL_LINE_COLORS = [
	'rgba(255, 120, 80, 0.25)',
	'rgba(80, 200, 255, 0.25)',
	'rgba(160, 255, 80, 0.25)',
];
const GIVEN_EDGE_COLOR = 'rgba(180, 220, 255, 0.8)';
const GUIDE_COLOR_FAINT = 'rgba(130, 185, 255, 0.35)';
const HORIZON_COLOR = 'rgba(180, 180, 180, 0.25)';
const ARC_RADIUS = 50;
const ARC_ANGLE_THRESHOLD = 0.035; // ~2 degrees
const EXTENSION_LEN = 8000;

// --- Geometry helpers ---

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

function drawCrosshair(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	color: string,
) {
	ctx.beginPath();
	ctx.moveTo(x - size, y);
	ctx.lineTo(x + size, y);
	ctx.moveTo(x, y - size);
	ctx.lineTo(x, y + size);
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.stroke();
}

function rayCanvasExtent(
	origin: Pt,
	dx: number,
	dy: number,
	canvasW: number,
	canvasH: number,
): number {
	let tMax = Infinity;
	if (dx > 1e-9) tMax = Math.min(tMax, (canvasW - origin.x) / dx);
	else if (dx < -1e-9) tMax = Math.min(tMax, -origin.x / dx);
	if (dy > 1e-9) tMax = Math.min(tMax, (canvasH - origin.y) / dy);
	else if (dy < -1e-9) tMax = Math.min(tMax, -origin.y / dy);
	return Math.max(0, tMax);
}

function buildExpectedEdges(
	c1: Pt, c2: Pt, c3: Pt,
	c4: Pt, c5: Pt, c6: Pt, c7: Pt,
): TaggedEdge[] {
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

function computeBoxVertices(
	endpoints: Pt[],
	vps: [Pt, Pt, Pt],
): { c4: Pt; c5: Pt; c6: Pt; c7: Pt } | null {
	const [c1, c2, c3] = endpoints;
	const c4 = lineLineIntersect(c1, vps[1], c2, vps[0]);
	const c5 = lineLineIntersect(c1, vps[2], c3, vps[0]);
	const c6 = lineLineIntersect(c2, vps[2], c3, vps[1]);
	if (!c4 || !c5 || !c6) return null;
	const c7 = lineLineIntersect(c4, vps[2], c5, vps[1]);
	if (!c7) return null;
	return { c4, c5, c6, c7 };
}

// --- Generation (far VPs) ---

function generateShallowBox(
	canvasW: number,
	canvasH: number,
): ThreePointBoxParams | null {
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
	const gaps = [
		lo + Math.PI / 2,
		hi - lo + Math.PI / 2,
		Math.PI / 2 - hi + Math.PI / 2,
	];

	const theta0 = Math.random() * Math.PI * 2;
	const thetas = [theta0, theta0 + gaps[0], theta0 + gaps[0] + gaps[1]];

	const arms: { endpoint: Pt; vp: Pt }[] = [];
	for (let i = 0; i < 3; i++) {
		const dx = Math.cos(thetas[i]);
		const dy = Math.sin(thetas[i]);
		const maxExt = rayCanvasExtent(c0, dx, dy, canvasW, canvasH);
		if (maxExt < minDim * 0.15) return null;

		// Far VPs: 3-15x canvas extent
		const vpDist = maxExt * (3 + Math.random() * 12);
		const armLen = maxExt * (0.3 + Math.random() * 0.3);
		if (armLen < minDim * 0.08) return null;

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
		if (
			pt.x < -canvasW * 0.3 ||
			pt.x > canvasW * 1.3 ||
			pt.y < -canvasH * 0.3 ||
			pt.y > canvasH * 1.3
		)
			return null;
	}

	const expectedEdges = buildExpectedEdges(
		endpoints[0], endpoints[1], endpoints[2],
		c4, c5, c6, c7,
	);

	const minEdgeLen = minDim * 0.04;
	for (const e of expectedEdges) {
		if (Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2) < minEdgeLen)
			return null;
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

function generateFallbackShallowBox(
	canvasW: number,
	canvasH: number,
): ThreePointBoxParams {
	const cx = canvasW / 2;
	const cy = canvasH / 2;
	const minDim = Math.min(canvasW, canvasH);
	const armLen = minDim * 0.18;
	const vpDist = minDim * 4;

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
		expectedEdges: buildExpectedEdges(
			endpoints[0], endpoints[1], endpoints[2],
			c4, c5, c6, c7,
		),
	};
}

// --- Stroke matching ---

function matchStrokeToEdge(
	pts: { x: number; y: number }[],
	edges: TaggedEdge[],
): TaggedEdge | null {
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

// --- Review: infer VPs from user strokes ---

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
	const len = Math.sqrt(dx * dx + dy * dy);
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
	const cx = intersections.reduce((s, p) => s + p.x, 0) / intersections.length;
	const cy = intersections.reduce((s, p) => s + p.y, 0) / intersections.length;
	return { x: cx, y: cy };
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

// Determine which endpoint of the stroke is "farther" — i.e. closer to the VP direction.
// We pick the endpoint whose direction from the other endpoint more closely points toward the VP.
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

// --- Plugin ---

export const shallowBoxesPlugin = defineExercise({
	id: 'shallow-boxes',
	unit: 'perspective',
	label: 'Shallow Boxes',
	icon: '▱',
	description:
		'Draw boxes with subtle perspective — vanishing points are far away, so edges look nearly parallel. Focus on consistent convergence.',
	availableModes: ['tracing', 'challenge'] as ExerciseMode[],
	requiredStrokes: 9,
	defaultCount: 10,
	manualCompletion: true,
	instructions:
		'Draw all 9 remaining edges. The VPs are very far away — edges should converge subtly. Press Done to see how well your lines converge.',

	generate(
		mode: ExerciseMode,
		canvasW: number,
		canvasH: number,
	): ExerciseConfig {
		let params: ThreePointBoxParams | null = null;
		for (let attempt = 0; attempt < 100; attempt++) {
			params = generateShallowBox(canvasW, canvasH);
			if (params) break;
		}
		if (!params) params = generateFallbackShallowBox(canvasW, canvasH);

		return {
			unit: 'perspective',
			type: 'shallow-boxes',
			mode,
			strokeCount: 9,
			references: [{ type: 'shallow-boxes', params }],
			availableModes: ['tracing', 'challenge'],
		};
	},

	renderScaffold(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
	) {
		const p = params as unknown as ThreePointBoxParams;
		// Faint horizon line connecting VPs (as a visual reference)
		const vps = p.vps;
		const allY = vps.map((v) => v.y);
		const horizonY = allY.reduce((a, b) => a + b, 0) / allY.length;

		ctx.beginPath();
		ctx.moveTo(0, horizonY);
		ctx.lineTo(ctx.canvas.width, horizonY);
		ctx.strokeStyle = HORIZON_COLOR;
		ctx.lineWidth = 1;
		ctx.setLineDash([12, 8]);
		ctx.stroke();
		ctx.setLineDash([]);
	},

	renderGuide(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
		visibility: GuideVisibility,
	) {
		const p = params as unknown as ThreePointBoxParams;

		for (const edge of p.yEdges) {
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

		if (visibility === 'full') {
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
	},

	renderReview(
		ctx: CanvasRenderingContext2D,
		params: Record<string, unknown>,
		strokes: Stroke[],
	) {
		const p = params as unknown as ThreePointBoxParams;

		// 1. Match strokes to edges and group by VP
		const allDirs: StrokeDir[] = [];
		for (const s of strokes) {
			const sd = getStrokeDir(s, p.expectedEdges);
			if (sd) allDirs.push(sd);
		}

		const groups: [StrokeDir[], StrokeDir[], StrokeDir[]] = [[], [], []];
		for (const sd of allDirs) {
			groups[sd.edge.vpIndex].push(sd);
		}

		// 2. Infer VP per group
		const inferredVPs: (Pt | null)[] = [
			inferGroupVP(groups[0]),
			inferGroupVP(groups[1]),
			inferGroupVP(groups[2]),
		];

		// 3. Draw per-stroke visualization
		for (const sd of allDirs) {
			const vpIdx = sd.edge.vpIndex;
			const ivp = inferredVPs[vpIdx];
			if (!ivp) {
				// Not enough strokes in this group — just draw extension
				const dirX = sd.dx / sd.len;
				const dirY = sd.dy / sd.len;
				ctx.beginPath();
				ctx.moveTo(
					sd.start.x - dirX * EXTENSION_LEN,
					sd.start.y - dirY * EXTENSION_LEN,
				);
				ctx.lineTo(
					sd.end.x + dirX * EXTENSION_LEN,
					sd.end.y + dirY * EXTENSION_LEN,
				);
				ctx.strokeStyle = VP_EXT_COLORS[vpIdx];
				ctx.lineWidth = 1;
				ctx.setLineDash([8, 6]);
				ctx.stroke();
				ctx.setLineDash([]);
				continue;
			}

			const { origin, angle: strokeAngle } = farEndpoint(sd, ivp);
			const idealAngle = Math.atan2(ivp.y - origin.y, ivp.x - origin.x);
			const angleDev = signedAngleDiff(strokeAngle, idealAngle);
			const absAngle = Math.abs(angleDev);

			// Draw dashed stroke extension line
			const sDirX = Math.cos(strokeAngle);
			const sDirY = Math.sin(strokeAngle);
			ctx.beginPath();
			ctx.moveTo(origin.x, origin.y);
			ctx.lineTo(
				origin.x + sDirX * EXTENSION_LEN,
				origin.y + sDirY * EXTENSION_LEN,
			);
			ctx.strokeStyle = VP_EXT_COLORS[vpIdx];
			ctx.lineWidth = 1;
			ctx.setLineDash([8, 6]);
			ctx.stroke();
			ctx.setLineDash([]);

			// Draw thin ideal-direction line
			const iDirX = Math.cos(idealAngle);
			const iDirY = Math.sin(idealAngle);
			ctx.beginPath();
			ctx.moveTo(origin.x, origin.y);
			ctx.lineTo(
				origin.x + iDirX * EXTENSION_LEN,
				origin.y + iDirY * EXTENSION_LEN,
			);
			ctx.strokeStyle = IDEAL_LINE_COLORS[vpIdx];
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 8]);
			ctx.stroke();
			ctx.setLineDash([]);

			// Draw angle arc if divergence exceeds threshold
			if (absAngle > ARC_ANGLE_THRESHOLD) {
				const startA = normalizeAngle(strokeAngle);
				const endA = normalizeAngle(idealAngle);

				// Determine shorter arc direction
				let arcStart: number, arcEnd: number, ccw: boolean;
				if (angleDev > 0) {
					arcStart = startA;
					arcEnd = endA;
					ccw = false;
				} else {
					arcStart = endA;
					arcEnd = startA;
					ccw = false;
				}

				ctx.beginPath();
				ctx.arc(origin.x, origin.y, ARC_RADIUS, arcStart, arcEnd, ccw);
				ctx.strokeStyle = VP_ARC_COLORS[vpIdx];
				ctx.lineWidth = 2;
				ctx.setLineDash([]);
				ctx.stroke();

				// Label: angle in degrees
				const midAngle = strokeAngle + angleDev / 2;
				const labelR = ARC_RADIUS + 14;
				const lx = origin.x + Math.cos(midAngle) * labelR;
				const ly = origin.y + Math.sin(midAngle) * labelR;
				const degText = `${(absAngle * 180 / Math.PI).toFixed(1)}°`;

				ctx.font = '11px system-ui, sans-serif';
				ctx.fillStyle = VP_ARC_COLORS[vpIdx];
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(degText, lx, ly);
			}
		}

		// 4. Draw inferred VP crosshairs (faint, small)
		for (let i = 0; i < 3; i++) {
			const ivp = inferredVPs[i];
			if (ivp) {
				drawCrosshair(ctx, ivp.x, ivp.y, 8, VP_COLORS[i]);
				drawDot(ctx, ivp.x, ivp.y, 3, VP_COLORS[i]);
			}
		}
	},

	onReviewStroke(
		newStroke: Stroke,
		existingStrokes: Stroke[],
		reference: ReferenceShape,
	): Stroke[] {
		const p = reference.params as unknown as ThreePointBoxParams;
		const newPts = getStrokePoints(newStroke);
		const newEdge = matchStrokeToEdge(newPts, p.expectedEdges);
		if (!newEdge) return [...existingStrokes, newStroke];

		const replaceIdx = existingStrokes.findIndex((s) => {
			const pts = getStrokePoints(s);
			const edge = matchStrokeToEdge(pts, p.expectedEdges);
			return edge && edge.vpIndex === newEdge.vpIndex &&
				edge.x1 === newEdge.x1 && edge.y1 === newEdge.y1 &&
				edge.x2 === newEdge.x2 && edge.y2 === newEdge.y2;
		});

		if (replaceIdx >= 0) {
			const updated = [...existingStrokes];
			updated[replaceIdx] = newStroke;
			return updated;
		}
		return [...existingStrokes, newStroke];
	},

	scoreStrokesForRound(
		strokes: Stroke[],
		reference: ReferenceShape,
	): StrokeScore[] {
		const p = reference.params as unknown as ThreePointBoxParams;

		// Build stroke directions and group by VP
		const dirs: (StrokeDir | null)[] = strokes.map((s) =>
			getStrokeDir(s, p.expectedEdges),
		);
		const groups: [StrokeDir[], StrokeDir[], StrokeDir[]] = [[], [], []];
		for (const sd of dirs) {
			if (sd) groups[sd.edge.vpIndex].push(sd);
		}
		const inferredVPs: (Pt | null)[] = [
			inferGroupVP(groups[0]),
			inferGroupVP(groups[1]),
			inferGroupVP(groups[2]),
		];

		return strokes.map((stroke, i) => {
			const pts = getStrokePoints(stroke);
			if (pts.length < 2) {
				return buildMetricScore(
					pts.length > 0 ? pts : [{ x: 0, y: 0, pressure: 0, timestamp: 0 }],
					{ smoothness: true },
				);
			}

			const sd = dirs[i];
			if (!sd) {
				return buildMetricScore(pts, {
					smoothness: true,
					speedConsistency: true,
				});
			}

			const ivp = inferredVPs[sd.edge.vpIndex];
			const accuracy = scoreLineAccuracy(pts, sd.edge);

			// Convergence score: angular deviation from inferred VP direction
			let convergenceScore = 100;
			if (ivp) {
				const { origin, angle: strokeAngle } = farEndpoint(sd, ivp);
				const idealAngle = Math.atan2(ivp.y - origin.y, ivp.x - origin.x);
				let angleDev = Math.abs(strokeAngle - idealAngle);
				if (angleDev > Math.PI) angleDev = Math.PI * 2 - angleDev;
				// Scale: 0 dev = 100, π/12 (15°) dev = 0
				convergenceScore = Math.max(0, 100 - (angleDev / (Math.PI / 12)) * 100);
			}

			// Convergence-dominant combined score
			const combined = accuracy * 0.3 + convergenceScore * 0.7;
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

	scoreStroke(
		points: StrokePoint[],
		_reference: ReferenceShape,
		_strokeIndex: number,
	): StrokeScore {
		return buildMetricScore(points, {
			smoothness: true,
			speedConsistency: true,
		});
	},

	isStrokeRelevant(
		stroke: Stroke,
		reference: ReferenceShape,
		canvasW: number,
	): boolean {
		const pts = getStrokePoints(stroke);
		if (pts.length < 2) return false;
		if (strokeChord(pts) < canvasW * 0.02) return false;

		const p = reference.params as unknown as ThreePointBoxParams;
		const sampleStep = Math.max(1, Math.floor(pts.length / 10));

		for (const edge of p.yEdges) {
			const edgeLen = Math.sqrt(
				(edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2,
			);
			if (edgeLen < 1) continue;
			let totalD = 0;
			let samples = 0;
			for (let i = 0; i < pts.length; i += sampleStep) {
				totalD += pointToSegmentDist(pts[i].x, pts[i].y, edge);
				samples++;
			}
			const avgD = totalD / samples;
			const sLen = strokeChord(pts);
			if (avgD < Math.max(edgeLen * 0.12, 15) && sLen / edgeLen > 0.4)
				return false;
		}

		return true;
	},

	getCenter(params: Record<string, unknown>) {
		const p = params as unknown as ThreePointBoxParams;
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
		const p = params as unknown as ThreePointBoxParams;
		// Exclude VPs from bounds since they are very far off-screen
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

registerExercise(shallowBoxesPlugin);
