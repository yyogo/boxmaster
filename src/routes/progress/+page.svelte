<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import ProgressChart from '$lib/components/ProgressChart.svelte';
	import type { ExerciseResult } from '$lib/scoring/types';
	import { getResultsByType, clearAllResults } from '$lib/storage/db';
	import { getProgressSummaries, type ProgressSummary } from '$lib/storage/progress';
	import '$lib/exercises/init';
	import { tryGetPlugin } from '$lib/exercises/registry';

	let summaries: ProgressSummary[] = $state([]);
	let selectedType: string | null = $state(null);
	let selectedHistory: ExerciseResult[] = $state([]);
	let showResetModal = $state(false);

	function exerciseLabel(type: string): string {
		return tryGetPlugin(type)?.label ?? type;
	}

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

	async function handleReset() {
		await clearAllResults();
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem('boxmaster-streak');
		}
		showResetModal = false;
		summaries = [];
		selectedType = null;
		selectedHistory = [];
	}

	onMount(() => {
		loadSummaries();
	});
</script>

<div class="progress-page">
	<div class="page-header">
		<h1>Progress</h1>
		{#if summaries.length > 0}
			<button class="reset-btn" onclick={() => showResetModal = true}>Reset Progress</button>
		{/if}
	</div>

	{#if summaries.length === 0}
		<div class="empty">
			<p>No exercises completed yet.</p>
			<a href="{base}/" class="start-link">Start practicing →</a>
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
						<h3>{exerciseLabel(s.exerciseType)}</h3>
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
				title={exerciseLabel(selectedType)}
			/>
		{/if}
	{/if}
</div>

{#if showResetModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" onclick={() => showResetModal = false} onkeydown={(e) => { if (e.key === 'Escape') showResetModal = false; }}>
		<div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="modal-title">Reset All Progress?</h2>
			<p class="modal-body">This will permanently delete all exercise results and your daily streak. This action cannot be undone.</p>
			<div class="modal-actions">
				<button class="modal-btn cancel" onclick={() => showResetModal = false}>Cancel</button>
				<button class="modal-btn danger" onclick={handleReset}>Delete Everything</button>
			</div>
		</div>
	</div>
{/if}

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

	/* --- Page header --- */

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.reset-btn {
		padding: 6px 16px;
		border-radius: 8px;
		border: 1px solid rgba(248, 113, 113, 0.3);
		background: rgba(248, 113, 113, 0.08);
		color: #f87171;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.reset-btn:hover {
		background: rgba(248, 113, 113, 0.18);
		border-color: rgba(248, 113, 113, 0.5);
	}

	/* --- Modal --- */

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.65);
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}

	.modal {
		background: #1a1a30;
		border: 1px solid #2e2e50;
		border-radius: 16px;
		padding: 28px 32px;
		max-width: 400px;
		width: calc(100% - 40px);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.modal-title {
		font-size: 1.2rem;
		font-weight: 700;
		color: #f87171;
		margin: 0;
	}

	.modal-body {
		font-size: 0.9rem;
		color: #aaaacc;
		line-height: 1.5;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		margin-top: 4px;
	}

	.modal-btn {
		padding: 8px 20px;
		border-radius: 10px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.modal-btn.cancel {
		border: 1px solid #3a3a5a;
		background: transparent;
		color: #aaaacc;
	}

	.modal-btn.cancel:hover {
		border-color: #5a5a7a;
		color: #ccccee;
	}

	.modal-btn.danger {
		border: none;
		background: #dc2626;
		color: #fff;
	}

	.modal-btn.danger:hover {
		background: #ef4444;
	}
</style>
