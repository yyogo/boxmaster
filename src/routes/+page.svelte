<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';
	import { dailySession } from '$lib/daily/session.svelte';
	import { getActiveStreak } from '$lib/daily/streak';

	let streak = $state(0);
	let dailyMinutes = $state(15);
	let starting = $state(false);

	const DURATION_OPTIONS = [5, 10, 15, 20, 30];

	function handleSelect(type: string) {
		goto(`${base}/exercise/${type}`);
	}

	async function startDaily() {
		starting = true;
		await dailySession.start(dailyMinutes);
		const first = dailySession.currentExercise;
		starting = false;
		if (first) goto(`${base}/exercise/${first}`);
	}

	onMount(() => {
		streak = getActiveStreak();
	});
</script>

<div class="home">
	<header class="hero">
		<h1>BoxMaster</h1>
		<p class="subtitle">Improve your drawing technique with guided exercises and instant feedback.</p>
	</header>

	<section class="daily-section">
		<div class="daily-card">
			<div class="daily-left">
				<h2 class="daily-title">Daily Practice</h2>
				<p class="daily-desc">A guided session that picks exercises based on your progress.</p>

				<div class="duration-row">
					{#each DURATION_OPTIONS as d}
						<button
							class="dur-chip"
							class:active={dailyMinutes === d}
							onclick={() => dailyMinutes = d}
						>{d} min</button>
					{/each}
				</div>

				<button class="daily-start" onclick={startDaily} disabled={starting}>
					{starting ? 'Loading...' : 'Start Session'}
				</button>
			</div>

			<div class="daily-right">
				{#if streak > 0}
					<div class="streak-display">
						<span class="streak-flame">&#x1F525;</span>
						<span class="streak-num">{streak}</span>
						<span class="streak-label">day{streak === 1 ? '' : 's'}</span>
					</div>
				{:else}
					<div class="streak-display muted">
						<span class="streak-flame">&#x1F525;</span>
						<span class="streak-num">0</span>
						<span class="streak-label">Start a streak!</span>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<ExercisePicker onSelect={handleSelect} />
</div>

<style>
	.home {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}

	.hero {
		text-align: center;
		padding: 24px 0;
	}

	.hero h1 {
		font-size: 2.2rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	.subtitle {
		color: #8888aa;
		font-size: 1rem;
		margin-top: 8px;
	}

	/* --- Daily Practice --- */

	.daily-section {
		margin-bottom: 8px;
	}

	.daily-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: linear-gradient(135deg, #1a1a40, #1e1445);
		border: 1px solid #2e2a5a;
		border-radius: 16px;
		padding: 28px 32px;
		gap: 24px;
	}

	.daily-left {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.daily-title {
		font-size: 1.3rem;
		font-weight: 700;
		color: #eeeeff;
	}

	.daily-desc {
		font-size: 0.85rem;
		color: #8888aa;
		line-height: 1.4;
	}

	.duration-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.dur-chip {
		padding: 5px 14px;
		border-radius: 20px;
		border: 1px solid #3a3a6a;
		background: rgba(20, 20, 50, 0.6);
		color: #aaaacc;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.dur-chip:hover {
		border-color: #6c6ef5;
		color: #ccccee;
	}

	.dur-chip.active {
		background: rgba(76, 110, 245, 0.5);
		border-color: rgba(76, 110, 245, 0.6);
		color: #fff;
	}

	.daily-start {
		align-self: flex-start;
		padding: 10px 28px;
		border-radius: 12px;
		border: none;
		background: linear-gradient(135deg, #4c6ef5, #7c3aed);
		color: #fff;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		margin-top: 4px;
	}

	.daily-start:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(76, 110, 245, 0.4);
	}

	.daily-start:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.daily-right {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 100px;
	}

	.streak-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.streak-display.muted {
		opacity: 0.5;
	}

	.streak-flame {
		font-size: 2.2rem;
		line-height: 1;
		filter: drop-shadow(0 0 8px rgba(255, 160, 40, 0.5));
	}

	.streak-num {
		font-size: 1.8rem;
		font-weight: 800;
		color: #ffbb44;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.streak-label {
		font-size: 0.7rem;
		color: #8888aa;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	@media (max-width: 640px) {
		.daily-card {
			flex-direction: column;
			padding: 20px;
		}

		.daily-right {
			min-width: unset;
		}

		.daily-start {
			align-self: stretch;
			text-align: center;
		}
	}
</style>
