<script lang="ts">
	import { onMount } from 'svelte';
	import ProgressChart from '$lib/components/ProgressChart.svelte';
	import type { ExerciseResult } from '$lib/scoring/types';
	import { getResultsByType } from '$lib/storage/db';
	import { getProgressSummaries, type ProgressSummary } from '$lib/storage/progress';

	let summaries: ProgressSummary[] = $state([]);
	let selectedType: string | null = $state(null);
	let selectedHistory: ExerciseResult[] = $state([]);

	const exerciseLabels: Record<string, string> = {
		line: 'Lines',
		circle: 'Circles',
		ellipse: 'Ellipses',
		rectangle: 'Rectangles',
		'1-point-box': '1-Point Perspective'
	};

	async function loadSummaries() {
		summaries = await getProgressSummaries();
	}

	async function selectType(type: string) {
		selectedType = type;
		selectedHistory = await getResultsByType(type);
	}

	function trendIcon(trend: string): string {
		switch (trend) {
			case 'improving':
				return '↗';
			case 'declining':
				return '↘';
			default:
				return '→';
		}
	}

	function trendColor(trend: string): string {
		switch (trend) {
			case 'improving':
				return '#4ade80';
			case 'declining':
				return '#f87171';
			default:
				return '#8888aa';
		}
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(() => {
		loadSummaries();
	});
</script>

<div class="progress-page">
	<h1>Progress</h1>

	{#if summaries.length === 0}
		<div class="empty">
			<p>No exercises completed yet.</p>
			<a href="/" class="start-link">Start practicing →</a>
		</div>
	{:else}
		<div class="summary-grid">
			{#each summaries as s}
				<button
					class="summary-card"
					class:selected={selectedType === s.exerciseType}
					onclick={() => selectType(s.exerciseType)}
				>
					<div class="summary-header">
						<h3>{exerciseLabels[s.exerciseType] ?? s.exerciseType}</h3>
						<span class="trend" style="color: {trendColor(s.trend)}">
							{trendIcon(s.trend)}
						</span>
					</div>
					<div class="summary-stats">
						<div class="stat">
							<span class="stat-value">{s.totalAttempts}</span>
							<span class="stat-label">attempts</span>
						</div>
						<div class="stat">
							<span class="stat-value">{s.bestScore}</span>
							<span class="stat-label">best</span>
						</div>
						<div class="stat">
							<span class="stat-value">{s.recentAvg}</span>
							<span class="stat-label">avg</span>
						</div>
					</div>
					{#if s.lastAttempt}
						<div class="last-attempt">{formatDate(s.lastAttempt)}</div>
					{/if}
				</button>
			{/each}
		</div>

		{#if selectedType && selectedHistory.length > 0}
			<ProgressChart
				results={selectedHistory}
				title={exerciseLabels[selectedType] ?? selectedType}
			/>
		{/if}
	{/if}
</div>

<style>
	.progress-page {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	h1 {
		font-size: 1.6rem;
		font-weight: 700;
	}

	.empty {
		text-align: center;
		padding: 60px 0;
		color: #666688;
	}

	.start-link {
		display: inline-block;
		margin-top: 12px;
		color: #4c6ef5;
		text-decoration: none;
	}

	.start-link:hover {
		text-decoration: underline;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}

	.summary-card {
		background: #16162a;
		border: 1px solid #2a2a4a;
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.summary-card:hover {
		border-color: #4c6ef5;
	}

	.summary-card.selected {
		border-color: #4c6ef5;
		background: #1a1a35;
	}

	.summary-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.summary-header h3 {
		font-size: 0.95rem;
		color: #eeeeff;
		margin: 0;
	}

	.trend {
		font-size: 1.2rem;
	}

	.summary-stats {
		display: flex;
		gap: 16px;
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.1rem;
		font-weight: 600;
		color: #ccccee;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.65rem;
		color: #666688;
		text-transform: uppercase;
	}

	.last-attempt {
		font-size: 0.7rem;
		color: #555577;
	}
</style>
