<script lang="ts">
	import type { ExerciseResult, MetricKey } from '$lib/scoring/types';
	import { tryGetPlugin } from '$lib/exercises/registry';
	import {
		Chart,
		LineController,
		LineElement,
		PointElement,
		Filler,
		LinearScale,
		CategoryScale,
		Tooltip,
		Legend,
	} from 'chart.js';

	Chart.register(
		LineController,
		LineElement,
		PointElement,
		Filler,
		LinearScale,
		CategoryScale,
		Tooltip,
		Legend,
	);

	interface ChartDataset {
		label: string;
		metricKey?: MetricKey;
		color: string;
	}

	interface Props {
		results: ExerciseResult[];
		datasets: ChartDataset[];
	}

	let { results, datasets }: Props = $props();

	const MODE_POINT_STYLE: Record<string, string> = {
		tracing: 'circle',
		challenge: 'rectRot',
		memory: 'star',
		free: 'triangle',
	};

	const MODE_LABELS: Record<string, string> = {
		tracing: 'tracing',
		challenge: 'challenge',
		memory: 'memory',
		free: 'free',
	};

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let chart: Chart | undefined;

	function buildChart(canvas: HTMLCanvasElement) {
		if (chart) chart.destroy();
		if (results.length === 0 || datasets.length === 0) return;

		const labels = results.map((r) => {
			const d = new Date(r.timestamp);
			return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		});

		const singleDataset = datasets.length === 1;
		const ctx = canvas.getContext('2d')!;

		const pointStyles = results.map((r) => MODE_POINT_STYLE[r.mode] ?? 'circle');
		const baseRadius = results.length > 40 ? 1.5 : results.length > 20 ? 2.5 : 3;

		const chartDatasets = datasets.map((ds) => {
			const data = results.map((r) => {
				if (ds.metricKey) {
					return r.metricAverages?.[ds.metricKey] ?? null;
				}
				return r.aggregateScore;
			});

			let bg: string | CanvasGradient = ds.color + '18';
			if (singleDataset) {
				const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
				gradient.addColorStop(0, ds.color + '40');
				gradient.addColorStop(1, ds.color + '00');
				bg = gradient;
			}

			return {
				label: ds.label,
				data,
				borderColor: ds.color,
				backgroundColor: bg,
				borderWidth: 2,
				pointBackgroundColor: ds.color,
				pointBorderColor: '#16162a',
				pointBorderWidth: 1.5,
				pointRadius: baseRadius,
				pointHoverRadius: 5,
				pointStyle: pointStyles,
				fill: singleDataset,
				tension: 0.3,
				spanGaps: false,
			};
		});

		const storedResults = results;

		chart = new Chart(canvas, {
			type: 'line',
			data: { labels, datasets: chartDatasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: { duration: 300 },
				layout: { padding: { top: 4, right: 8 } },
				scales: {
					x: {
						grid: { color: '#2a2a4a40' },
						ticks: { color: '#666688', font: { size: 10 }, maxTicksLimit: 10 },
						border: { display: false },
					},
					y: {
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
						padding: 10,
						titleFont: { size: 11 },
						bodyFont: { size: 12, weight: 'bold' },
						filter: (item) => item.raw != null,
						callbacks: {
							title: (items) => {
								if (items.length === 0) return '';
								const idx = items[0].dataIndex;
								const r = storedResults[idx];
								if (!r) return '';
								const d = new Date(r.timestamp);
								const dateStr = d.toLocaleDateString(undefined, {
									month: 'short',
									day: 'numeric',
									hour: '2-digit',
									minute: '2-digit',
								});
								const label =
									tryGetPlugin(r.exerciseType)?.label ?? r.exerciseType;
								const modeStr = MODE_LABELS[r.mode] ?? r.mode;
								return `${label} · ${modeStr} — ${dateStr}`;
							},
							label: (ctx) => {
								const val = ctx.parsed.y;
								return val != null
									? ` ${ctx.dataset.label}: ${Math.round(val)}`
									: '';
							},
						},
					},
					legend: {
						display: !singleDataset,
						position: 'top' as const,
						labels: {
							color: '#aaaacc',
							font: { size: 11 },
							usePointStyle: true,
							pointStyle: 'circle',
							padding: 16,
							boxWidth: 8,
							boxHeight: 8,
						},
					},
				},
				interaction: {
					mode: 'index' as const,
					intersect: false,
				},
			},
		});
	}

	$effect(() => {
		if (canvasEl && results.length > 0 && datasets.length > 0) {
			buildChart(canvasEl);
		}
		return () => {
			if (chart) {
				chart.destroy();
				chart = undefined;
			}
		};
	});
</script>

<div class="chart-container">
	{#if results.length === 0}
		<div class="empty">No data for selected source</div>
	{:else if datasets.length === 0}
		<div class="empty">Select at least one metric</div>
	{:else}
		<div class="chart-wrapper">
			<canvas bind:this={canvasEl}></canvas>
		</div>
		<div class="chart-footer">
			<span>{results.length} attempt{results.length !== 1 ? 's' : ''}</span>
		</div>
	{/if}
</div>

<style>
	.chart-container {
		background: #16162a;
		border-radius: 12px;
		padding: 16px;
	}

	.chart-wrapper {
		position: relative;
		height: 240px;
	}

	.chart-footer {
		display: flex;
		justify-content: flex-end;
		font-size: 0.75rem;
		color: #666688;
		margin-top: 8px;
	}

	.empty {
		color: #555577;
		font-size: 0.85rem;
		text-align: center;
		padding: 60px 0;
	}
</style>
