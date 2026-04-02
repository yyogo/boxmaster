<script lang="ts">
	import '$lib/exercises/init';
	import { getPluginsByUnit } from '$lib/exercises/registry';

	interface Props {
		onSelect: (type: string) => void;
	}

	let { onSelect }: Props = $props();

	const unitOrder = ['basic-shapes', 'strokes', 'perspective'];
	const unitLabels: Record<string, string> = {
		'basic-shapes': 'Basic Shapes',
		strokes: 'Strokes',
		perspective: 'Perspective'
	};

	const byUnit = getPluginsByUnit();
</script>

<div class="picker">
	{#each unitOrder as unit}
		{@const plugins = byUnit.get(unit) ?? []}
		{#if plugins.length > 0}
			<section class="unit">
				<h2 class="unit-title">{unitLabels[unit] ?? unit}</h2>
				<div class="exercise-grid">
					{#each plugins as ex}
						<button class="exercise-card" onclick={() => onSelect(ex.id)}>
							<div class="card-icon">{ex.icon}</div>
							<h3 class="card-title">{ex.label}</h3>
							<p class="card-desc">{ex.description}</p>
							<div class="card-modes">
								{#each ex.availableModes as m}
									<span class="mode-tag">{m}</span>
								{/each}
								{#if ex.requiresPressure}
									<span class="mode-tag pressure-tag">pen required</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/if}
	{/each}

	{#each [...byUnit.keys()].filter((u) => !unitOrder.includes(u)) as unit}
		{@const plugins = byUnit.get(unit) ?? []}
		<section class="unit">
			<h2 class="unit-title">{unitLabels[unit] ?? unit}</h2>
			<div class="exercise-grid">
				{#each plugins as ex}
					<button class="exercise-card" onclick={() => onSelect(ex.id)}>
						<div class="card-icon">{ex.icon}</div>
						<h3 class="card-title">{ex.label}</h3>
						<p class="card-desc">{ex.description}</p>
						<div class="card-modes">
							{#each ex.availableModes as m}
								<span class="mode-tag">{m}</span>
							{/each}
							{#if ex.requiresPressure}
								<span class="mode-tag pressure-tag">pen required</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}

	.unit-title {
		font-size: 1.1rem;
		color: #aaaacc;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 12px;
		font-weight: 500;
	}

	.exercise-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}

	.exercise-card {
		background: #16162a;
		border: 1px solid #2a2a4a;
		border-radius: 12px;
		padding: 20px;
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.exercise-card:hover {
		border-color: #4c6ef5;
		background: #1a1a35;
		transform: translateY(-2px);
	}

	.card-icon {
		font-size: 2rem;
		line-height: 1;
	}

	.card-title {
		font-size: 1rem;
		color: #eeeeff;
		font-weight: 600;
		margin: 0;
	}

	.card-desc {
		font-size: 0.8rem;
		color: #8888aa;
		line-height: 1.4;
		margin: 0;
	}

	.card-modes {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-top: 4px;
	}

	.mode-tag {
		font-size: 0.65rem;
		padding: 2px 8px;
		background: #0d0d1a;
		color: #7777aa;
		border-radius: 10px;
		text-transform: capitalize;
	}

	.pressure-tag {
		background: rgba(244, 114, 182, 0.15);
		color: #f472b6;
		border: 1px solid rgba(244, 114, 182, 0.25);
	}
</style>
