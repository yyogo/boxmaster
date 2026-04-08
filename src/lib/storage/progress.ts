import type { ExerciseResult } from '$lib/scoring/types';
import { getResultsByType, getAllResults } from './db';

export interface ProgressSummary {
	exerciseType: string;
	totalAttempts: number;
	bestScore: number;
	recentAvg: number;
	trend: 'improving' | 'stable' | 'declining';
	lastAttempt: number | null;
}

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

		summaries.push({
			exerciseType: type,
			totalAttempts: results.length,
			bestScore: Math.max(...scores),
			recentAvg: Math.round(recentAvg),
			trend,
			lastAttempt: sorted[sorted.length - 1]?.timestamp ?? null,
		});
	}

	return summaries;
}

export async function getExerciseHistory(exerciseType: string): Promise<ExerciseResult[]> {
	return getResultsByType(exerciseType);
}
