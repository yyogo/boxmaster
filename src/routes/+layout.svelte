<script lang="ts">
	import { base } from '$app/paths';
	let { children } = $props();
</script>

<svelte:head>
	<title>BoxMaster</title>
	<meta name="description" content="Drawing practice app inspired by drawabox" />
</svelte:head>

<div class="app">
	<nav class="nav">
		<a href="{base}/" class="nav-brand">BoxMaster</a>
		<div class="nav-links">
			<a href="{base}/">Exercises</a>
			<a href="{base}/progress">Progress</a>
		</div>
	</nav>

	<main class="main">
		{@render children()}
	</main>
</div>

<style>
	:global(*) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	:global(html, body) {
		height: 100%;
	}

	:global(body) {
		font-family:
			'Inter',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		background: #0d0d1a;
		color: #eeeeff;
		-webkit-font-smoothing: antialiased;
		overflow-y: auto;
	}

	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 24px;
		background: #111125;
		border-bottom: 1px solid #1e1e3a;
	}

	.nav-brand {
		font-size: 1.2rem;
		font-weight: 700;
		color: #eeeeff;
		text-decoration: none;
		letter-spacing: -0.02em;
	}

	.nav-links {
		display: flex;
		gap: 20px;
	}

	.nav-links a {
		color: #8888aa;
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.15s;
	}

	.nav-links a:hover {
		color: #ccccee;
	}

	.main {
		flex: 1;
		padding: 24px;
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
	}

	@media (max-width: 640px) {
		.nav {
			padding: 10px 16px;
		}

		.nav-brand {
			font-size: 1rem;
		}

		.main {
			padding: 12px;
		}
	}
</style>
