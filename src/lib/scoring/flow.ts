import type { StrokePoint } from '$lib/input/stroke';

/**
 * Score stroke flow based on two factors:
 * 1. Consistency — low coefficient of variation in velocity (40% weight)
 * 2. Speed — strokes should be drawn with confidence, not slow/cautious tracing.
 *    We measure px/ms and map it through a curve where:
 *      < 0.15 px/ms ≈ too slow (heavy penalty)
 *      ~ 0.4–1.5 px/ms ≈ confident (full score)
 *      > 2.5 px/ms ≈ rushed (mild penalty)
 */
export function scoreFlow(points: StrokePoint[]): number {
	if (points.length < 3) return 100;

	const velocities: number[] = [];
	let totalDist = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const seg = Math.sqrt(dx * dx + dy * dy);
		totalDist += seg;
		const dt = points[i].timestamp - points[i - 1].timestamp;
		if (dt > 0) {
			velocities.push(seg / dt);
		}
	}

	if (velocities.length < 2) return 100;

	const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
	if (mean === 0) return 0;

	// Consistency component (0–100)
	const variance =
		velocities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / velocities.length;
	const cv = Math.sqrt(variance) / mean;
	const consistencyScore = Math.max(0, Math.min(100, 100 - cv * 50));

	// Speed component (0–100)
	const totalTime = points[points.length - 1].timestamp - points[0].timestamp;
	const avgSpeed = totalTime > 0 ? totalDist / totalTime : 0; // px/ms
	const speedScore = speedCurve(avgSpeed);

	return Math.round(consistencyScore * 0.5 + speedScore * 0.5);
}

/** Maps average speed (px/ms) to a 0–100 score. */
function speedCurve(speed: number): number {
	if (speed < 0.05) return 0;
	if (speed < 0.15) return lerp(0, 40, (speed - 0.05) / 0.1);
	if (speed < 0.35) return lerp(40, 85, (speed - 0.15) / 0.2);
	if (speed <= 1.8) return lerp(85, 100, Math.min(1, (speed - 0.35) / 0.5));
	if (speed <= 3.0) return lerp(100, 70, (speed - 1.8) / 1.2);
	return Math.max(30, lerp(70, 30, (speed - 3.0) / 3.0));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function detectHesitations(
	points: StrokePoint[],
	thresholdMs = 80
): { start: number; end: number }[] {
	const hesitations: { start: number; end: number }[] = [];
	let hesStart = -1;

	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const dt = points[i].timestamp - points[i - 1].timestamp;
		const speed = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

		if (speed < 0.05 && dt > 0) {
			if (hesStart === -1) hesStart = i - 1;
		} else {
			if (hesStart !== -1) {
				const totalTime = points[i - 1].timestamp - points[hesStart].timestamp;
				if (totalTime > thresholdMs) {
					hesitations.push({ start: hesStart, end: i - 1 });
				}
				hesStart = -1;
			}
		}
	}

	if (hesStart !== -1) {
		const totalTime = points[points.length - 1].timestamp - points[hesStart].timestamp;
		if (totalTime > thresholdMs) {
			hesitations.push({ start: hesStart, end: points.length - 1 });
		}
	}

	return hesitations;
}

export function detectJitter(
	points: StrokePoint[],
	windowSize = 10
): { start: number; end: number }[] {
	if (points.length < windowSize) return [];

	const jittery: { start: number; end: number }[] = [];

	for (let i = 0; i <= points.length - windowSize; i++) {
		const window = points.slice(i, i + windowSize);
		// Compute direction changes
		let dirChanges = 0;
		for (let j = 2; j < window.length; j++) {
			const d1x = window[j - 1].x - window[j - 2].x;
			const d1y = window[j - 1].y - window[j - 2].y;
			const d2x = window[j].x - window[j - 1].x;
			const d2y = window[j].y - window[j - 1].y;
			const cross = d1x * d2y - d1y * d2x;
			const dot = d1x * d2x + d1y * d2y;
			if (dot < 0 || Math.abs(cross) > Math.abs(dot) * 0.5) {
				dirChanges++;
			}
		}

		if (dirChanges > windowSize * 0.4) {
			if (jittery.length > 0 && jittery[jittery.length - 1].end >= i - 1) {
				jittery[jittery.length - 1].end = i + windowSize - 1;
			} else {
				jittery.push({ start: i, end: i + windowSize - 1 });
			}
		}
	}

	return jittery;
}
