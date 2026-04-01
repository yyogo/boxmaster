<script lang="ts">
	import type { StrokeScore } from '$lib/scoring/types';

	interface Props {
		scores: StrokeScore[];
		aggregateScore: number;
	}

	let { scores, aggregateScore }: Props = $props();

	function avgOf(key: 'accuracy' | 'flow'): number {
		if (scores.length === 0) return 0;
		return Math.round(scores.reduce((s, sc) => s + sc[key], 0) / scores.length);
	}

	function avgConfidence(): number | null {
		const withConf = scores.filter((s) => s.confidence !== null);
		if (withConf.length === 0) return null;
		return Math.round(
			withConf.reduce((s, sc) => s + (sc.confidence ?? 0), 0) / withConf.length
		);
	}

	function scoreColor(val: number): string {
		if (val >= 80) return '#4ade80';
		if (val >= 60) return '#fbbf24';
		if (val >= 40) return '#fb923c';
		return '#f87171';
	}

	const confidence = $derived(avgConfidence());
</script>

<div class="score-card">
	<div class="overall">
		<div class="overall-score" style="color: {scoreColor(aggregateScore)}">
			{aggregateScore}
		</div>
		<div class="overall-label">Overall</div>
	</div>

	<div class="breakdown">
		<div class="metric">
			<div class="metric-value" style="color: {scoreColor(avgOf('accuracy'))}">
				{avgOf('accuracy')}
			</div>
			<div class="metric-label">Accuracy</div>
		</div>

		<div class="metric">
			<div class="metric-value" style="color: {scoreColor(avgOf('flow'))}">
				{avgOf('flow')}
			</div>
			<div class="metric-label">Flow</div>
		</div>

		{#if confidence !== null}
			<div class="metric">
				<div class="metric-value" style="color: {scoreColor(confidence)}">
					{confidence}
				</div>
				<div class="metric-label">Confidence</div>
			</div>
		{/if}
	</div>

	<div class="stroke-list">
		{#each scores as score, i}
			<div class="stroke-row">
				<span class="stroke-label">Stroke {i + 1}</span>
				<div class="stroke-bar-container">
					<div
						class="stroke-bar"
						style="width: {score.accuracy}%; background: {scoreColor(score.accuracy)}"
					></div>
				</div>
				<span class="stroke-val">{Math.round(score.accuracy)}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.score-card {
		background: #16162a;
		border-radius: 12px;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.overall {
		text-align: center;
	}

	.overall-score {
		font-size: 3rem;
		font-weight: 700;
		line-height: 1;
	}

	.overall-label {
		color: #8888aa;
		font-size: 0.85rem;
		margin-top: 4px;
	}

	.breakdown {
		display: flex;
		justify-content: center;
		gap: 24px;
	}

	.metric {
		text-align: center;
	}

	.metric-value {
		font-size: 1.4rem;
		font-weight: 600;
	}

	.metric-label {
		color: #8888aa;
		font-size: 0.75rem;
		margin-top: 2px;
	}

	.stroke-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 180px;
		overflow-y: auto;
	}

	.stroke-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.stroke-label {
		font-size: 0.75rem;
		color: #666688;
		width: 60px;
		flex-shrink: 0;
	}

	.stroke-bar-container {
		flex: 1;
		height: 6px;
		background: #0d0d1a;
		border-radius: 3px;
		overflow: hidden;
	}

	.stroke-bar {
		height: 100%;
		border-radius: 3px;
		transition: width 0.4s ease;
	}

	.stroke-val {
		font-size: 0.75rem;
		color: #aaaacc;
		width: 28px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
