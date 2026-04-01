import type { StrokePoint } from '$lib/input/stroke';

export function scoreConfidence(points: StrokePoint[]): number | null {
	if (points.length < 3) return null;

	// Check if we actually have real pressure data (not all 0.5 default)
	const uniquePressures = new Set(points.map((p) => Math.round(p.pressure * 100)));
	if (uniquePressures.size <= 1) return null;

	const pressures = points.map((p) => p.pressure);
	const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
	const variance = pressures.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pressures.length;
	const stdev = Math.sqrt(variance);

	// stdev of 0 = 100, stdev of 0.3+ = 0
	return Math.max(0, Math.min(100, 100 - (stdev / 0.3) * 100));
}

export function detectPressureSpikes(
	points: StrokePoint[]
): { start: number; end: number }[] {
	if (points.length < 5) return [];

	const pressures = points.map((p) => p.pressure);
	const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
	const variance = pressures.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pressures.length;
	const stdev = Math.sqrt(variance);

	if (stdev < 0.01) return [];

	const spikes: { start: number; end: number }[] = [];
	const threshold = 2 * stdev;

	for (let i = 0; i < points.length; i++) {
		if (Math.abs(pressures[i] - mean) > threshold) {
			if (spikes.length > 0 && spikes[spikes.length - 1].end >= i - 2) {
				spikes[spikes.length - 1].end = i;
			} else {
				spikes.push({ start: i, end: i });
			}
		}
	}

	return spikes;
}
