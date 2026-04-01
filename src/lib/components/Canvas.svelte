<script lang="ts">
	import { onMount } from 'svelte';
	import type { Stroke } from '$lib/input/stroke';
	import type { ExerciseConfig } from '$lib/exercises/types';
	import type { StrokeScore } from '$lib/scoring/types';
	import type { GuideVisibility } from '$lib/canvas/guides';
	import { identityTransform, type ViewTransform } from '$lib/canvas/transform';
	import {
		createPointerState,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		type PointerState
	} from '$lib/input/pointer';
	import { render, type RenderState, type FadingLayer } from '$lib/canvas/renderer';

	interface Props {
		exerciseConfig: ExerciseConfig | null;
		guideVisibility: GuideVisibility;
		strokes: Stroke[];
		scores: StrokeScore[] | null;
		fadingLayer?: FadingLayer | null;
		inputEnabled?: boolean;
		bgColor?: string;
		onStrokeComplete?: (stroke: Stroke) => void;
		onStrokeStart?: () => void;
		onStrokeEnd?: () => void;
	}

	let {
		exerciseConfig,
		guideVisibility,
		strokes,
		scores = null,
		fadingLayer = null,
		inputEnabled = true,
		bgColor,
		onStrokeComplete,
		onStrokeStart,
		onStrokeEnd
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

	function toCanvasCoords(clientX: number, clientY: number) {
		const rect = canvasEl.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
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
			transform = { ...transform, panX: transform.panX + dx, panY: transform.panY + dy };
		},
		onRotate: (dAngle: number) => {
			transform = { ...transform, rotation: transform.rotation + dAngle };
		},
		getTransform: () => transform,
		getCenter,
		toCanvasCoords
	};

	function onPointerDown(e: PointerEvent) {
		if (!inputEnabled) return;
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
			bgColor
		};
		render(ctx, canvasEl, state);
		ctx.restore();
		animFrame = requestAnimationFrame(renderLoop);
	}

	onMount(() => {
		ctx = canvasEl.getContext('2d');
		resizeCanvas();

		const resizeObs = new ResizeObserver(() => resizeCanvas());
		resizeObs.observe(canvasEl);

		animFrame = requestAnimationFrame(renderLoop);

		return () => {
			cancelAnimationFrame(animFrame);
			resizeObs.disconnect();
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
