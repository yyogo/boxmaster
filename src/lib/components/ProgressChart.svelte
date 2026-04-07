<script lang="ts">
	import { onMount } from 'svelte';
	import type { ExerciseResult, MetricKey } from '$lib/scoring/types';
	import { METRIC_LABELS } from '$lib/scoring/types';
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		Filler,
		LinearScale,
		CategoryScale,
		Tooltip,
	} from 'chart.js';

	Chart.register(LineController, LineElement, PointElement, Filler, LinearScale, CategoryScale, Tooltip);

	interface Props {
		results: ExerciseResult[];
		title?: string;
		metricKey?: MetricKey;
		compact?: boolean;
		color?: string;
	}

	let { results, title, metricKey, compact = false, color = '#4c6ef5' }: Props = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let chart: Chart | undefined;

	const displayTitle = $derived(title ?? (metricKey ? METRIC_LABELS[metricKey] : ''));

	interface DataPoint {
		value: number;
		label: string;
	}

	function extractData(): DataPoint[] {
		const pts: DataPoint[] = [];
		for (const r of results) {
			const v = metricKey ? r.metricAverages?.[metricKey] : r.aggregateScore;
			if (v != null) {
				const d = new Date(r.timestamp);
				pts.push({
					value: v,
					label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
				});
			}
		}
		return pts;
	}

	function buildChart(canvas: HTMLCanvasElement, data: DataPoint[]) {
		if (chart) chart.destroy();

		const ctx = canvas.getContext('2d')!;
		const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
		gradient.addColorStop(0, color + '40');
		gradient.addColorStop(1, color + '00');

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels: data.map((d) => d.label),
				datasets: [
					{
						data: data.map((d) => d.value),
						borderColor: color,
						backgroundColor: gradient,
						borderWidth: compact ? 1.5 : 2,
						pointBackgroundColor: color,
						pointBorderColor: '#16162a',
						pointBorderWidth: compact ? 1 : 1.5,
						pointRadius: compact ? 2 : 3.5,
						pointHoverRadius: compact ? 4 : 6,
						fill: true,
						tension: 0.35,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: { duration: 300 },
				layout: { padding: compact ? { top: 4, right: 4 } : { top: 4, right: 8 } },
				scales: {
					x: {
						display: !compact,
						grid: { color: '#2a2a4a40' },
						ticks: { color: '#666688', font: { size: 10 }, maxTicksLimit: 8 },
						border: { display: false },
					},
					y: {
						display: !compact,
						min: 0,
						max: 100,
						grid: { color: '#2a2a4a60' },
						ticks: { color: '#666688', font: { size: 10 }, stepSize: 25 },
						border: { display: false },
					},
				},
				plugins: {
					tooltip: {
						enabled: true,
						backgroundColor: '#1e1e3aee',
						titleColor: '#888899',
						bodyColor: '#eeeeff',
						borderColor: '#3a3a5a',
						borderWidth: 1,
						cornerRadius: 8,
						padding: 8,
						titleFont: { size: 11 },
						bodyFont: { size: 13, weight: 'bold' },
						displayColors: false,
						callbacks: {
							label: (ctx) => `${Math.round(ctx.parsed.y ?? 0)}`,
						},
					},
					legend: { display: false },
				},
				interaction: {
					mode: 'nearest',
					axis: 'x',
					intersect: false,
				},
			},
		});
	}

	$effect(() => {
		const data = extractData();
		if (canvasEl && data.length > 0) {
			buildChart(canvasEl, data);
		}
		return () => {
			if (chart) {
				chart.destroy();
				chart = undefined;
			}
		};
	});
</script>

<div class="chart-container" class:compact>
	{#if displayTitle && !compact}
		<h3 class="chart-title">{displayTitle}</h3>
	{/if}

	{#if extractData().length === 0}
		<div class="empty">{compact ? '—' : 'No attempts yet'}</div>
	{:else}
		<div class="chart-wrapper" style="height: {compact ? 64 : 180}px">
			<canvas bind:this={canvasEl}></canvas>
		</div>

		{#if !compact}
			{@const data = extractData()}
			<div class="chart-legend">
				<span>{data.length} attempt{data.length !== 1 ? 's' : ''}</span>
				<span>Best: {Math.max(...data.map((d) => d.value))}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart-container {
		background: #16162a;
		border-radius: 12px;
		padding: 16px;
	}

	.chart-container.compact {
		padding: 8px 12px;
	}

	.chart-title {
		font-size: 0.9rem;
		color: #aaaacc;
		margin: 0 0 12px 0;
		font-weight: 500;
	}

	.chart-wrapper {
		position: relative;
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

	.compact .empty {
		padding: 12px 0;
		font-size: 0.75rem;
	}
</style>
