<script lang="ts">
	import type { ExerciseResult } from '$lib/scoring/types';

	interface Props {
		results: ExerciseResult[];
		title: string;
	}

	let { results, title }: Props = $props();

	const maxScore = 100;
	const chartHeight = 160;
	const chartPadding = 30;

	function points(): string {
		if (results.length === 0) return '';
		const w = 100 / Math.max(results.length - 1, 1);
		return results
			.map((r, i) => {
				const x = i * w;
				const y = 100 - (r.aggregateScore / maxScore) * 100;
				return `${x},${y}`;
			})
			.join(' ');
	}

	function areaPath(): string {
		if (results.length === 0) return '';
		const w = 100 / Math.max(results.length - 1, 1);
		let d = `M 0,100`;
		for (let i = 0; i < results.length; i++) {
			const x = i * w;
			const y = 100 - (results[i].aggregateScore / maxScore) * 100;
			d += ` L ${x},${y}`;
		}
		d += ` L 100,100 Z`;
		return d;
	}
</script>

<div class="chart-container">
	<h3 class="chart-title">{title}</h3>
	{#if results.length === 0}
		<div class="empty">No attempts yet</div>
	{:else}
		<svg viewBox="-2 -5 104 115" class="chart" preserveAspectRatio="none">
			<!-- Grid lines -->
			{#each [0, 25, 50, 75, 100] as y}
				<line
					x1="0"
					y1={100 - y}
					x2="100"
					y2={100 - y}
					stroke="#2a2a4a"
					stroke-width="0.3"
				/>
			{/each}

			<!-- Area fill -->
			<path d={areaPath()} fill="url(#chartGrad)" opacity="0.3" />

			<!-- Line -->
			<polyline
				points={points()}
				fill="none"
				stroke="#4c6ef5"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>

			<!-- Dots -->
			{#each results as r, i}
				{@const w = 100 / Math.max(results.length - 1, 1)}
				<circle
					cx={i * w}
					cy={100 - (r.aggregateScore / maxScore) * 100}
					r="1.8"
					fill="#4c6ef5"
				/>
			{/each}

			<defs>
				<linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="#4c6ef5" />
					<stop offset="100%" stop-color="#4c6ef5" stop-opacity="0" />
				</linearGradient>
			</defs>
		</svg>
		<div class="chart-legend">
			<span>{results.length} attempt{results.length !== 1 ? 's' : ''}</span>
			<span>Best: {Math.max(...results.map((r) => r.aggregateScore))}</span>
		</div>
	{/if}
</div>

<style>
	.chart-container {
		background: #16162a;
		border-radius: 12px;
		padding: 16px;
	}

	.chart-title {
		font-size: 0.9rem;
		color: #aaaacc;
		margin: 0 0 12px 0;
		font-weight: 500;
	}

	.chart {
		width: 100%;
		height: 160px;
	}

	.chart-legend {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: #666688;
		margin-top: 8px;
	}

	.empty {
		color: #555577;
		font-size: 0.85rem;
		text-align: center;
		padding: 40px 0;
	}
</style>
