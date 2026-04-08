<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import ProgressChart from '$lib/components/ProgressChart.svelte';
	import type { ExerciseResult, MetricKey } from '$lib/scoring/types';
	import { METRIC_KEYS, METRIC_LABELS } from '$lib/scoring/types';
	import { getResultsByType, getResultsByUnit, getAllResults, clearAllResults } from '$lib/storage/db';
	import { getProgressSummaries, type ProgressSummary } from '$lib/storage/progress';
	import '$lib/exercises/init';
	import { tryGetPlugin, getPluginsByUnit } from '$lib/exercises/registry';

	const METRIC_COLORS: Record<MetricKey, string> = {
		pathDeviation: '#4c6ef5',
		smoothness: '#4ade80',
		speedConsistency: '#2dd4bf',
		endpointAccuracy: '#facc15',
		closureGap: '#a78bfa',
		pressureControl: '#fb923c',
		taperQuality: '#f472b6',
		strokeEconomy: '#22d3ee',
	};

	const OVERALL_COLOR = '#8b5cf6';

	const UNIT_LABELS: Record<string, string> = {
		'basic-shapes': 'Basic Shapes',
		strokes: 'Strokes',
		perspective: 'Perspective',
	};

	let summaries: ProgressSummary[] = $state([]);
	let selectedSource = $state('all');
	let sourceResults: ExerciseResult[] = $state([]);
	let selectedMetrics: Set<string> = $state(new Set(['overall']));
	let showResetModal = $state(false);
	let availableMetrics: MetricKey[] = $state([]);

	const sourceGroups = $derived.by(() => {
		const byUnit = getPluginsByUnit();
		const withResults = new Set(summaries.map((s) => s.exerciseType));

		const groups: { label: string; options: { value: string; label: string }[] }[] = [];

		const aggregateOpts: { value: string; label: string }[] = [
			{ value: 'all', label: 'All Exercises' },
		];
		for (const unit of byUnit.keys()) {
			aggregateOpts.push({ value: `unit:${unit}`, label: UNIT_LABELS[unit] ?? unit });
		}
		groups.push({ label: 'Aggregates', options: aggregateOpts });

		for (const [unit, plugins] of byUnit) {
			const opts = plugins
				.filter((p) => withResults.has(p.id))
				.map((p) => ({ value: `exercise:${p.id}`, label: p.label }));
			if (opts.length > 0) {
				groups.push({ label: UNIT_LABELS[unit] ?? unit, options: opts });
			}
		}

		return groups;
	});

	const chartDatasets = $derived.by(() => {
		const ds: { label: string; metricKey?: MetricKey; color: string }[] = [];
		if (selectedMetrics.has('overall')) {
			ds.push({ label: 'Overall Score', color: OVERALL_COLOR });
		}
		for (const mk of availableMetrics) {
			if (selectedMetrics.has(mk)) {
				ds.push({ label: METRIC_LABELS[mk], metricKey: mk, color: METRIC_COLORS[mk] });
			}
		}
		return ds;
	});

	function exerciseLabel(type: string): string {
		return tryGetPlugin(type)?.label ?? type;
	}

	function modeAbbrev(mode: string): string {
		switch (mode) {
			case 'tracing': return 'T';
			case 'challenge': return 'C';
			case 'memory': return 'M';
			case 'free': return 'F';
			default: return mode.charAt(0).toUpperCase();
		}
	}

	function findAvailableMetrics(results: ExerciseResult[]): MetricKey[] {
		const seen = new Set<MetricKey>();
		for (const r of results) {
			for (const k of METRIC_KEYS) {
				if (r.metricAverages?.[k] != null) seen.add(k);
			}
		}
		return METRIC_KEYS.filter((k) => seen.has(k));
	}

	async function handleSourceChange() {
		if (selectedSource === 'all') {
			sourceResults = await getAllResults();
		} else if (selectedSource.startsWith('unit:')) {
			sourceResults = await getResultsByUnit(selectedSource.slice(5));
		} else if (selectedSource.startsWith('exercise:')) {
			sourceResults = await getResultsByType(selectedSource.slice(9));
		}
		availableMetrics = findAvailableMetrics(sourceResults);

		const next = new Set<string>();
		for (const m of selectedMetrics) {
			if (m === 'overall' || availableMetrics.includes(m as MetricKey)) {
				next.add(m);
			}
		}
		if (next.size === 0) next.add('overall');
		selectedMetrics = next;
	}

	function toggleMetric(key: string) {
		const next = new Set(selectedMetrics);
		if (next.has(key)) {
			next.delete(key);
			if (next.size === 0) return;
		} else {
			next.add(key);
		}
		selectedMetrics = next;
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
			minute: '2-digit',
		});
	}

	function selectExercise(type: string) {
		selectedSource = `exercise:${type}`;
		handleSourceChange();
	}

	async function handleReset() {
		await clearAllResults();
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem('boxmaster-streak');
		}
		showResetModal = false;
		summaries = [];
		sourceResults = [];
		selectedSource = 'all';
		availableMetrics = [];
		selectedMetrics = new Set(['overall']);
	}

	onMount(async () => {
		summaries = await getProgressSummaries();
		await handleSourceChange();
	});
</script>

<div class="progress-page">
	<div class="page-header">
		<h1>Progress</h1>
		{#if summaries.length > 0}
			<button class="reset-btn" onclick={() => (showResetModal = true)}>Reset Progress</button>
		{/if}
	</div>

	{#if summaries.length === 0}
		<div class="empty">
			<p>No exercises completed yet.</p>
			<a href="{base}/" class="start-link">Start practicing →</a>
		</div>
	{:else}
		<div class="controls">
			<div class="source-row">
				<label class="source-label" for="source-select">Source</label>
				<select
					id="source-select"
					class="source-select"
					bind:value={selectedSource}
					onchange={() => handleSourceChange()}
				>
					{#each sourceGroups as group}
						<optgroup label={group.label}>
							{#each group.options as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>

			<div class="metric-toggles">
				<button
					class="toggle-chip"
					class:active={selectedMetrics.has('overall')}
					style="--chip-color: {OVERALL_COLOR}"
					onclick={() => toggleMetric('overall')}
				>
					Overall Score
				</button>
				{#each availableMetrics as mk}
					<button
						class="toggle-chip"
						class:active={selectedMetrics.has(mk)}
						style="--chip-color: {METRIC_COLORS[mk]}"
						onclick={() => toggleMetric(mk)}
					>
						{METRIC_LABELS[mk]}
					</button>
				{/each}
			</div>
		</div>

		<ProgressChart results={sourceResults} datasets={chartDatasets} />

		<div class="summary-section">
			<h2 class="section-title">Exercises</h2>
			<div class="summary-grid">
				{#each summaries as s}
					<button
						class="summary-card"
						class:selected={selectedSource === `exercise:${s.exerciseType}`}
						onclick={() => selectExercise(s.exerciseType)}
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
						{#if Object.keys(s.modeBreakdown).length > 0}
							<div class="mode-breakdown">
								{#each Object.entries(s.modeBreakdown).filter(([, v]) => v && v.count > 0) as [m, stats]}
									<span class="mode-stat" class:latest={m === s.latestMode}>
										{modeAbbrev(m)} {stats?.avg ?? 0}
									</span>
								{/each}
							</div>
						{/if}
						{#if s.lastAttempt}
							<div class="last-attempt">{formatDate(s.lastAttempt)}</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if showResetModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="modal-backdrop"
		onclick={() => (showResetModal = false)}
		onkeydown={(e) => {
			if (e.key === 'Escape') showResetModal = false;
		}}
	>
		<div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<h2 class="modal-title">Reset All Progress?</h2>
			<p class="modal-body">
				This will permanently delete all exercise results and your daily streak. This action cannot
				be undone.
			</p>
			<div class="modal-actions">
				<button class="modal-btn cancel" onclick={() => (showResetModal = false)}>Cancel</button>
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

	/* --- Controls --- */

	.controls {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.source-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.source-label {
		font-size: 0.8rem;
		color: #888899;
		font-weight: 500;
		white-space: nowrap;
	}

	.source-select {
		background: #1a1a30;
		color: #eeeeff;
		border: 1px solid #3a3a5a;
		border-radius: 10px;
		padding: 8px 14px;
		font-size: 0.85rem;
		cursor: pointer;
		outline: none;
		min-width: 180px;
		transition: border-color 0.15s;
	}

	.source-select:focus {
		border-color: #4c6ef5;
	}

	.source-select option {
		background: #1a1a30;
		color: #eeeeff;
	}

	.source-select optgroup {
		color: #888899;
		font-weight: 600;
	}

	/* --- Metric toggle chips --- */

	.metric-toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.toggle-chip {
		padding: 6px 14px;
		border-radius: 20px;
		border: 1px solid #3a3a5a;
		background: transparent;
		color: #888899;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.toggle-chip:hover {
		border-color: var(--chip-color);
		color: var(--chip-color);
	}

	.toggle-chip.active {
		border-color: var(--chip-color);
		color: var(--chip-color);
		background: color-mix(in srgb, var(--chip-color) 15%, transparent);
	}

	/* --- Summary section --- */

	.summary-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.section-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #888899;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
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

	.mode-breakdown {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.mode-stat {
		font-size: 0.68rem;
		color: #666688;
		font-variant-numeric: tabular-nums;
	}

	.mode-stat.latest {
		color: #aaaacc;
		font-weight: 600;
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
