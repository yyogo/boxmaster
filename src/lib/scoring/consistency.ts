import type { ExerciseResult } from './types';

export function computeConsistency(results: ExerciseResult[], windowSize = 5): number {
	if (results.length < 2) return 100;

	const recent = results.slice(-windowSize);
	const scores = recent.map((r) => r.aggregateScore);

	const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
	if (mean === 0) return 0;

	const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
	const cv = Math.sqrt(variance) / mean;

	// cv of 0 = 100 (perfectly consistent), cv of 1+ = 0
	return Math.max(0, Math.min(100, 100 - cv * 100));
}
