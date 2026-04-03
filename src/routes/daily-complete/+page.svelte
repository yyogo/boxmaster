<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import '$lib/exercises/init';
	import { tryGetPlugin } from '$lib/exercises/registry';
	import { dailySession, type DailyExerciseResult } from '$lib/daily/session.svelte';
	import { getActiveStreak } from '$lib/daily/streak';

	let results: DailyExerciseResult[] = $state([]);
	let streak = $state(0);
	let overallScore = $state(0);
	let totalShapes = $state(0);
	let elapsed = $state(0);

	function exerciseLabel(type: string): string {
		return tryGetPlugin(type)?.label ?? type;
	}

	function exerciseIcon(type: string): string {
		return tryGetPlugin(type)?.icon ?? '';
	}

	function scoreColor(score: number): string {
		if (score >= 85) return '#34d399';
		if (score >= 70) return '#a78bfa';
		if (score >= 50) return '#60a5fa';
		return '#f87171';
	}

	function formatTime(ms: number): string {
		const s = Math.round(ms / 1000);
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${String(sec).padStart(2, '0')}`;
	}

	onMount(() => {
		results = [...dailySession.completed];
		elapsed = dailySession.elapsed;
		streak = getActiveStreak();

		if (results.length > 0) {
			overallScore = Math.round(
				results.reduce((s, r) => s + r.score, 0) / results.length
			);
			totalShapes = results.reduce((s, r) => s + r.shapesCompleted, 0);
		}
	});
</script>

<div class="page">
	<div class="card">
		<h1 class="heading">Session Complete</h1>

		<div class="stats-row">
			<div class="stat-block">
				<span class="stat-value" style="color: {scoreColor(overallScore)}">{overallScore}</span>
				<span class="stat-label">Score</span>
			</div>
			<div class="stat-block">
				<span class="stat-value">{totalShapes}</span>
				<span class="stat-label">Shapes</span>
			</div>
			<div class="stat-block">
				<span class="stat-value">{formatTime(elapsed)}</span>
				<span class="stat-label">Time</span>
			</div>
			<div class="stat-block">
				<span class="stat-value streak-val">{streak}</span>
				<span class="stat-label">Streak &#x1F525;</span>
			</div>
		</div>

		{#if results.length > 0}
			<div class="results-list">
				{#each results as r}
					<div class="result-row">
						<span class="result-icon">{exerciseIcon(r.type)}</span>
						<span class="result-name">{exerciseLabel(r.type)}</span>
						<span class="result-shapes">{r.shapesCompleted} shapes</span>
						<span class="result-score" style="color: {scoreColor(r.score)}">{r.score}</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">No exercises completed this session.</p>
		{/if}

		<div class="actions">
			<button class="btn-primary" onclick={() => goto(`${base}/`)}>Back to Menu</button>
			<button class="btn-secondary" onclick={() => goto(`${base}/progress`)}>View Progress</button>
		</div>
	</div>
</div>

<style>
	.page {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding-top: 40px;
		min-height: 70vh;
	}

	.card {
		background: #16162a;
		border: 1px solid #2a2a4a;
		border-radius: 20px;
		padding: 36px 40px;
		max-width: 520px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.heading {
		text-align: center;
		font-size: 1.6rem;
		font-weight: 700;
		color: #eeeeff;
	}

	.stats-row {
		display: flex;
		justify-content: space-around;
		gap: 12px;
	}

	.stat-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.stat-value {
		font-size: 1.6rem;
		font-weight: 800;
		color: #ccccee;
		font-variant-numeric: tabular-nums;
	}

	.streak-val {
		color: #ffbb44;
	}

	.stat-label {
		font-size: 0.7rem;
		color: #666688;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.results-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.result-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 10px;
	}

	.result-icon {
		font-size: 1.2rem;
		width: 28px;
		text-align: center;
	}

	.result-name {
		flex: 1;
		font-size: 0.9rem;
		color: #ccccee;
	}

	.result-shapes {
		font-size: 0.75rem;
		color: #666688;
	}

	.result-score {
		font-size: 1.1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		min-width: 32px;
		text-align: right;
	}

	.empty {
		text-align: center;
		color: #666688;
		padding: 20px 0;
	}

	.actions {
		display: flex;
		gap: 12px;
		justify-content: center;
		margin-top: 8px;
	}

	.btn-primary {
		padding: 10px 28px;
		border-radius: 12px;
		border: none;
		background: linear-gradient(135deg, #4c6ef5, #7c3aed);
		color: #fff;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(76, 110, 245, 0.4);
	}

	.btn-secondary {
		padding: 10px 24px;
		border-radius: 12px;
		border: 1px solid #3a3a6a;
		background: transparent;
		color: #aaaacc;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-secondary:hover {
		border-color: #6c6ef5;
		color: #ccccee;
	}

	@media (max-width: 640px) {
		.card {
			padding: 24px 20px;
			border-radius: 16px;
		}

		.stats-row {
			flex-wrap: wrap;
		}

		.actions {
			flex-direction: column;
		}

		.btn-primary, .btn-secondary {
			width: 100%;
			text-align: center;
		}
	}
</style>
