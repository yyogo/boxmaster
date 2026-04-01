import type {
	ExerciseConfig,
	ExerciseDefinition,
	LineParams,
	PerspectiveBoxParams,
	ReferenceShape
} from './types';
import { placeNonOverlapping } from './placement';

export interface PerspectiveSession {
	horizonY: number;
	vp: { x: number; y: number };
}

export function createPerspectiveSession(canvasW: number, canvasH: number): PerspectiveSession {
	const horizonY = canvasH * (0.3 + Math.random() * 0.15);
	const vpX = canvasW * (0.3 + Math.random() * 0.4);
	return { horizonY, vp: { x: vpX, y: horizonY } };
}

export function generateSingleBox(
	session: PerspectiveSession,
	canvasW: number,
	canvasH: number,
	mode: 'guided' | 'semi-guided'
): ExerciseConfig {
	const minDim = Math.min(canvasW, canvasH);
	const t = Math.random();
	const edgeW = minDim * (0.05 + t * 0.12);
	const edgeH = edgeW * (0.5 + Math.random() * 0.7);

	const slots = placeNonOverlapping(
		1,
		canvasW,
		canvasH,
		() => {
			const s = Math.max(edgeW, edgeH) * 2;
			return { w: s, h: s };
		},
		50,
		30
	);

	const slot = slots[0];
	const cx = slot.x + slot.w / 2;
	const cy = slot.y + slot.h / 2;
	const params = generateBox(canvasW, canvasH, session.vp, session.horizonY, cx, cy, edgeW, edgeH);

	return {
		unit: 'perspective',
		type: '1-point-box',
		mode,
		strokeCount: params.expectedEdges.length,
		references: [{ type: '1-point-box', params }],
		availableModes: perspectiveDefinition.availableModes
	};
}

export const perspectiveDefinition: ExerciseDefinition = {
	unit: 'perspective',
	type: '1-point-box',
	label: '1-Point Perspective Box',
	description:
		'Complete boxes in single-point perspective. Three edges are given — draw the remaining nine.',
	availableModes: ['guided', 'semi-guided'],
	defaultStrokeCount: 9
};

export function generatePerspectiveExercise(
	mode: 'guided' | 'semi-guided',
	canvasW: number,
	canvasH: number,
	count = 1
): ExerciseConfig {
	const horizonY = canvasH * (0.3 + Math.random() * 0.15);
	const vpX = canvasW * (0.3 + Math.random() * 0.4);
	const vp = { x: vpX, y: horizonY };

	const minDim = Math.min(canvasW, canvasH);
	const boxSizes = Array.from({ length: count }, () => {
		const t = Math.random();
		const edgeW = minDim * (0.05 + t * 0.12);
		const edgeH = edgeW * (0.5 + Math.random() * 0.7);
		return { edgeW, edgeH };
	});

	const slots = placeNonOverlapping(
		count,
		canvasW,
		canvasH,
		(i) => {
			const s = Math.max(boxSizes[i].edgeW, boxSizes[i].edgeH) * 2;
			return { w: s, h: s };
		},
		50,
		30
	);

	const references: ReferenceShape[] = slots.map((slot, i) => {
		const cx = slot.x + slot.w / 2;
		const cy = slot.y + slot.h / 2;
		const params = generateBox(canvasW, canvasH, vp, horizonY, cx, cy, boxSizes[i].edgeW, boxSizes[i].edgeH);
		return { type: '1-point-box' as const, params };
	});

	const totalExpected = references.reduce(
		(sum, r) => sum + (r.params as PerspectiveBoxParams).expectedEdges.length,
		0
	);

	return {
		unit: 'perspective',
		type: '1-point-box',
		mode,
		strokeCount: totalExpected,
		references,
		availableModes: perspectiveDefinition.availableModes
	};
}

function generateBox(
	_w: number,
	_h: number,
	vp: { x: number; y: number },
	horizonY: number,
	cx: number,
	cy: number,
	edgeW: number,
	edgeH: number
): PerspectiveBoxParams {
	const below = cy > horizonY;
	const corner = { x: cx, y: cy };

	const depthFraction = 0.15 + Math.random() * 0.35;

	const hDir = cx < vp.x ? 1 : -1;
	const horizontal: LineParams = {
		x1: corner.x,
		y1: corner.y,
		x2: corner.x + hDir * edgeW,
		y2: corner.y
	};

	const vDir = below ? -1 : 1;
	const vertical: LineParams = {
		x1: corner.x,
		y1: corner.y,
		x2: corner.x,
		y2: corner.y + vDir * edgeH
	};

	const toVP = { x: vp.x - corner.x, y: vp.y - corner.y };
	const toVPLen = Math.sqrt(toVP.x * toVP.x + toVP.y * toVP.y);
	const depthLen = toVPLen * depthFraction;
	const depth: LineParams = {
		x1: corner.x,
		y1: corner.y,
		x2: corner.x + (toVP.x / toVPLen) * depthLen,
		y2: corner.y + (toVP.y / toVPLen) * depthLen
	};

	const expectedEdges = computeExpectedEdges(corner, horizontal, vertical, depth, vp);

	return {
		horizon: { y: horizonY },
		vanishingPoint: vp,
		givenCorner: corner,
		givenEdges: { horizontal, vertical, depth },
		expectedEdges
	};
}

function computeExpectedEdges(
	corner: { x: number; y: number },
	horizontal: LineParams,
	vertical: LineParams,
	depth: LineParams,
	vp: { x: number; y: number }
): LineParams[] {
	const c0 = corner;
	const c1 = { x: horizontal.x2, y: horizontal.y2 };
	const c2 = { x: vertical.x2, y: vertical.y2 };
	const c3 = {
		x: c1.x + (c2.x - c0.x),
		y: c1.y + (c2.y - c0.y)
	};

	const toVP0 = { x: vp.x - c0.x, y: vp.y - c0.y };
	const toVP0Len = Math.sqrt(toVP0.x * toVP0.x + toVP0.y * toVP0.y);
	const depthVec = { x: depth.x2 - depth.x1, y: depth.y2 - depth.y1 };
	const depthLen = Math.sqrt(depthVec.x * depthVec.x + depthVec.y * depthVec.y);
	const ratio = depthLen / toVP0Len;

	function depthPoint(front: { x: number; y: number }) {
		const tv = { x: vp.x - front.x, y: vp.y - front.y };
		const tvLen = Math.sqrt(tv.x * tv.x + tv.y * tv.y);
		const dLen = tvLen * ratio;
		return {
			x: front.x + (tv.x / tvLen) * dLen,
			y: front.y + (tv.y / tvLen) * dLen
		};
	}

	const b0 = { x: depth.x2, y: depth.y2 };
	const b1 = depthPoint(c1);
	const b2 = depthPoint(c2);
	const b3 = depthPoint(c3);

	return [
		{ x1: c1.x, y1: c1.y, x2: c3.x, y2: c3.y },
		{ x1: c2.x, y1: c2.y, x2: c3.x, y2: c3.y },
		{ x1: c1.x, y1: c1.y, x2: b1.x, y2: b1.y },
		{ x1: c2.x, y1: c2.y, x2: b2.x, y2: b2.y },
		{ x1: c3.x, y1: c3.y, x2: b3.x, y2: b3.y },
		{ x1: b0.x, y1: b0.y, x2: b1.x, y2: b1.y },
		{ x1: b0.x, y1: b0.y, x2: b2.x, y2: b2.y },
		{ x1: b1.x, y1: b1.y, x2: b3.x, y2: b3.y },
		{ x1: b2.x, y1: b2.y, x2: b3.x, y2: b3.y }
	];
}
