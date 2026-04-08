import type { ExerciseResult } from '$lib/scoring/types';
import type { ExerciseMode } from '$lib/exercises/types';
import { getResultsByType, getAllResults } from './db';

export interface ModeStats {
	count: number;
	avg: number;
}

export interface ProgressSummary {
	exerciseType: string;
	totalAttempts: number;
	bestScore: number;
	recentAvg: number;
	trend: 'improving' | 'stable' | 'declining';
	lastAttempt: number | null;
	modeBreakdown: Partial<Record<string, ModeStats>>;
	latestMode: string | null;
}

const MODE_ORDER: ExerciseMode[] = ['tracing', 'challenge', 'memory', 'free'];

export async function getProgressSummaries(): Promise<ProgressSummary[]> {
	const all = await getAllResults();

	const byType = new Map<string, ExerciseResult[]>();
	for (const r of all) {
		const existing = byType.get(r.exerciseType) || [];
		existing.push(r);
		byType.set(r.exerciseType, existing);
	}

	const summaries: ProgressSummary[] = [];

	for (const [type, results] of byType) {
		const sorted = results.sort((a, b) => a.timestamp - b.timestamp);
		const scores = sorted.map((r) => r.aggregateScore);
		const recent = scores.slice(-5);
		const older = scores.slice(-10, -5);

		const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
		const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;

		let trend: 'improving' | 'stable' | 'declining' = 'stable';
		if (recentAvg > olderAvg + 3) trend = 'improving';
		else if (recentAvg < olderAvg - 3) trend = 'declining';

		const modeBreakdown: Partial<Record<string, ModeStats>> = {};
		const byMode = new Map<string, number[]>();
		for (const r of sorted) {
			const list = byMode.get(r.mode) ?? [];
			list.push(r.aggregateScore);
			byMode.set(r.mode, list);
		}
		for (const [m, vals] of byMode) {
			modeBreakdown[m] = {
				count: vals.length,
				avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
			};
		}

		summaries.push({
			exerciseType: type,
			totalAttempts: results.length,
			bestScore: Math.max(...scores),
			recentAvg: Math.round(recentAvg),
			trend,
			lastAttempt: sorted[sorted.length - 1]?.timestamp ?? null,
			modeBreakdown,
			latestMode: sorted[sorted.length - 1]?.mode ?? null,
		});
	}

	return summaries;
}

/**
 * Suggest the next mode for an exercise based on recent performance.
 * Returns null if no upgrade is warranted.
 */
export function suggestedMode(
	results: ExerciseResult[],
	currentMode: ExerciseMode,
): ExerciseMode | null {
	const THRESHOLD = 80;
	const MIN_SESSIONS = 5;

	const currentIdx = MODE_ORDER.indexOf(currentMode);
	if (currentIdx < 0 || currentIdx >= MODE_ORDER.length - 1) return null;

	const modeResults = results
		.filter((r) => r.mode === currentMode)
		.sort((a, b) => a.timestamp - b.timestamp);

	if (modeResults.length < MIN_SESSIONS) return null;

	const recentScores = modeResults.slice(-MIN_SESSIONS).map((r) => r.aggregateScore);
	const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

	if (avg >= THRESHOLD) {
		return MODE_ORDER[currentIdx + 1];
	}
	return null;
}

export async function getExerciseHistory(exerciseType: string): Promise<ExerciseResult[]> {
	return getResultsByType(exerciseType);
}
