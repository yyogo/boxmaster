<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { RoundResult, MetricKey, StrokeScore } from '$lib/scoring/types';
	import { METRIC_KEYS, METRIC_LABELS } from '$lib/scoring/types';
	import type { ExerciseConfig } from '$lib/exercises/types';
	import { renderGuides } from '$lib/canvas/guides';
	import { renderHighlights } from '$lib/canvas/highlights';
	import { getPlugin } from '$lib/exercises/registry';

	interface Props {
		rounds: RoundResult[];
		exerciseType: string;
		aggregateScore: number;
		totalTime: number;
		onRetry: () => void;
		onClose: () => void;
		onMenu: () => void;
		onNext?: () => void;
		nextLabel?: string;
	}

	let { rounds, exerciseType, aggregateScore, totalTime, onRetry, onClose, onMenu, onNext, nextLabel }: Props = $props();

	let canvasRefs: HTMLCanvasElement[] = $state([]);
	let gridEl: HTMLElement;
	let hoveredRound: number | null = $state(null);
	let tooltipPos = $state({ x: 0, y: 0 });

	let galleryIndex: number | null = $state(null);
	let galleryCanvas: HTMLCanvasElement | null = $state(null);

	function scoreColor(val: number): string {
		if (val >= 80) return '#4ade80';
		if (val >= 60) return '#fbbf24';
		if (val >= 40) return '#fb923c';
		return '#f87171';
	}

	function formatTime(ms: number): string {
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
	}

	function bestScore(): number {
		if (rounds.length === 0) return 0;
		return Math.max(...rounds.map((r) => r.shapeScore));
	}

	function worstScore(): number {
		if (rounds.length === 0) return 0;
		return Math.min(...rounds.map((r) => r.shapeScore));
	}

	interface Breakdown { label: string; value: number; color: string }

	function metricsFromScores(scores: StrokeScore[]): Breakdown[] {
		if (scores.length === 0) return [];
		const items: Breakdown[] = [];

		for (const key of METRIC_KEYS) {
			const vals = scores.map(s => s[key]).filter((v): v is number => v != null);
			if (vals.length === 0) continue;
			const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
			items.push({ label: METRIC_LABELS[key], value: avg, color: scoreColor(avg) });
		}
		return items;
	}

	let breakdown = $derived(metricsFromScores(rounds.flatMap(r => r.strokeScores)));

	const METRIC_TIPS: Record<string, string> = {
		'Path Accuracy': 'Focus on tracing closer to the target \u2014 ghost the line before committing.',
		'Smoothness': 'Your strokes are jittery \u2014 try drawing from the shoulder with a single confident motion.',
		'Speed Control': 'Your stroke speed is inconsistent \u2014 aim for a steady, even pace throughout.',
		'Endpoint Precision': "You're overshooting or undershooting \u2014 ghost the endpoints before drawing.",
		'Closure': "Your shapes aren't closing cleanly \u2014 slow down at the end to meet your start point.",
		'Pressure': 'Your pressure varies too much \u2014 practice maintaining even pressure.',
		'Taper': 'Work on lifting smoothly at stroke ends for cleaner tapers.',
		'Economy': 'Try to complete each shape in fewer strokes \u2014 commit to confident single motions.',
	};

	function generateFeedback(items: Breakdown[]): string {
		if (items.length === 0) return '';
		if (aggregateScore >= 90) return 'Clean session \u2014 keep it up.';

		const worst = items.reduce((a, b) => (a.value < b.value ? a : b));

		if (worst.value >= 70) {
			const tip = METRIC_TIPS[worst.label];
			return tip ? `Solid work. To push higher: ${tip.charAt(0).toLowerCase()}${tip.slice(1)}` : 'Solid work \u2014 keep practicing.';
		}

		return METRIC_TIPS[worst.label] ?? 'Keep practicing \u2014 focus on one metric at a time.';
	}

	let feedbackText = $derived(generateFeedback(breakdown));

	let hoveredBreakdown = $derived.by(() => {
		if (hoveredRound == null || hoveredRound >= rounds.length) return [];
		return metricsFromScores(rounds[hoveredRound].strokeScores);
	});

	let galleryBreakdown = $derived.by(() => {
		if (galleryIndex == null || galleryIndex >= rounds.length) return [];
		return metricsFromScores(rounds[galleryIndex].strokeScores);
	});

	function handleCellEnter(e: MouseEvent, idx: number) {
		hoveredRound = idx;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const gridRect = gridEl.getBoundingClientRect();
		tooltipPos = {
			x: rect.left + rect.width / 2 - gridRect.left,
			y: rect.top - gridRect.top - 8,
		};
	}

	function handleCellLeave() {
		hoveredRound = null;
	}

	function openGallery(idx: number) {
		galleryIndex = idx;
		tick().then(renderGallery);
	}

	function closeGallery() {
		galleryIndex = null;
	}

	function galleryPrev() {
		if (galleryIndex == null) return;
		galleryIndex = (galleryIndex - 1 + rounds.length) % rounds.length;
		tick().then(renderGallery);
	}

	function galleryNext() {
		if (galleryIndex == null) return;
		galleryIndex = (galleryIndex + 1) % rounds.length;
		tick().then(renderGallery);
	}

	function galleryKey(e: KeyboardEvent) {
		if (e.key === 'Escape') closeGallery();
		else if (e.key === 'ArrowLeft') galleryPrev();
		else if (e.key === 'ArrowRight') galleryNext();
	}

	function renderCanvas(canvas: HTMLCanvasElement, round: RoundResult, bg: string) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const cw = canvas.clientWidth;
		const ch = canvas.clientHeight;
		canvas.width = cw * dpr;
		canvas.height = ch * dpr;
		ctx.scale(dpr, dpr);

		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, cw, ch);

		const allPts: { x: number; y: number }[] = [];
		for (const s of round.strokes) {
			const pts = s.smoothedPoints.length > 0 ? s.smoothedPoints : s.rawPoints;
			allPts.push(...pts);
		}

		const ref = round.reference;
		const plugin = getPlugin(ref.type);
		const shapeBounds = plugin.getBounds(ref.params as Record<string, unknown>);

		let minX = shapeBounds.minX, minY = shapeBounds.minY;
		let maxX = shapeBounds.maxX, maxY = shapeBounds.maxY;
		for (const p of allPts) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}

		const pad = 24;
		const scaleX = (cw - pad * 2) / Math.max(1, maxX - minX);
		const scaleY = (ch - pad * 2) / Math.max(1, maxY - minY);
		const scale = Math.min(scaleX, scaleY, 2);

		const contentW = (maxX - minX) * scale;
		const contentH = (maxY - minY) * scale;
		const offX = (cw - contentW) / 2 - minX * scale;
		const offY = (ch - contentH) / 2 - minY * scale;

		ctx.save();
		ctx.translate(offX, offY);
		ctx.scale(scale, scale);

		const miniConfig: ExerciseConfig = {
			unit: plugin.unit,
			type: ref.type,
			mode: 'tracing',
			strokeCount: round.strokes.length,
			references: [ref],
			availableModes: ['tracing']
		};
		renderGuides(ctx, miniConfig, 'full');

		for (let i = 0; i < round.strokes.length; i++) {
			const score = round.strokeScores[i];
			if (score) {
				if (plugin.renderScoredStroke) plugin.renderScoredStroke(ctx, round.strokes[i], score);
				else renderHighlights(ctx, round.strokes[i], score);
			}
		}

		ctx.restore();
	}

	function renderThumbnail(canvas: HTMLCanvasElement, round: RoundResult) {
		renderCanvas(canvas, round, '#12122a');
	}

	function renderGallery() {
		if (galleryIndex == null || !galleryCanvas) return;
		renderCanvas(galleryCanvas, rounds[galleryIndex], '#0c0c1e');
	}

	onMount(() => {
		const timer = setTimeout(() => {
			for (let i = 0; i < rounds.length; i++) {
				if (canvasRefs[i]) {
					renderThumbnail(canvasRefs[i], rounds[i]);
				}
			}
		}, 50);
		return () => clearTimeout(timer);
	});
</script>

<div class="results-overlay">
	<button class="close-btn" onclick={onClose} title="Close">✕</button>

	<div class="results-header">
		<div class="results-score" style="color: {scoreColor(aggregateScore)}">
			{aggregateScore}
		</div>
		<div class="results-label">Session Score</div>
		<div class="results-stats">
			<span>{rounds.length} shapes</span>
			<span>{formatTime(totalTime)}</span>
			<span class="stat-best" style="color: {scoreColor(bestScore())}">Best {bestScore()}</span>
			<span class="stat-worst" style="color: {scoreColor(worstScore())}">Worst {worstScore()}</span>
		</div>
	</div>

	{#if breakdown.length > 0}
		<div class="breakdown">
			{#each breakdown as item}
				<div class="breakdown-item">
					<div class="breakdown-header">
						<span class="breakdown-label">{item.label}</span>
						<span class="breakdown-value" style="color: {item.color}">{item.value}</span>
					</div>
					<div class="breakdown-bar-bg">
						<div class="breakdown-bar-fill" style="width: {item.value}%; background: {item.color}"></div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if feedbackText}
		<p class="results-feedback">{feedbackText}</p>
	{/if}

	<div class="results-grid" bind:this={gridEl}>
		{#each rounds as round, i}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="grid-cell"
				onmouseenter={(e) => handleCellEnter(e, i)}
				onmouseleave={handleCellLeave}
				onclick={() => openGallery(i)}
			>
				<canvas
					bind:this={canvasRefs[i]}
					class="thumb-canvas"
				></canvas>
				<div class="cell-score" style="color: {scoreColor(round.shapeScore)}">
					{round.shapeScore}
				</div>
			</div>
		{/each}

		{#if hoveredRound != null && hoveredBreakdown.length > 0}
			<div class="cell-tooltip" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;">
				{#each hoveredBreakdown as item}
					<div class="tooltip-row">
						<span class="tooltip-label">{item.label}</span>
						<div class="tooltip-bar-bg">
							<div class="tooltip-bar-fill" style="width: {item.value}%; background: {item.color}"></div>
						</div>
						<span class="tooltip-value" style="color: {item.color}">{item.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if galleryIndex != null}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="gallery-backdrop" onclick={closeGallery} onkeydown={galleryKey} tabindex="-1" role="dialog">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="gallery-panel" onclick={(e) => e.stopPropagation()}>
				<button class="gallery-close" onclick={closeGallery}>✕</button>

				<div class="gallery-score" style="color: {scoreColor(rounds[galleryIndex].shapeScore)}">
					{rounds[galleryIndex].shapeScore}
					<span class="gallery-counter">{galleryIndex + 1} / {rounds.length}</span>
				</div>

				<canvas
					bind:this={galleryCanvas}
					class="gallery-canvas"
				></canvas>

				{#if galleryBreakdown.length > 0}
					<div class="gallery-metrics">
						{#each galleryBreakdown as item}
							<div class="gallery-metric-row">
								<span class="gallery-metric-label">{item.label}</span>
								<div class="gallery-metric-bar-bg">
									<div class="gallery-metric-bar-fill" style="width: {item.value}%; background: {item.color}"></div>
								</div>
								<span class="gallery-metric-value" style="color: {item.color}">{item.value}</span>
							</div>
						{/each}
					</div>
				{/if}

				<div class="gallery-nav">
					<button class="gallery-nav-btn" onclick={galleryPrev} title="Previous (←)">‹</button>
					<button class="gallery-nav-btn" onclick={galleryNext} title="Next (→)">›</button>
				</div>
			</div>
		</div>
	{/if}

	<div class="results-actions">
		{#if onNext}
			<button class="action-btn next" onclick={onNext}>
				Next Exercise
				{#if nextLabel}<span class="next-label">{nextLabel}</span>{/if}
			</button>
		{/if}
		<button class="action-btn primary" onclick={onRetry}>Try Again</button>
		<button class="action-btn secondary" onclick={onMenu}>Back to Menu</button>
	</div>
</div>

<style>
	.results-overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: rgba(13, 13, 30, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		display: flex;
		flex-direction: column;
		align-items: center;
		overflow-y: auto;
		padding: 40px 20px;
		animation: fadeIn 0.4s ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.close-btn {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 36px;
		height: 36px;
		border: none;
		background: rgba(255, 255, 255, 0.08);
		color: #aaa;
		font-size: 1.1rem;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		z-index: 1;
	}

	.close-btn:hover {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	.results-header {
		text-align: center;
		margin-bottom: 20px;
	}

	.results-score {
		font-size: 4rem;
		font-weight: 700;
		line-height: 1;
	}

	.results-label {
		color: #8888aa;
		font-size: 0.9rem;
		margin-top: 4px;
	}

	.results-stats {
		display: flex;
		gap: 16px;
		justify-content: center;
		margin-top: 12px;
		font-size: 0.8rem;
		color: #8888aa;
	}

	.breakdown {
		display: flex;
		gap: 20px;
		width: 100%;
		max-width: 560px;
		margin-bottom: 24px;
		flex-wrap: wrap;
	}

	.breakdown-item {
		flex: 1 1 80px;
		min-width: 70px;
	}

	.breakdown-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 4px;
	}

	.breakdown-label {
		font-size: 0.7rem;
		color: #8888aa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.breakdown-value {
		font-size: 0.8rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.breakdown-bar-bg {
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}

	.breakdown-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.6s ease-out;
	}

	.results-feedback {
		color: #9999bb;
		font-size: 0.85rem;
		max-width: 480px;
		text-align: center;
		margin: 4px 0 16px;
		line-height: 1.45;
	}

	/* --- Hover tooltip --- */

	.cell-tooltip {
		position: absolute;
		transform: translate(-50%, -100%);
		background: rgba(15, 15, 35, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		padding: 8px 12px;
		min-width: 180px;
		z-index: 30;
		pointer-events: none;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		animation: tooltipIn 0.15s ease-out;
	}

	@keyframes tooltipIn {
		from { opacity: 0; transform: translate(-50%, -90%); }
		to { opacity: 1; transform: translate(-50%, -100%); }
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 3px;
	}

	.tooltip-row:last-child {
		margin-bottom: 0;
	}

	.tooltip-label {
		font-size: 0.65rem;
		color: #8888aa;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 60px;
		flex-shrink: 0;
	}

	.tooltip-bar-bg {
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}

	.tooltip-bar-fill {
		height: 100%;
		border-radius: 2px;
	}

	.tooltip-value {
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		min-width: 22px;
		text-align: right;
		flex-shrink: 0;
	}

	/* --- Grid --- */

	.results-grid {
		position: relative;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 10px;
		width: 100%;
		max-width: 720px;
	}

	.grid-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(20, 20, 45, 0.7);
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.06);
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.grid-cell:hover {
		border-color: rgba(255, 255, 255, 0.15);
	}

	.thumb-canvas {
		width: 100%;
		aspect-ratio: 4 / 3;
		display: block;
	}

	.cell-score {
		font-size: 0.9rem;
		font-weight: 600;
		padding: 4px 0 6px;
		font-variant-numeric: tabular-nums;
	}

	.results-actions {
		display: flex;
		gap: 12px;
		margin-top: 24px;
	}

	.action-btn {
		padding: 10px 24px;
		border-radius: 24px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.15s;
		border: 1px solid transparent;
	}

	.action-btn.primary {
		background: rgba(59, 91, 219, 0.85);
		border-color: rgba(76, 110, 245, 0.5);
		color: #fff;
	}

	.action-btn.primary:hover {
		background: rgba(76, 110, 245, 0.95);
	}

	.action-btn.next {
		background: linear-gradient(135deg, rgba(76, 110, 245, 0.85), rgba(124, 58, 237, 0.85));
		border-color: rgba(76, 110, 245, 0.5);
		color: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.action-btn.next:hover {
		background: linear-gradient(135deg, rgba(76, 110, 245, 1), rgba(124, 58, 237, 1));
		box-shadow: 0 2px 12px rgba(76, 110, 245, 0.35);
	}

	.next-label {
		font-size: 0.65rem;
		font-weight: 400;
		opacity: 0.7;
	}

	.action-btn.secondary {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.12);
		color: #aaa;
	}

	.action-btn.secondary:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #ddd;
	}

	/* --- Gallery --- */

	.gallery-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeIn 0.2s ease-out;
	}

	.gallery-panel {
		position: relative;
		background: rgba(15, 15, 35, 0.98);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 16px;
		padding: 24px;
		width: 90vw;
		max-width: 640px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		overflow-y: auto;
	}

	.gallery-close {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 32px;
		height: 32px;
		border: none;
		background: rgba(255, 255, 255, 0.08);
		color: #aaa;
		font-size: 1rem;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		z-index: 1;
	}

	.gallery-close:hover {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	.gallery-score {
		font-size: 2.4rem;
		font-weight: 700;
		line-height: 1;
		display: flex;
		align-items: baseline;
		gap: 12px;
	}

	.gallery-counter {
		font-size: 0.8rem;
		font-weight: 400;
		color: #666;
	}

	.gallery-canvas {
		width: 100%;
		aspect-ratio: 16 / 10;
		border-radius: 8px;
		display: block;
	}

	.gallery-metrics {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.gallery-metric-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.gallery-metric-label {
		font-size: 0.7rem;
		color: #8888aa;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 90px;
		flex-shrink: 0;
	}

	.gallery-metric-bar-bg {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}

	.gallery-metric-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.4s ease-out;
	}

	.gallery-metric-value {
		font-size: 0.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		min-width: 26px;
		text-align: right;
		flex-shrink: 0;
	}

	.gallery-nav {
		display: flex;
		gap: 16px;
	}

	.gallery-nav-btn {
		width: 44px;
		height: 44px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		color: #ccc;
		font-size: 1.5rem;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.gallery-nav-btn:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}

	@media (max-width: 480px) {
		.results-grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}

		.results-overlay {
			padding: 24px 12px;
		}

		.results-score {
			font-size: 3rem;
		}

		.breakdown {
			flex-direction: column;
			gap: 12px;
		}

		.results-actions {
			flex-direction: column;
			width: 100%;
			max-width: 280px;
		}

		.action-btn {
			text-align: center;
		}

		.cell-tooltip {
			display: none;
		}

		.gallery-panel {
			width: 95vw;
			padding: 16px;
		}
	}
</style>
