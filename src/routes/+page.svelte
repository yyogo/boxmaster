<script lang="ts">
	import { goto } from '$app/navigation';
	import ExercisePicker from '$lib/components/ExercisePicker.svelte';

	function handleSelect(type: string) {
		goto(`/exercise/${type}`);
	}
</script>

<div class="home">
	<header class="hero">
		<h1>BoxMaster</h1>
		<p class="subtitle">Improve your drawing technique with guided exercises and instant feedback.</p>
	</header>

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
</style>
