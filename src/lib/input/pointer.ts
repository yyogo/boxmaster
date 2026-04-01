import type { ViewTransform } from '$lib/canvas/transform';
import { screenToWorld } from '$lib/canvas/transform';
import { createStroke, addPoint, type Stroke, type StrokePoint } from './stroke';

export type InputMode = 'draw' | 'pan' | 'rotate' | 'idle';

export interface PointerState {
	mode: InputMode;
	activePointers: Map<number, { x: number; y: number }>;
	currentStroke: Stroke | null;
	prevMidpoint: { x: number; y: number } | null;
	prevAngle: number | null;
}

export function createPointerState(): PointerState {
	return {
		mode: 'idle',
		activePointers: new Map(),
		currentStroke: null,
		prevMidpoint: null,
		prevAngle: null
	};
}

interface GestureCallbacks {
	onStrokeStart: (stroke: Stroke) => void;
	onStrokeUpdate: (stroke: Stroke) => void;
	onStrokeEnd: (stroke: Stroke) => void;
	onStrokeCancel: () => void;
	onPan: (dx: number, dy: number) => void;
	onRotate: (dAngle: number) => void;
	getTransform: () => ViewTransform;
	getCenter: () => { x: number; y: number };
	/** Convert viewport clientX/clientY to canvas-local CSS coordinates */
	toCanvasCoords: (clientX: number, clientY: number) => { x: number; y: number };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angleBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
	return Math.atan2(b.y - a.y, b.x - a.x);
}

export function handlePointerDown(
	state: PointerState,
	e: PointerEvent,
	cb: GestureCallbacks
): PointerState {
	const next = { ...state, activePointers: new Map(state.activePointers) };
	const pos = cb.toCanvasCoords(e.clientX, e.clientY);
	next.activePointers.set(e.pointerId, pos);

	if (next.activePointers.size === 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
		const world = screenToWorld(pos, cb.getTransform(), cb.getCenter());
		const stroke = createStroke();
		const point: StrokePoint = {
			x: world.x,
			y: world.y,
			pressure: e.pressure || 0.5,
			timestamp: performance.now()
		};
		addPoint(stroke, point);
		next.currentStroke = stroke;
		next.mode = 'draw';
		cb.onStrokeStart(stroke);
	} else if (next.activePointers.size === 2) {
		if (next.currentStroke) {
			cb.onStrokeCancel();
			next.currentStroke = null;
		}
		const pts = [...next.activePointers.values()];
		next.prevMidpoint = midpoint(pts[0], pts[1]);
		next.prevAngle = angleBetween(pts[0], pts[1]);
		next.mode = 'pan';
	} else if (next.activePointers.size === 1 && e.shiftKey) {
		next.mode = 'pan';
		next.prevMidpoint = pos;
	} else if (next.activePointers.size === 1 && (e.ctrlKey || e.metaKey)) {
		next.mode = 'rotate';
		next.prevMidpoint = pos;
	}

	return next;
}

export function handlePointerMove(
	state: PointerState,
	e: PointerEvent,
	cb: GestureCallbacks
): PointerState {
	const next = { ...state, activePointers: new Map(state.activePointers) };
	const pos = cb.toCanvasCoords(e.clientX, e.clientY);
	next.activePointers.set(e.pointerId, pos);

	if (next.mode === 'draw' && next.currentStroke) {
		const coalescedEvents = (e as any).getCoalescedEvents?.() ?? [];
		for (const ce of coalescedEvents) {
			const cp = cb.toCanvasCoords(ce.clientX, ce.clientY);
			const cw = screenToWorld(cp, cb.getTransform(), cb.getCenter());
			addPoint(next.currentStroke, {
				x: cw.x,
				y: cw.y,
				pressure: ce.pressure || 0.5,
				timestamp: performance.now()
			});
		}
		if (coalescedEvents.length === 0) {
			const world = screenToWorld(pos, cb.getTransform(), cb.getCenter());
			addPoint(next.currentStroke, {
				x: world.x,
				y: world.y,
				pressure: e.pressure || 0.5,
				timestamp: performance.now()
			});
		}
		cb.onStrokeUpdate(next.currentStroke);
	} else if (next.mode === 'pan' && next.activePointers.size === 2) {
		const pts = [...next.activePointers.values()];
		const mid = midpoint(pts[0], pts[1]);
		if (next.prevMidpoint) {
			cb.onPan(mid.x - next.prevMidpoint.x, mid.y - next.prevMidpoint.y);
		}
		const angle = angleBetween(pts[0], pts[1]);
		if (next.prevAngle !== null) {
			cb.onRotate(angle - next.prevAngle);
		}
		next.prevMidpoint = mid;
		next.prevAngle = angle;
	} else if (next.mode === 'pan' && next.prevMidpoint) {
		cb.onPan(pos.x - next.prevMidpoint.x, pos.y - next.prevMidpoint.y);
		next.prevMidpoint = pos;
	} else if (next.mode === 'rotate' && next.prevMidpoint) {
		const center = cb.getCenter();
		const prevAngle = Math.atan2(
			next.prevMidpoint.y - center.y,
			next.prevMidpoint.x - center.x
		);
		const currAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
		cb.onRotate(currAngle - prevAngle);
		next.prevMidpoint = pos;
	}

	return next;
}

export function handlePointerUp(
	state: PointerState,
	e: PointerEvent,
	cb: GestureCallbacks
): PointerState {
	const next = { ...state, activePointers: new Map(state.activePointers) };
	next.activePointers.delete(e.pointerId);

	if (next.mode === 'draw' && next.currentStroke) {
		if (next.currentStroke.rawPoints.length >= 2) {
			cb.onStrokeEnd(next.currentStroke);
		} else {
			cb.onStrokeCancel();
		}
		next.currentStroke = null;
	}

	if (next.activePointers.size === 0) {
		next.mode = 'idle';
		next.prevMidpoint = null;
		next.prevAngle = null;
	}

	return next;
}
