<script lang="ts">
	import type { ExerciseMode } from '$lib/exercises/types';

	interface Props {
		mode: ExerciseMode;
		availableModes: ExerciseMode[];
		strokeCount: number;
		currentStroke: number;
		scored: boolean;
		onModeChange: (mode: ExerciseMode) => void;
		onClear: () => void;
		onUndo: () => void;
		onSubmit: () => void;
		onRetry: () => void;
		onResetView: () => void;
	}

	let {
		mode,
		availableModes,
		strokeCount,
		currentStroke,
		scored,
		onModeChange,
		onClear,
		onUndo,
		onSubmit,
		onRetry,
		onResetView
	}: Props = $props();
</script>

<div class="toolbar">
	<div class="toolbar-group">
		<div class="mode-selector">
			{#each availableModes as m}
				<button
					class="mode-btn"
					class:active={mode === m}
					onclick={() => onModeChange(m)}
					disabled={scored}
				>
					{m}
				</button>
			{/each}
		</div>
	</div>

	<div class="toolbar-group">
		<span class="stroke-count">
			{currentStroke} / {strokeCount}
		</span>
	</div>

	<div class="toolbar-group">
		{#if scored}
			<button class="tool-btn primary" onclick={onRetry}>New Exercise</button>
		{:else}
			<button class="tool-btn" onclick={onUndo} disabled={currentStroke === 0}>Undo</button>
			<button class="tool-btn" onclick={onClear} disabled={currentStroke === 0}>Clear</button>
			<button class="tool-btn primary" onclick={onSubmit} disabled={currentStroke === 0}>
				Done
			</button>
		{/if}
		<button class="tool-btn" onclick={onResetView} title="Reset pan/rotate">⟲</button>
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: #16162a;
		border-radius: 8px;
		gap: 16px;
		flex-wrap: wrap;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mode-selector {
		display: flex;
		gap: 2px;
		background: #0d0d1a;
		border-radius: 6px;
		padding: 2px;
	}

	.mode-btn {
		padding: 6px 14px;
		border: none;
		background: transparent;
		color: #8888aa;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
		text-transform: capitalize;
		transition: all 0.15s;
	}

	.mode-btn:hover:not(:disabled) {
		color: #ccccee;
	}

	.mode-btn.active {
		background: #2a2a4a;
		color: #eeeeff;
	}

	.mode-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.stroke-count {
		font-size: 0.9rem;
		color: #8888aa;
		font-variant-numeric: tabular-nums;
	}

	.tool-btn {
		padding: 6px 14px;
		border: 1px solid #333355;
		background: #1e1e3a;
		color: #ccccee;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		transition: all 0.15s;
	}

	.tool-btn:hover:not(:disabled) {
		background: #2a2a4a;
		border-color: #5555aa;
	}

	.tool-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.tool-btn.primary {
		background: #3b5bdb;
		border-color: #4c6ef5;
		color: #fff;
	}

	.tool-btn.primary:hover:not(:disabled) {
		background: #4c6ef5;
	}
</style>
