<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Canvas from '$lib/components/Canvas.svelte';
	import ResultsGrid from '$lib/components/ResultsGrid.svelte';
	import type { Stroke } from '$lib/input/stroke';
	import type { ExerciseConfig, ExerciseMode, ExerciseType, ReferenceShape, PerspectiveBoxParams, RectParams, LineParams } from '$lib/exercises/types';
	import type { StrokeScore, ExerciseResult, RoundResult } from '$lib/scoring/types';
	import type { GuideVisibility } from '$lib/canvas/guides';
	import type { FadingLayer } from '$lib/canvas/renderer';
	import { generateExercise } from '$lib/exercises/generator';
	import { createPerspectiveSession, generateSingleBox, type PerspectiveSession } from '$lib/exercises/perspective';
	import { scoreStroke } from '$lib/scoring/highlight';
	import { scorePerspectiveStroke, extractBoxParams } from '$lib/scoring/perspective';
	import { scoreFlow } from '$lib/scoring/flow';
	import { scoreConfidence } from '$lib/scoring/confidence';
	import { scoreFreeLine, scoreFreeRectangle } from '$lib/scoring/free';
	import { saveResult, getResultsByType } from '$lib/storage/db';
	import { computeConsistency } from '$lib/scoring/consistency';

	let exerciseType: ExerciseType = $derived(page.params.type as ExerciseType);

	type Phase = 'drawing' | 'fading' | 'complete';
	let phase: Phase = $state('drawing');
	let roundIndex = $state(0);
	let totalShapes = $state(20);
	let exerciseConfig: ExerciseConfig | null = $state(null);
	let currentStrokes: Stroke[] = $state([]);
	let currentScores: StrokeScore[] | null = $state(null);
	let rounds: RoundResult[] = $state([]);
	let fadingLayer: FadingLayer | null = $state(null);
	let guideVisibility: GuideVisibility = $state('full');
	let lightTheme = $state(true);
	let mode: ExerciseMode = $state('guided');
	let canvasRef: Canvas | null = $state(null);
	let isDrawing = $state(false);
	let isFullscreen = $state(false);
	let containerEl: HTMLElement;
	let perspSession: PerspectiveSession | null = $state(null);
	let exerciseStartTime = 0;
	let totalTime = $state(0);
	let hasStarted = $state(false);

	// Timer mode
	let timerMode = $state(false);
	let timerSeconds = $state(60);
	let timeRemaining = $state(0);
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		// Reset when exercise type changes via navigation
		const _type = exerciseType;
		totalShapes = 20;
		resetExercise();
	});

	function requiredStrokes(type: ExerciseType): number {
		switch (type) {
			case 'line': case 'circle': case 'ellipse': return 1;
			case 'rectangle': return 4;
			case '1-point-box': return 9;
		}
	}

	function modeForVisibility(): GuideVisibility {
		return mode === 'free' ? 'hidden' : mode === 'semi-guided' ? 'hints' : 'full';
	}

	function getAvailableModes(type: ExerciseType): ExerciseMode[] {
		switch (type) {
			case 'line':
			case 'rectangle':
				return ['guided', 'semi-guided', 'free'];
			case 'circle':
			case 'ellipse':
			case '1-point-box':
				return ['guided', 'semi-guided'];
		}
	}

	function getCanvasSize(): { w: number; h: number } {
		if (containerEl) {
			const rect = containerEl.getBoundingClientRect();
			return { w: rect.width, h: rect.height };
		}
		return { w: window.innerWidth, h: window.innerHeight };
	}

	function generateNextShape(): ExerciseConfig {
		const { w, h } = getCanvasSize();
		if (exerciseType === '1-point-box') {
			if (!perspSession) perspSession = createPerspectiveSession(w, h);
			return generateSingleBox(perspSession, w, h, mode as 'guided' | 'semi-guided');
		}
		return generateExercise(exerciseType, mode, w, h, 1);
	}

	function resetExercise() {
		const availableModes = getAvailableModes(exerciseType);
		if (!availableModes.includes(mode)) mode = availableModes[0];

		phase = 'drawing';
		roundIndex = 0;
		rounds = [];
		currentStrokes = [];
		currentScores = null;
		fadingLayer = null;
		hasStarted = false;
		exerciseStartTime = 0;
		totalTime = 0;
		perspSession = null;
		guideVisibility = modeForVisibility();

		stopTimer();
		exerciseConfig = generateNextShape();
	}

	function handleModeChange(newMode: ExerciseMode) {
		mode = newMode;
		resetExercise();
	}

	function handleStrokeStart() {
		isDrawing = true;
		if (!hasStarted) {
			hasStarted = true;
			exerciseStartTime = Date.now();
			if (timerMode) startTimer();
		}
	}

	function isStrokeRelevant(stroke: Stroke): boolean {
		if (mode === 'free') return true;
		if (!exerciseConfig || exerciseConfig.references.length === 0) return true;

		const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
		if (pts.length < 3) return false;

		const ref = exerciseConfig.references[0];
		const params = ref.params;
		const { w: cw, h: ch } = getCanvasSize();
		const minDim = Math.min(cw, ch);
		const minThreshold = minDim * 0.2;

		const strokeCx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
		const strokeCy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

		if ('givenCorner' in params) {
			return isPerspectiveStrokeRelevant(pts, strokeCx, strokeCy, params as PerspectiveBoxParams, minThreshold);
		}

		let shapeCx = 0, shapeCy = 0, shapeRadius = 50;

		if ('w' in params && 'h' in params && 'cx' in params) {
			const rp = params as RectParams;
			shapeCx = rp.cx;
			shapeCy = rp.cy;
			shapeRadius = Math.sqrt(rp.w * rp.w + rp.h * rp.h) / 2;
		} else if ('cx' in params && 'cy' in params) {
			shapeCx = (params as { cx: number; cy: number }).cx;
			shapeCy = (params as { cx: number; cy: number }).cy;
			shapeRadius = 'r' in params
				? (params as { r: number }).r
				: Math.max('rx' in params ? (params as { rx: number }).rx : 0, 'ry' in params ? (params as { ry: number }).ry : 0);
		} else if ('x1' in params && 'x2' in params) {
			const lp = params as LineParams;
			shapeCx = (lp.x1 + lp.x2) / 2;
			shapeCy = (lp.y1 + lp.y2) / 2;
			const dx = lp.x2 - lp.x1;
			const dy = lp.y2 - lp.y1;
			shapeRadius = Math.sqrt(dx * dx + dy * dy) / 2;
		}

		const threshold = Math.max(shapeRadius * 2.5, minThreshold);
		const dist = Math.sqrt((strokeCx - shapeCx) ** 2 + (strokeCy - shapeCy) ** 2);
		return dist < threshold;
	}

	function isPerspectiveStrokeRelevant(
		pts: { x: number; y: number }[],
		strokeCx: number,
		strokeCy: number,
		bp: PerspectiveBoxParams,
		minThreshold: number
	): boolean {
		// Bounding box of all box geometry
		const allPts = [
			bp.givenCorner,
			{ x: bp.givenEdges.horizontal.x2, y: bp.givenEdges.horizontal.y2 },
			{ x: bp.givenEdges.vertical.x2, y: bp.givenEdges.vertical.y2 },
			{ x: bp.givenEdges.depth.x2, y: bp.givenEdges.depth.y2 }
		];
		for (const e of bp.expectedEdges) {
			allPts.push({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
		}
		const xs = allPts.map((p) => p.x);
		const ys = allPts.map((p) => p.y);
		const bCx = (Math.min(...xs) + Math.max(...xs)) / 2;
		const bCy = (Math.min(...ys) + Math.max(...ys)) / 2;
		const bRadius = Math.sqrt((Math.max(...xs) - Math.min(...xs)) ** 2 + (Math.max(...ys) - Math.min(...ys)) ** 2) / 2;

		const dist = Math.sqrt((strokeCx - bCx) ** 2 + (strokeCy - bCy) ** 2);
		if (dist > Math.max(bRadius * 1.5, minThreshold)) return false;

		// Reject strokes that trace the given (scaffold) edges
		const givenEdges = [bp.givenEdges.horizontal, bp.givenEdges.vertical, bp.givenEdges.depth];
		const sampleStep = Math.max(1, Math.floor(pts.length / 10));

		for (const edge of givenEdges) {
			const edgeLen = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
			if (edgeLen < 1) continue;

			let totalDist = 0;
			let samples = 0;
			for (let i = 0; i < pts.length; i += sampleStep) {
				totalDist += ptSegDist(pts[i].x, pts[i].y, edge);
				samples++;
			}
			const avgDist = totalDist / samples;

			// Stroke length along the edge direction
			const strokeLen = Math.sqrt((pts[pts.length - 1].x - pts[0].x) ** 2 + (pts[pts.length - 1].y - pts[0].y) ** 2);
			const lenRatio = strokeLen / edgeLen;

			// Close to given edge AND roughly the same length => tracing it
			if (avgDist < Math.max(edgeLen * 0.18, 20) && lenRatio > 0.3) return false;
		}

		return true;
	}

	function ptSegDist(px: number, py: number, seg: LineParams): number {
		const dx = seg.x2 - seg.x1;
		const dy = seg.y2 - seg.y1;
		const lenSq = dx * dx + dy * dy;
		if (lenSq === 0) return Math.sqrt((px - seg.x1) ** 2 + (py - seg.y1) ** 2);
		const t = Math.max(0, Math.min(1, ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq));
		const projX = seg.x1 + t * dx;
		const projY = seg.y1 + t * dy;
		return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
	}

	function handleStrokeComplete(stroke: Stroke) {
		isDrawing = false;
		if (phase !== 'drawing') return;
		if (!isStrokeRelevant(stroke)) return;
		currentStrokes = [...currentStrokes, stroke];

		const needed = requiredStrokes(exerciseType);
		if (currentStrokes.length >= needed) {
			scoreAndAdvance();
		}
	}

	function handleStrokeEnd() {
		isDrawing = false;
	}

	function handleUndo() {
		if (phase !== 'drawing' || currentStrokes.length === 0) return;
		currentStrokes = currentStrokes.slice(0, -1);
	}

	function handleSkip() {
		if (phase !== 'drawing') return;
		startFade();
	}

	function scoreCurrentShape(): { strokeScores: StrokeScore[]; shapeScore: number } {
		if (!exerciseConfig || currentStrokes.length === 0) {
			return { strokeScores: [], shapeScore: 0 };
		}

		const strokeScores: StrokeScore[] = [];

		if (mode === 'free' && exerciseType === 'line') {
			for (const stroke of currentStrokes) {
				const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
				const { accuracy } = scoreFreeLine(pts);
				strokeScores.push({ accuracy, flow: scoreFlow(pts), confidence: scoreConfidence(pts), segments: [] });
			}
		} else if (mode === 'free' && exerciseType === 'rectangle') {
			const rectResult = scoreFreeRectangle(currentStrokes.map((s) => ({ points: s.smoothedPoints.length > 0 ? s.smoothedPoints : s.rawPoints })));
			for (const stroke of currentStrokes) {
				const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
				strokeScores.push({ accuracy: rectResult.accuracy, flow: scoreFlow(pts), confidence: scoreConfidence(pts), segments: [] });
			}
		} else if (exerciseType === '1-point-box') {
			const boxes = extractBoxParams(exerciseConfig.references);
			for (const stroke of currentStrokes) {
				const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
				strokeScores.push({ accuracy: scorePerspectiveStroke(pts, boxes), flow: scoreFlow(pts), confidence: scoreConfidence(pts), segments: [] });
			}
		} else {
			for (let i = 0; i < currentStrokes.length; i++) {
				const ref = exerciseConfig.references[0];
				const pts = currentStrokes[i].smoothedPoints.length > 0 ? currentStrokes[i].smoothedPoints : currentStrokes[i].rawPoints;
				strokeScores.push(scoreStroke(pts, ref, i));
			}
		}

		const shapeScore = strokeScores.length > 0
			? Math.round(strokeScores.reduce((s, sc) => s + (sc.accuracy * 0.5 + sc.flow * 0.3 + (sc.confidence ?? sc.flow) * 0.2), 0) / strokeScores.length)
			: 0;

		return { strokeScores, shapeScore };
	}

	function scoreAndAdvance() {
		const { strokeScores, shapeScore } = scoreCurrentShape();
		currentScores = strokeScores;

		const round: RoundResult = {
			reference: exerciseConfig!.references[0],
			strokes: [...currentStrokes],
			strokeScores,
			shapeScore
		};
		rounds = [...rounds, round];

		startFade();
	}

	function startFade() {
		const nextIndex = roundIndex + 1;
		const timerExpired = timerMode && timeRemaining <= 0;

		if (nextIndex >= totalShapes || timerExpired) {
			finishExercise();
			return;
		}

		// Put old shape+strokes into fading layer
		fadingLayer = {
			config: exerciseConfig!,
			strokes: [...currentStrokes],
			scores: currentScores,
			alpha: 1
		};

		// Immediately advance to next shape
		roundIndex = nextIndex;
		currentStrokes = [];
		currentScores = null;
		guideVisibility = modeForVisibility();
		exerciseConfig = generateNextShape();
		phase = 'drawing';

		// Animate the fading layer out
		const fadeStart = performance.now();
		const fadeDuration = 800;

		function tick(now: number) {
			const elapsed = now - fadeStart;
			const alpha = Math.max(0, 1 - elapsed / fadeDuration);
			if (fadingLayer) fadingLayer = { ...fadingLayer, alpha };
			if (elapsed < fadeDuration) {
				requestAnimationFrame(tick);
			} else {
				fadingLayer = null;
			}
		}
		requestAnimationFrame(tick);
	}

	async function finishExercise() {
		phase = 'complete';
		stopTimer();
		totalTime = Date.now() - exerciseStartTime;

		if (rounds.length === 0) return;

		const aggregateScore = Math.round(
			rounds.reduce((s, r) => s + r.shapeScore, 0) / rounds.length
		);

		const history = await getResultsByType(exerciseType);
		const consistency = computeConsistency([...history, { aggregateScore } as ExerciseResult]);

		const allScores = rounds.flatMap((r) => r.strokeScores);
		await saveResult({
			id: `${exerciseType}-${Date.now()}`,
			timestamp: Date.now(),
			unit: exerciseType === '1-point-box' ? 'perspective' : 'basic-shapes',
			exerciseType,
			mode,
			strokeCount: rounds.reduce((s, r) => s + r.strokes.length, 0),
			scores: allScores,
			aggregateScore,
			consistency
		});
	}

	function startTimer() {
		timeRemaining = timerSeconds;
		timerInterval = setInterval(() => {
			timeRemaining--;
			if (timeRemaining <= 0) {
				timeRemaining = 0;
				stopTimer();
				if (phase === 'drawing') {
					if (currentStrokes.length > 0) {
						scoreAndAdvance();
					} else {
						finishExercise();
					}
				}
			}
		}, 1000);
	}

	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
	}

	function handleRetry() {
		resetExercise();
		canvasRef?.resetView();
	}

	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			containerEl?.requestFullscreen();
			isFullscreen = true;
		} else {
			document.exitFullscreen();
			isFullscreen = false;
		}
	}

	function toggleTimer() {
		if (hasStarted) return;
		timerMode = !timerMode;
	}

	function cycleTimerDuration() {
		if (hasStarted) return;
		const durations = [30, 60, 120];
		const idx = durations.indexOf(timerSeconds);
		timerSeconds = durations[(idx + 1) % durations.length];
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		switch (e.key) {
			case 'z':
				if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleUndo(); }
				break;
			case 'Escape':
				if (isFullscreen) { document.exitFullscreen(); isFullscreen = false; }
				break;
			case 'Enter':
				if (phase === 'complete') handleRetry();
				break;
			case 'r':
				if (!e.ctrlKey && !e.metaKey) canvasRef?.resetView();
				break;
			case 'f':
				if (!e.ctrlKey && !e.metaKey) toggleFullscreen();
				break;
			case 's':
				if (!e.ctrlKey && !e.metaKey && phase === 'drawing') handleSkip();
				break;
			case 't':
				if (!e.ctrlKey && !e.metaKey) lightTheme = !lightTheme;
				break;
		}
	}

	let sessionAggregateScore = $derived(
		rounds.length > 0
			? Math.round(rounds.reduce((s, r) => s + r.shapeScore, 0) / rounds.length)
			: 0
	);

	let progressFraction = $derived(
		totalShapes > 0 ? (roundIndex + (phase === 'drawing' ? 0 : 1)) / totalShapes : 0
	);

	onMount(() => {
		resetExercise();
		document.addEventListener('fullscreenchange', () => {
			isFullscreen = !!document.fullscreenElement;
		});
		return () => stopTimer();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="exercise-container" class:fullscreen={isFullscreen} class:light={lightTheme} bind:this={containerEl}>
	{#if phase !== 'complete'}
		<Canvas
			bind:this={canvasRef}
			{exerciseConfig}
			{guideVisibility}
			strokes={currentStrokes}
			scores={currentScores}
			{fadingLayer}
			inputEnabled={phase === 'drawing'}
			bgColor={lightTheme ? '#ffffff' : undefined}
			onStrokeComplete={handleStrokeComplete}
			onStrokeStart={handleStrokeStart}
			onStrokeEnd={handleStrokeEnd}
		/>

		<!-- Progress bar -->
		<div class="progress-bar">
			<div class="progress-fill" style="width: {progressFraction * 100}%"></div>
		</div>

		<!-- Top overlay -->
		<div class="overlay-top" class:hidden={isDrawing}>
			<button class="pill-btn" onclick={() => goto('/')}>← Back</button>

			<div class="mode-pills">
				{#each getAvailableModes(exerciseType) as m}
					<button
						class="pill-btn"
						class:active={mode === m}
						onclick={() => handleModeChange(m)}
						disabled={hasStarted}
					>{m}</button>
				{/each}
			</div>

			<div class="top-right">
				<div class="count-control">
					<input
						type="range"
						min="5"
						max="40"
						bind:value={totalShapes}
						disabled={hasStarted}
						class="count-slider"
					/>
					<span class="count-label">{totalShapes}</span>
				</div>

				{#if timerMode}
					<button
						class="pill-btn active"
						onclick={(e) => { e.stopPropagation(); cycleTimerDuration(); }}
						disabled={hasStarted}
					>{timerSeconds}s</button>
					<button
						class="pill-btn"
						onclick={toggleTimer}
						disabled={hasStarted}
					>✕</button>
				{:else}
					<button
						class="pill-btn"
						onclick={toggleTimer}
						disabled={hasStarted}
					>Timer</button>
				{/if}

				{#if timerMode && hasStarted}
					<span class="timer-display" class:urgent={timeRemaining <= 10}>
						{timeRemaining}s
					</span>
				{/if}

				<span class="stroke-count">{roundIndex + 1} / {totalShapes}</span>

				<button class="pill-btn icon" onclick={() => lightTheme = !lightTheme} title="Toggle theme (T)">
					{lightTheme ? '◑' : '◐'}
				</button>
				<button class="pill-btn icon" onclick={toggleFullscreen} title="Fullscreen (F)">
					{isFullscreen ? '⊡' : '⊞'}
				</button>
			</div>
		</div>

		<!-- Bottom overlay -->
		<div class="overlay-bottom" class:hidden={isDrawing}>
			<button class="pill-btn" onclick={handleUndo} disabled={currentStrokes.length === 0 || phase !== 'drawing'}>Undo</button>
			<button class="pill-btn" onclick={handleSkip} disabled={phase !== 'drawing'} title="Skip (S)">Skip</button>
			<button class="pill-btn" onclick={() => canvasRef?.resetView()} title="Reset view (R)">⟲</button>
		</div>

		<!-- Live score flash -->
		{#if rounds.length > 0 && phase === 'drawing'}
			<div class="live-score" class:hidden={isDrawing}>
				{rounds[rounds.length - 1].shapeScore}
			</div>
		{/if}
	{:else}
		<ResultsGrid
			{rounds}
			exerciseType={exerciseType}
			aggregateScore={sessionAggregateScore}
			{totalTime}
			onRetry={handleRetry}
		/>
	{/if}
</div>

<style>
	.exercise-container {
		position: fixed;
		inset: 0;
		background: #1a1a2e;
		display: flex;
		flex-direction: column;
	}

	.exercise-container.light {
		background: #ffffff;
	}

	.exercise-container :global(.drawing-canvas) {
		position: absolute;
		inset: 0;
		width: 100% !important;
		height: 100% !important;
		border-radius: 0;
	}

	/* --- Progress bar --- */

	.progress-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.06);
		z-index: 15;
	}

	.progress-fill {
		height: 100%;
		background: rgba(76, 110, 245, 0.7);
		transition: width 0.3s ease;
	}

	/* --- Overlays --- */

	.overlay-top,
	.overlay-bottom {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		z-index: 10;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	.overlay-top > *,
	.overlay-bottom > * {
		pointer-events: auto;
	}

	.overlay-top {
		top: 3px;
		background: linear-gradient(to bottom, rgba(13, 13, 26, 0.7) 0%, transparent 100%);
	}

	:global(.exercise-container.light) .overlay-top {
		background: linear-gradient(to bottom, rgba(240, 240, 245, 0.8) 0%, transparent 100%);
	}

	.overlay-bottom {
		bottom: 0;
		gap: 8px;
		justify-content: center;
		background: linear-gradient(to top, rgba(13, 13, 26, 0.7) 0%, transparent 100%);
		padding-bottom: 20px;
	}

	:global(.exercise-container.light) .overlay-bottom {
		background: linear-gradient(to top, rgba(240, 240, 245, 0.8) 0%, transparent 100%);
	}

	:global(.exercise-container.light) .pill-btn {
		background: rgba(240, 240, 248, 0.85);
		color: #333;
		border-color: rgba(0, 0, 0, 0.12);
	}

	:global(.exercise-container.light) .pill-btn:hover:not(:disabled) {
		background: rgba(220, 220, 235, 0.95);
	}

	:global(.exercise-container.light) .pill-btn.active {
		background: rgba(76, 110, 245, 0.8);
		color: #fff;
	}

	.hidden {
		opacity: 0;
		pointer-events: none !important;
	}

	.hidden > * {
		pointer-events: none !important;
	}

	/* --- Pill buttons --- */

	.pill-btn {
		padding: 6px 14px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(20, 20, 40, 0.8);
		color: #ccccee;
		border-radius: 20px;
		cursor: pointer;
		font-size: 0.8rem;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		transition: all 0.15s;
		text-transform: capitalize;
		white-space: nowrap;
	}

	.pill-btn:hover:not(:disabled) {
		background: rgba(40, 40, 80, 0.9);
		border-color: rgba(255, 255, 255, 0.2);
	}

	.pill-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.pill-btn.active {
		background: rgba(76, 110, 245, 0.7);
		border-color: rgba(76, 110, 245, 0.5);
		color: #fff;
	}

	.pill-btn.icon {
		padding: 6px 10px;
		font-size: 1rem;
	}

	.mode-pills {
		display: flex;
		gap: 4px;
	}

	.top-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.count-control {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.count-slider {
		width: 70px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: rgba(255, 255, 255, 0.15);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.count-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: rgba(200, 200, 230, 0.8);
		border: none;
		cursor: pointer;
	}

	.count-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: rgba(200, 200, 230, 0.8);
		border: none;
		cursor: pointer;
	}

	.count-slider:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.count-label {
		font-size: 0.75rem;
		color: rgba(200, 200, 230, 0.6);
		font-variant-numeric: tabular-nums;
		min-width: 16px;
		text-align: center;
	}

	.stroke-count {
		font-size: 0.8rem;
		color: rgba(200, 200, 230, 0.6);
		font-variant-numeric: tabular-nums;
	}

	.timer-display {
		font-size: 0.85rem;
		color: rgba(200, 200, 230, 0.8);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.timer-display.urgent {
		color: #f87171;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	/* --- Live score flash --- */

	.live-score {
		position: absolute;
		top: 60px;
		right: 20px;
		font-size: 2rem;
		font-weight: 700;
		color: rgba(200, 200, 230, 0.5);
		z-index: 8;
		font-variant-numeric: tabular-nums;
		transition: opacity 0.2s;
		animation: scorePop 0.3s ease-out;
	}

	@keyframes scorePop {
		from { transform: scale(1.3); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}

	@media (max-width: 640px) {
		.pill-btn {
			font-size: 0.75rem;
			padding: 5px 10px;
		}
	}
</style>
