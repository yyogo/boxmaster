import '$lib/exercises/init';
import { getAllPlugins } from '$lib/exercises/registry';
import { getAllResults } from '$lib/storage/db';
import type { ExerciseResult } from '$lib/scoring/types';
import type { ExercisePlugin } from '$lib/exercises/plugin';

const UNIT_ORDER: Record<string, number> = {
	'basic-shapes': 0,
	strokes: 1,
	perspective: 2,
};

const SHAPES_PER_EXERCISE = 10;

interface ScoredPlugin {
	plugin: ExercisePlugin;
	priority: number;
}

export interface DailyPlan {
	exercises: { type: string; shapesCount: number }[];
}

function rankPlugins(plugins: ExercisePlugin[], allResults: ExerciseResult[]): ScoredPlugin[] {
	const byType = new Map<string, ExerciseResult[]>();
	for (const r of allResults) {
		const list = byType.get(r.exerciseType) ?? [];
		list.push(r);
		byType.set(r.exerciseType, list);
	}

	const maxPractice = Math.max(1, ...Array.from(byType.values()).map((v) => v.length));

	const scored: ScoredPlugin[] = plugins.map((plugin) => {
		const results = byType.get(plugin.id) ?? [];
		const practiceCount = results.length;
		const normalizedPractice = practiceCount / maxPractice;

		const recent = results.slice(-5);
		const avgScore = recent.length > 0 ? recent.reduce((s, r) => s + r.aggregateScore, 0) / recent.length : 0;
		const normalizedScore = avgScore / 100;

		const unitWeight = 1 - (UNIT_ORDER[plugin.unit] ?? 2) / 3;

		const priority = unitWeight * 0.25 + (1 - normalizedPractice) * 0.4 + (1 - normalizedScore) * 0.35;

		return { plugin, priority };
	});

	scored.sort((a, b) => b.priority - a.priority);
	return scored;
}

export async function buildDailyPlan(durationMinutes: number): Promise<DailyPlan> {
	const plugins = getAllPlugins().filter((p) => !p.requiresPressure);
	const allResults = await getAllResults();
	const scored = rankPlugins(plugins, allResults);

	const roughExCount = Math.max(3, Math.round(durationMinutes / 2.5));
	const selected = scored.slice(0, roughExCount);

	return {
		exercises: selected.map((s) => ({
			type: s.plugin.id,
			shapesCount: SHAPES_PER_EXERCISE,
		})),
	};
}

/** Pick the single best next exercise, excluding `currentType`. */
export async function getNextRecommended(currentType?: string): Promise<{ type: string; label: string } | null> {
	const plugins = getAllPlugins().filter((p) => !p.requiresPressure);
	const allResults = await getAllResults();
	const scored = rankPlugins(plugins, allResults);

	for (const s of scored) {
		if (s.plugin.id !== currentType) {
			return { type: s.plugin.id, label: s.plugin.label };
		}
	}
	if (scored.length > 0) {
		return { type: scored[0].plugin.id, label: scored[0].plugin.label };
	}
	return null;
}
