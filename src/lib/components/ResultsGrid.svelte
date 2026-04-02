<script lang="ts">
	import { onMount } from 'svelte';
	import type { RoundResult } from '$lib/scoring/types';
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
	}

	let { rounds, exerciseType, aggregateScore, totalTime, onRetry, onClose, onMenu }: Props = $props();

	let canvasRefs: HTMLCanvasElement[] = $state([]);
	let gridEl: HTMLElement;

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

	function computeBreakdown(): Breakdown[] {
		const allScores = rounds.flatMap((r) => r.strokeScores);
		if (allScores.length === 0) return [];

		const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

		const accuracy = avg(allScores.map((s) => s.accuracy));
		const steadiness = avg(allScores.map((s) => s.flow));
		const speed = avg(allScores.map((s) => s.speed));

		const confValues = allScores.map((s) => s.confidence).filter((c): c is number => c !== null);
		const hasConfidence = confValues.length > 0;
		const confidence = hasConfidence ? avg(confValues) : -1;

		const items: Breakdown[] = [
			{ label: 'Accuracy', value: accuracy, color: scoreColor(accuracy) },
			{ label: 'Steadiness', value: steadiness, color: scoreColor(steadiness) },
			{ label: 'Speed', value: speed, color: scoreColor(speed) }
		];
		if (hasConfidence) {
			items.push({ label: 'Pressure', value: confidence, color: scoreColor(confidence) });
		}
		if (allScores.some(s => s.metrics?.pressureMatch != null)) {
			const pmValues = allScores.map(s => s.metrics?.pressureMatch).filter((v): v is number => v != null);
			if (pmValues.length > 0) {
				const pm = avg(pmValues);
				items.push({ label: 'Pressure Control', value: pm, color: scoreColor(pm) });
			}
		}
		return items;
	}

	let breakdown = $derived(computeBreakdown());

	function renderThumbnail(canvas: HTMLCanvasElement, round: RoundResult) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const cw = canvas.clientWidth;
		const ch = canvas.clientHeight;
		canvas.width = cw * dpr;
		canvas.height = ch * dpr;
		ctx.scale(dpr, dpr);

		ctx.fillStyle = '#12122a';
		ctx.fillRect(0, 0, cw, ch);

		const allPts: { x: number; y: number }[] = [];
		for (const s of round.strokes) {
			const pts = s.smoothedPoints.length > 0 ? s.smoothedPoints : s.rawPoints;
			allPts.push(...pts);
		}

		const ref = round.reference;
		const plugin = getPlugin(ref.type);
		const shapeBounds = plugin.getBounds(ref.params as Record<string, unknown>);

		// Expand bounds to include user stroke points
		let minX = shapeBounds.minX, minY = shapeBounds.minY;
		let maxX = shapeBounds.maxX, maxY = shapeBounds.maxY;
		for (const p of allPts) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}

		const pad = 12;
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
			mode: 'guided',
			strokeCount: round.strokes.length,
			references: [ref],
			availableModes: ['guided']
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

<div class="results-overlay" bind:this={gridEl}>
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

	<div class="results-grid">
		{#each rounds as round, i}
			<div class="grid-cell">
				<canvas
					bind:this={canvasRefs[i]}
					class="thumb-canvas"
				></canvas>
				<div class="cell-score" style="color: {scoreColor(round.shapeScore)}">
					{round.shapeScore}
				</div>
			</div>
		{/each}
	</div>

	<div class="results-actions">
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
		max-width: 480px;
		margin-bottom: 24px;
	}

	.breakdown-item {
		flex: 1;
		min-width: 0;
	}

	.breakdown-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 4px;
	}

	.breakdown-label {
		font-size: 0.75rem;
		color: #8888aa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.breakdown-value {
		font-size: 0.85rem;
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

	.results-grid {
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

	.action-btn.secondary {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.12);
		color: #aaa;
	}

	.action-btn.secondary:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #ddd;
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
	}
</style>
