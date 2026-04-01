<script lang="ts">
	import type { ExerciseDefinition } from '$lib/exercises/types';
	import {
		lineDefinition,
		circleDefinition,
		ellipseDefinition,
		rectangleDefinition,
		perspectiveDefinition
	} from '$lib/exercises/generator';

	interface Props {
		onSelect: (type: string) => void;
	}

	let { onSelect }: Props = $props();

	const basicShapes: ExerciseDefinition[] = [
		lineDefinition,
		circleDefinition,
		ellipseDefinition,
		rectangleDefinition
	];

	const perspectiveExercises: ExerciseDefinition[] = [perspectiveDefinition];

	function iconFor(type: string): string {
		switch (type) {
			case 'line':
				return '╱';
			case 'circle':
				return '○';
			case 'ellipse':
				return '⬮';
			case 'rectangle':
				return '▭';
			case '1-point-box':
				return '⬟';
			default:
				return '?';
		}
	}
</script>

<div class="picker">
	<section class="unit">
		<h2 class="unit-title">Basic Shapes</h2>
		<div class="exercise-grid">
			{#each basicShapes as ex}
				<button class="exercise-card" onclick={() => onSelect(ex.type)}>
					<div class="card-icon">{iconFor(ex.type)}</div>
					<h3 class="card-title">{ex.label}</h3>
					<p class="card-desc">{ex.description}</p>
					<div class="card-modes">
						{#each ex.availableModes as m}
							<span class="mode-tag">{m}</span>
						{/each}
					</div>
				</button>
			{/each}
		</div>
	</section>

	<section class="unit">
		<h2 class="unit-title">Perspective</h2>
		<div class="exercise-grid">
			{#each perspectiveExercises as ex}
				<button class="exercise-card" onclick={() => onSelect(ex.type)}>
					<div class="card-icon">{iconFor(ex.type)}</div>
					<h3 class="card-title">{ex.label}</h3>
					<p class="card-desc">{ex.description}</p>
					<div class="card-modes">
						{#each ex.availableModes as m}
							<span class="mode-tag">{m}</span>
						{/each}
					</div>
				</button>
			{/each}
		</div>
	</section>
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
</style>
