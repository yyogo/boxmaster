<script lang="ts">
	import { onMount } from 'svelte';
	import type { RoundResult } from '$lib/scoring/types';
	import type { ExerciseConfig } from '$lib/exercises/types';
	import { renderGuides } from '$lib/canvas/guides';
	import { renderHighlights } from '$lib/canvas/highlights';

	interface Props {
		rounds: RoundResult[];
		exerciseType: string;
		aggregateScore: number;
		totalTime: number;
		onRetry: () => void;
	}

	let { rounds, exerciseType, aggregateScore, totalTime, onRetry }: Props = $props();

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
		const bounds = computeBounds(ref, allPts);

		const pad = 12;
		const scaleX = (cw - pad * 2) / Math.max(1, bounds.maxX - bounds.minX);
		const scaleY = (ch - pad * 2) / Math.max(1, bounds.maxY - bounds.minY);
		const scale = Math.min(scaleX, scaleY, 2);

		const contentW = (bounds.maxX - bounds.minX) * scale;
		const contentH = (bounds.maxY - bounds.minY) * scale;
		const offX = (cw - contentW) / 2 - bounds.minX * scale;
		const offY = (ch - contentH) / 2 - bounds.minY * scale;

		ctx.save();
		ctx.translate(offX, offY);
		ctx.scale(scale, scale);

		const miniConfig: ExerciseConfig = {
			unit: ref.type === '1-point-box' ? 'perspective' : 'basic-shapes',
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
				renderHighlights(ctx, round.strokes[i], score);
			}
		}

		ctx.restore();
	}

	function computeBounds(
		ref: import('$lib/exercises/types').ReferenceShape,
		extraPts: { x: number; y: number }[]
	): { minX: number; minY: number; maxX: number; maxY: number } {
		const xs: number[] = [];
		const ys: number[] = [];

		for (const p of extraPts) {
			xs.push(p.x);
			ys.push(p.y);
		}

		const params = ref.params;
		if ('x1' in params && 'x2' in params) {
			xs.push(params.x1, params.x2);
			ys.push(params.y1, params.y2);
		}
		if ('cx' in params && 'cy' in params) {
			const r = 'r' in params ? params.r : Math.max('rx' in params ? params.rx : 0, 'ry' in params ? params.ry : 0);
			xs.push(params.cx - r, params.cx + r);
			ys.push(params.cy - r, params.cy + r);
		}
		if ('givenCorner' in params) {
			const bp = params as import('$lib/exercises/types').PerspectiveBoxParams;
			xs.push(bp.givenCorner.x);
			ys.push(bp.givenCorner.y);
			for (const e of [bp.givenEdges.horizontal, bp.givenEdges.vertical, bp.givenEdges.depth]) {
				xs.push(e.x1, e.x2);
				ys.push(e.y1, e.y2);
			}
			for (const e of bp.expectedEdges) {
				xs.push(e.x1, e.x2);
				ys.push(e.y1, e.y2);
			}
		}

		if (xs.length === 0 || ys.length === 0) {
			return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
		}

		const margin = 10;
		return {
			minX: Math.min(...xs) - margin,
			minY: Math.min(...ys) - margin,
			maxX: Math.max(...xs) + margin,
			maxY: Math.max(...ys) + margin
		};
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
		<button class="retry-btn" onclick={onRetry}>Try Again</button>
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

	.results-header {
		text-align: center;
		margin-bottom: 24px;
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
		margin-top: 24px;
	}

	.retry-btn {
		padding: 10px 28px;
		border: 1px solid rgba(76, 110, 245, 0.5);
		background: rgba(59, 91, 219, 0.85);
		color: #fff;
		border-radius: 24px;
		cursor: pointer;
		font-size: 0.95rem;
		transition: all 0.15s;
	}

	.retry-btn:hover {
		background: rgba(76, 110, 245, 0.95);
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
	}
</style>
