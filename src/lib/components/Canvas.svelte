<script lang="ts">
	import { onMount } from 'svelte';
	import type { Stroke } from '$lib/input/stroke';
	import type { ExerciseConfig } from '$lib/exercises/types';
	import type { StrokeScore } from '$lib/scoring/types';
	import type { GuideVisibility } from '$lib/canvas/guides';
	import { identityTransform, screenToWorld, type ViewTransform } from '$lib/canvas/transform';
	import type { CoordTransform } from '$lib/exercises/plugin';
	import {
		createPointerState,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		type PointerState
	} from '$lib/input/pointer';
	import { render, type RenderState, type FadingLayer, type HatchProgressState } from '$lib/canvas/renderer';

	interface Props {
		exerciseConfig: ExerciseConfig | null;
		guideVisibility: GuideVisibility;
		strokes: Stroke[];
		scores: StrokeScore[] | null;
		fadingLayer?: FadingLayer | null;
		/** Basic hatching: progressive region fill (completed/total strokes) */
		hatchProgress?: HatchProgressState | null;
		inputEnabled?: boolean;
		penOnly?: boolean;
		bgColor?: string;
		onStrokeComplete?: (stroke: Stroke) => void;
		onStrokeStart?: () => void;
		onStrokeEnd?: () => void;
		onPenDetected?: () => void;
	}

	let {
		exerciseConfig,
		guideVisibility,
		strokes,
		scores = null,
		fadingLayer = null,
		hatchProgress = null,
		inputEnabled = true,
		penOnly = false,
		bgColor,
		onStrokeComplete,
		onStrokeStart,
		onStrokeEnd,
		onPenDetected
	}: Props = $props();

	let canvasEl: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let transform: ViewTransform = $state(identityTransform());
	let pointerState: PointerState = $state(createPointerState());
	let currentStroke: Stroke | null = $state(null);
	let animFrame = 0;

	function getCenter() {
		const rect = canvasEl.getBoundingClientRect();
		return { x: rect.width / 2, y: rect.height / 2 };
	}

	function toCanvasCoords(e: PointerEvent) {
		return { x: e.offsetX, y: e.offsetY };
	}

	const callbacks = {
		onStrokeStart: (stroke: Stroke) => {
			currentStroke = stroke;
			onStrokeStart?.();
		},
		onStrokeUpdate: (stroke: Stroke) => {
			currentStroke = { ...stroke };
		},
		onStrokeEnd: (stroke: Stroke) => {
			onStrokeComplete?.(stroke);
			onStrokeEnd?.();
			currentStroke = null;
		},
		onStrokeCancel: () => {
			onStrokeEnd?.();
			currentStroke = null;
		},
		onPan: (dx: number, dy: number) => {
			const cos = Math.cos(-transform.rotation);
			const sin = Math.sin(-transform.rotation);
			const rdx = cos * dx - sin * dy;
			const rdy = sin * dx + cos * dy;
			transform = { ...transform, panX: transform.panX + rdx, panY: transform.panY + rdy };
		},
		onRotate: (dAngle: number) => {
			transform = { ...transform, rotation: transform.rotation + dAngle };
		},
		getTransform: () => transform,
		getCenter,
		toCanvasCoords
	};

	let penSeen = false;

	function onPointerDown(e: PointerEvent) {
		if (!inputEnabled) return;

		if (e.pointerType === 'pen' && !penSeen) {
			penSeen = true;
			onPenDetected?.();
		}

		// In pen-only mode, single-finger touch becomes pan instead of draw
		if (penOnly && e.pointerType === 'touch' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			canvasEl.setPointerCapture(e.pointerId);
			const next = { ...pointerState, activePointers: new Map(pointerState.activePointers) };
			const pos = toCanvasCoords(e);
			next.activePointers.set(e.pointerId, pos);
			next.mode = 'pan';
			next.prevMidpoint = pos;
			pointerState = next;
			return;
		}

		canvasEl.setPointerCapture(e.pointerId);
		pointerState = handlePointerDown(pointerState, e, callbacks);
	}

	function onPointerMove(e: PointerEvent) {
		if (!inputEnabled) return;
		pointerState = handlePointerMove(pointerState, e, callbacks);
	}

	function onPointerUp(e: PointerEvent) {
		if (!inputEnabled) return;
		pointerState = handlePointerUp(pointerState, e, callbacks);
	}

	function onContextMenu(e: Event) {
		e.preventDefault();
	}

	export function resetView() {
		transform = identityTransform();
	}

	export function getToWorld(): CoordTransform {
		const t = transform;
		const c = getCenter();
		return (x: number, y: number) => screenToWorld({ x, y }, t, c);
	}

	function resizeCanvas() {
		if (!canvasEl) return;
		const rect = canvasEl.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvasEl.width = rect.width * dpr;
		canvasEl.height = rect.height * dpr;
		ctx?.scale(dpr, dpr);
	}

	function renderLoop() {
		if (!ctx || !canvasEl) return;
		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const state: RenderState = {
			exerciseConfig,
			strokes,
			currentStroke,
			transform,
			guideVisibility,
			scores,
			fadingLayer,
			bgColor,
			hatchProgress
		};
		render(ctx, canvasEl, state);
		ctx.restore();
		animFrame = requestAnimationFrame(renderLoop);
	}

	function preventTouch(e: TouchEvent) { e.preventDefault(); }

	onMount(() => {
		ctx = canvasEl.getContext('2d');
		resizeCanvas();

		const resizeObs = new ResizeObserver(() => resizeCanvas());
		resizeObs.observe(canvasEl);

		// iOS ignores touch-action:none CSS — must preventDefault on touch events directly
		canvasEl.addEventListener('touchstart', preventTouch, { passive: false });
		canvasEl.addEventListener('touchmove', preventTouch, { passive: false });
		canvasEl.addEventListener('touchend', preventTouch, { passive: false });
		canvasEl.addEventListener('touchcancel', preventTouch, { passive: false });

		animFrame = requestAnimationFrame(renderLoop);

		return () => {
			cancelAnimationFrame(animFrame);
			resizeObs.disconnect();
			canvasEl.removeEventListener('touchstart', preventTouch);
			canvasEl.removeEventListener('touchmove', preventTouch);
			canvasEl.removeEventListener('touchend', preventTouch);
			canvasEl.removeEventListener('touchcancel', preventTouch);
		};
	});
</script>

<canvas
	bind:this={canvasEl}
	class="drawing-canvas"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	oncontextmenu={onContextMenu}
	style="touch-action: none;"
></canvas>

<style>
	.drawing-canvas {
		width: 100%;
		height: 100%;
		display: block;
		cursor: crosshair;
	}
</style>
