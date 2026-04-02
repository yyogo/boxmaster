<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import Canvas from '$lib/components/Canvas.svelte';
	import ResultsGrid from '$lib/components/ResultsGrid.svelte';
	import type { Stroke } from '$lib/input/stroke';
	import type { ExerciseConfig, ExerciseMode } from '$lib/exercises/types';
	import type { StrokeScore, ExerciseResult, RoundResult } from '$lib/scoring/types';
	import type { GuideVisibility } from '$lib/canvas/guides';
	import type { FadingLayer } from '$lib/canvas/renderer';
	import '$lib/exercises/init';
	import { getPlugin } from '$lib/exercises/registry';
	import { defaultShapeScore } from '$lib/exercises/plugin';
	import { saveResult, getResultsByType } from '$lib/storage/db';
	import { computeConsistency } from '$lib/scoring/consistency';
	import { loadPrefs, updatePrefs } from '$lib/storage/prefs';

	let exerciseType: string = $derived(page.params.type as string);
	let plugin = $derived.by(() => {
		if (!exerciseType) return null;
		try { return getPlugin(exerciseType); } catch { return null; }
	});

	const savedPrefs = loadPrefs();

	type Phase = 'drawing' | 'fading' | 'complete';
	let phase: Phase = $state('drawing');
	let roundIndex = $state(0);
	let totalShapes = $state(savedPrefs.totalShapes);
	let exerciseConfig: ExerciseConfig | null = $state(null);
	let currentStrokes: Stroke[] = $state([]);
	let currentScores: StrokeScore[] | null = $state(null);
	let rounds: RoundResult[] = $state([]);
	let fadingLayer: FadingLayer | null = $state(null);
	let guideVisibility: GuideVisibility = $state('full');
	let lightTheme = $state(savedPrefs.lightTheme);
	let mode: ExerciseMode = $state('guided');
	let canvasRef: Canvas | null = $state(null);
	let isDrawing = $state(false);
	let penDetected = $state(false);
	let penOnly = $state(savedPrefs.penOnly);
	let containerEl: HTMLElement;
	let session: unknown = $state(null);
	let exerciseStartTime = 0;
	let totalTime = $state(0);
	let hasStarted = $state(false);

	let timerMode = $state(savedPrefs.timerMode);
	let timerSeconds = $state(savedPrefs.timerSeconds);
	let timeRemaining = $state(0);
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		exerciseType; // track only this
		untrack(() => {
			if (!plugin) return;
			const savedMode = loadPrefs().modes[exerciseType];
			if (savedMode && plugin.availableModes.includes(savedMode)) {
				mode = savedMode;
			}
			totalShapes = loadPrefs().totalShapes ?? plugin.defaultCount;
			resetExercise();
		});
	});

	$effect(() => {
		updatePrefs({
			lightTheme,
			totalShapes,
			timerMode,
			timerSeconds,
			penOnly,
			modes: exerciseType ? { [exerciseType]: mode } : {}
		});
	});

	function modeForVisibility(): GuideVisibility {
		return mode === 'free' ? 'hidden' : mode === 'challenge' ? 'hints' : 'full';
	}

	function getCanvasSize(): { w: number; h: number } {
		if (containerEl) {
			const rect = containerEl.getBoundingClientRect();
			return { w: rect.width, h: rect.height };
		}
		return { w: window.innerWidth, h: window.innerHeight };
	}

	function generateNextShape(): ExerciseConfig | null {
		if (!plugin) return null;
		const { w, h } = getCanvasSize();
		const toWorld = canvasRef?.getToWorld();
		if (plugin.generateFromSession) {
			if (!session) session = plugin.createSession?.(w, h) ?? null;
			if (session) return plugin.generateFromSession(session, mode, w, h, toWorld);
		}
		return plugin.generate(mode, w, h, toWorld);
	}

	function resetExercise() {
		if (!plugin) return;
		if (!plugin.availableModes.includes(mode)) mode = plugin.availableModes[0];

		phase = 'drawing';
		roundIndex = 0;
		rounds = [];
		currentStrokes = [];
		currentScores = null;
		fadingLayer = null;
		hasStarted = false;
		exerciseStartTime = 0;
		totalTime = 0;
		session = null;
		guideVisibility = modeForVisibility();
		canvasRef?.resetView();

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

	function handlePenDetected() {
		if (!penDetected) {
			penDetected = true;
			penOnly = true;
		}
	}

	function isStrokeRelevant(stroke: Stroke): boolean {
		if (!plugin || !exerciseConfig || exerciseConfig.references.length === 0) return true;

		const ref = exerciseConfig.references[0];
		const { w, h } = getCanvasSize();

		if (plugin.isStrokeRelevant) {
			return plugin.isStrokeRelevant(stroke, ref, w, h, mode);
		}
		return true;
	}

	function handleStrokeComplete(stroke: Stroke) {
		isDrawing = false;
		if (phase !== 'drawing') return;
		if (!isStrokeRelevant(stroke)) return;
		currentStrokes = [...currentStrokes, stroke];

		if (plugin && currentStrokes.length >= plugin.requiredStrokes) {
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
		if (!plugin || !exerciseConfig || currentStrokes.length === 0) {
			return { strokeScores: [], shapeScore: 0 };
		}

		const ref = exerciseConfig.references[0];
		const strokeScores: StrokeScore[] = currentStrokes.map((stroke, i) => {
			const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
			return plugin!.scoreStroke(pts, ref, i, mode);
		});

		const shapeScore = plugin.computeShapeScore
			? plugin.computeShapeScore(strokeScores)
			: defaultShapeScore(strokeScores);

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

		fadingLayer = {
			config: exerciseConfig!,
			strokes: [...currentStrokes],
			scores: currentScores,
			alpha: 1,
			guideVisibility
		};

		roundIndex = nextIndex;
		currentStrokes = [];
		currentScores = null;
		guideVisibility = modeForVisibility();

		exerciseConfig = generateNextShape();
		phase = 'drawing';

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

		// Snapshot reactive state to strip Svelte 5 Proxies before
		// passing to IndexedDB (structured clone can't handle Proxies).
		const plainRounds = $state.snapshot(rounds);

		const aggregateScore = Math.round(
			plainRounds.reduce((s, r) => s + r.shapeScore, 0) / plainRounds.length
		);

		try {
			const history = await getResultsByType(exerciseType);
			const consistency = computeConsistency([...history, { aggregateScore } as ExerciseResult]);

			const allScores = plainRounds.flatMap((r) => r.strokeScores);
			await saveResult({
				id: `${exerciseType}-${Date.now()}`,
				timestamp: Date.now(),
				unit: plugin?.unit ?? 'basic-shapes',
				exerciseType,
				mode,
				strokeCount: plainRounds.reduce((s, r) => s + r.strokes.length, 0),
				scores: allScores,
				aggregateScore,
				consistency
			});
		} catch (err) {
			console.error('Failed to save exercise result:', err);
		}
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
			case 'Enter':
				if (phase === 'complete') handleRetry();
				break;
			case 'r':
				if (!e.ctrlKey && !e.metaKey) canvasRef?.resetView();
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

	function preventGesture(e: Event) { e.preventDefault(); }

	onMount(() => {
		resetExercise();

		// Prevent Safari pinch-to-zoom and double-tap-zoom
		document.addEventListener('gesturestart', preventGesture, { passive: false });
		document.addEventListener('gesturechange', preventGesture, { passive: false });
		document.addEventListener('gestureend', preventGesture, { passive: false });

		return () => {
			stopTimer();
			document.removeEventListener('gesturestart', preventGesture);
			document.removeEventListener('gesturechange', preventGesture);
			document.removeEventListener('gestureend', preventGesture);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="exercise-container" class:light={lightTheme} bind:this={containerEl}>
	{#if phase !== 'complete'}
		<Canvas
			bind:this={canvasRef}
			{exerciseConfig}
			{guideVisibility}
			strokes={currentStrokes}
			scores={currentScores}
			{fadingLayer}
			inputEnabled={phase === 'drawing'}
			{penOnly}
			bgColor={lightTheme ? '#ffffff' : undefined}
			onStrokeComplete={handleStrokeComplete}
			onStrokeStart={handleStrokeStart}
			onStrokeEnd={handleStrokeEnd}
			onPenDetected={handlePenDetected}
		/>

		<!-- Progress bar -->
		<div class="progress-bar">
			<div class="progress-fill" style="width: {progressFraction * 100}%"></div>
		</div>

		{#if plugin?.requiresPressure && !penDetected}
			<div class="pressure-warning">Use a pressure-sensitive pen for this exercise</div>
		{/if}

		<!-- Top overlay -->
		<div class="overlay-top" class:hidden={isDrawing}>
			<button class="pill-btn" onclick={() => goto('/')}>← Back</button>

			<div class="mode-pills">
				{#each plugin?.availableModes ?? [] as m}
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
			</div>
		</div>

		<!-- Bottom overlay -->
		<div class="overlay-bottom" class:hidden={isDrawing}>
			<button class="pill-btn" onclick={handleUndo} disabled={currentStrokes.length === 0 || phase !== 'drawing'}>Undo</button>
			<button class="pill-btn" onclick={handleSkip} disabled={phase !== 'drawing'} title="Skip (S)">Skip</button>
			<button class="pill-btn" onclick={() => canvasRef?.resetView()} title="Reset view (R)">⟲</button>
			{#if penDetected}
				<button
					class="pill-btn icon"
					class:active={penOnly}
					onclick={() => penOnly = !penOnly}
					title={penOnly ? 'Pen only — tap to allow finger drawing' : 'Finger drawing enabled — tap for pen only'}
				>✏️</button>
			{/if}
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
			onClose={handleRetry}
			onMenu={() => goto('/')}
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
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
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

	/* --- Pressure warning --- */

	.pressure-warning {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 12;
		background: rgba(244, 114, 182, 0.15);
		border: 1px solid rgba(244, 114, 182, 0.3);
		color: #f472b6;
		padding: 6px 16px;
		border-radius: 20px;
		font-size: 0.8rem;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		pointer-events: none;
		white-space: nowrap;
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
		touch-action: manipulation;
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
