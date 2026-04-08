<script lang="ts">
	import { saveResult, clearAllResults } from '$lib/storage/db';
	import type { ExerciseResult, MetricKey, StrokeScore } from '$lib/scoring/types';

	interface ExerciseDef {
		id: string;
		unit: string;
		metrics: MetricKey[];
		strokeCount: number;
	}

	const EXERCISES: ExerciseDef[] = [
		{ id: 'line', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'speedConsistency', 'endpointAccuracy'], strokeCount: 8 },
		{ id: 'circle', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'closureGap'], strokeCount: 6 },
		{ id: 'ellipse', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'closureGap'], strokeCount: 6 },
		{ id: 'rectangle', unit: 'basic-shapes', metrics: ['pathDeviation', 'endpointAccuracy', 'closureGap'], strokeCount: 4 },
		{ id: 's-curve', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'speedConsistency'], strokeCount: 6 },
		{ id: 'mirror', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'endpointAccuracy'], strokeCount: 4 },
		{ id: 'sphere-contour', unit: 'basic-shapes', metrics: ['pathDeviation', 'smoothness', 'speedConsistency'], strokeCount: 8 },
		{ id: 'curve', unit: 'strokes', metrics: ['pathDeviation', 'smoothness', 'speedConsistency'], strokeCount: 6 },
		{ id: 'constant-pressure', unit: 'strokes', metrics: ['pressureControl', 'smoothness'], strokeCount: 8 },
		{ id: 'taper', unit: 'strokes', metrics: ['taperQuality', 'pressureControl', 'smoothness'], strokeCount: 6 },
		{ id: 'pressure-control', unit: 'strokes', metrics: ['pressureControl', 'smoothness', 'speedConsistency'], strokeCount: 6 },
		{ id: 'hatching', unit: 'strokes', metrics: ['pathDeviation', 'speedConsistency', 'strokeEconomy'], strokeCount: 12 },
		{ id: 'hatching-advanced', unit: 'strokes', metrics: ['pathDeviation', 'speedConsistency', 'strokeEconomy', 'smoothness'], strokeCount: 12 },
		{ id: '1-point-box', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy', 'speedConsistency'], strokeCount: 12 },
		{ id: '2-point-box', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy', 'speedConsistency'], strokeCount: 12 },
		{ id: 'draw-through', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy', 'smoothness'], strokeCount: 6 },
		{ id: 'converging', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy', 'speedConsistency'], strokeCount: 8 },
		{ id: 'free-boxes', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy'], strokeCount: 12 },
		{ id: 'plane-ellipse', unit: 'perspective', metrics: ['pathDeviation', 'smoothness', 'closureGap'], strokeCount: 6 },
		{ id: 'box-study', unit: 'perspective', metrics: ['pathDeviation', 'endpointAccuracy', 'speedConsistency'], strokeCount: 16 },
	];

	let status = $state('');
	let generating = $state(false);

	function clamp(v: number, lo = 0, hi = 100): number {
		return Math.max(lo, Math.min(hi, Math.round(v)));
	}

	function rand(lo: number, hi: number): number {
		return lo + Math.random() * (hi - lo);
	}

	function makeStrokeScore(metrics: MetricKey[], base: number, noise: number): StrokeScore {
		const ss: StrokeScore = {
			pathDeviation: null,
			smoothness: null,
			speedConsistency: null,
			endpointAccuracy: null,
			closureGap: null,
			pressureControl: null,
			taperQuality: null,
			strokeEconomy: null,
			composite: clamp(base + rand(-noise, noise)),
			segments: [],
		};
		for (const mk of metrics) {
			(ss as unknown as Record<string, unknown>)[mk] = clamp(base + rand(-noise * 1.2, noise * 1.2));
		}
		return ss;
	}

	async function generate(days: number, attemptsPerDay: [number, number], clearFirst: boolean) {
		generating = true;
		status = 'Generating...';

		if (clearFirst) {
			await clearAllResults();
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem('boxmaster-streak');
			}
		}

		const now = Date.now();
		const startTime = now - days * 24 * 60 * 60 * 1000;
		let count = 0;

		// Each exercise gets an independent skill trajectory
		const trajectories = EXERCISES.map((ex) => {
			const startSkill = rand(25, 55);
			const growthRate = rand(0.3, 1.2);
			const plateau = rand(70, 95);
			return { ex, startSkill, growthRate, plateau };
		});

		for (let day = 0; day < days; day++) {
			// Skip some days randomly to simulate gaps
			if (Math.random() < 0.15) continue;

			const numAttempts = Math.round(rand(attemptsPerDay[0], attemptsPerDay[1]));
			const dayStart = startTime + day * 24 * 60 * 60 * 1000 + rand(8, 14) * 60 * 60 * 1000;

			// Pick a random subset of exercises for this "session"
			const sessionExercises = trajectories
				.sort(() => Math.random() - 0.5)
				.slice(0, Math.min(numAttempts, trajectories.length));

			for (let i = 0; i < sessionExercises.length; i++) {
				const { ex, startSkill, growthRate, plateau } = sessionExercises[i];
				const progress = day / days;
				// Logistic-ish growth curve with noise
				const skill = Math.min(
					plateau,
					startSkill + (plateau - startSkill) * (1 - Math.exp(-growthRate * progress * 4)),
				);
				const sessionNoise = rand(5, 15);
				const baseScore = clamp(skill + rand(-sessionNoise / 2, sessionNoise / 2));

				const scores: StrokeScore[] = [];
				for (let s = 0; s < ex.strokeCount; s++) {
					scores.push(makeStrokeScore(ex.metrics, baseScore, sessionNoise));
				}

				const metricAverages: Partial<Record<MetricKey, number>> = {};
				for (const mk of ex.metrics) {
					const vals = scores
						.map((s) => (s as unknown as Record<string, unknown>)[mk] as number | null)
						.filter((v): v is number => v != null);
					if (vals.length > 0) {
						metricAverages[mk] = clamp(vals.reduce((a, b) => a + b, 0) / vals.length);
					}
				}

				const timestamp = dayStart + i * rand(60_000, 300_000);

				const result: ExerciseResult = {
					id: `seed-${day}-${i}-${ex.id}-${Math.random().toString(36).slice(2, 8)}`,
					timestamp,
					unit: ex.unit,
					exerciseType: ex.id,
					mode: 'practice',
					strokeCount: ex.strokeCount,
					scores,
					aggregateScore: baseScore,
					metricAverages,
					consistency: clamp(rand(50, 95)),
				};

				await saveResult(result);
				count++;
			}
		}

		status = `Done — inserted ${count} results across ${days} days.`;
		generating = false;
	}
</script>

<div class="seed-page">
	<h1>Seed Progress Data</h1>
	<p class="warn">Dev-only — generates fake exercise results into IndexedDB.</p>

	<div class="actions">
		<button disabled={generating} onclick={() => generate(45, [3, 6], true)}>
			Replace all (45 days, 3–6/day)
		</button>
		<button disabled={generating} onclick={() => generate(90, [2, 5], true)}>
			Replace all (90 days, 2–5/day)
		</button>
		<button disabled={generating} onclick={() => generate(14, [4, 8], false)}>
			Append 14 days (4–8/day)
		</button>
	</div>

	{#if status}
		<p class="status">{status}</p>
	{/if}
</div>

<style>
	.seed-page {
		max-width: 480px;
		margin: 0 auto;
		padding: 40px 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 700;
	}

	.warn {
		color: #fb923c;
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.actions button {
		padding: 10px 20px;
		border-radius: 10px;
		border: 1px solid #3a3a5a;
		background: #1a1a30;
		color: #eeeeff;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
	}

	.actions button:hover:not(:disabled) {
		border-color: #4c6ef5;
		background: #1e1e38;
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.status {
		color: #4ade80;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
</style>
