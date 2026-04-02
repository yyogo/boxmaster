import type { StrokePoint } from '$lib/input/stroke';

/**
 * Returns both sub-scores so callers can store them separately.
 */
export function scoreFlow(points: StrokePoint[]): { steadiness: number; speed: number } {
	return {
		steadiness: scoreSteadiness(points),
		speed: scoreSpeed(points),
	};
}

/**
 * Steadiness — how smooth/even the stroke velocity is (CV-based).
 * Low CV → high score.  Does NOT penalise absolute speed.
 *
 * We smooth raw velocities with a moving-average window to remove
 * digitizer noise, and trim the first/last 15% of the stroke where
 * natural acceleration/deceleration would unfairly inflate CV.
 */
export function scoreSteadiness(points: StrokePoint[]): number {
	if (points.length < 5) return 100;

	const rawVel: number[] = [];
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const dt = points[i].timestamp - points[i - 1].timestamp;
		if (dt > 0) rawVel.push(Math.sqrt(dx * dx + dy * dy) / dt);
	}

	if (rawVel.length < 4) return 100;

	// Moving-average smooth (window = 5) to reduce digitizer jitter
	const W = Math.min(5, Math.floor(rawVel.length / 2));
	const smoothed: number[] = [];
	for (let i = 0; i < rawVel.length; i++) {
		const lo = Math.max(0, i - Math.floor(W / 2));
		const hi = Math.min(rawVel.length, i + Math.ceil(W / 2));
		let sum = 0;
		for (let j = lo; j < hi; j++) sum += rawVel[j];
		smoothed.push(sum / (hi - lo));
	}

	// Trim first/last 15% — acceleration/deceleration at endpoints is natural
	const trim = Math.max(1, Math.floor(smoothed.length * 0.15));
	const mid = smoothed.slice(trim, smoothed.length - trim);
	const velocities = mid.length >= 3 ? mid : smoothed;

	const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
	if (mean === 0) return 0;

	const variance =
		velocities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / velocities.length;
	const cv = Math.sqrt(variance) / mean;

	// Gentler curve: CV of 0 → 100, CV of ~0.8 → 75, CV of ~1.5 → 50
	return Math.round(Math.max(0, Math.min(100, 100 - cv * 33)));
}

/**
 * Speed — whether the stroke was drawn with confident speed vs cautious tracing.
 * Normalised so short/long and open/closed strokes are comparable.
 *
 * For open strokes (chord ≥ 40% of arc) we use chord as the reference length.
 * For closed/looping strokes (circles, ellipses, curves that double back)
 * we use the arc length itself — otherwise the near-zero chord blows up the ratio.
 *
 *   < 0.3 ref-lengths/sec → low
 *   0.5 – 3 ref-lengths/sec → full
 *   > 5 ref-lengths/sec → mild penalty
 */
export function scoreSpeed(points: StrokePoint[], strokeLength?: number): number {
	if (points.length < 2) return 100;

	let totalDist = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		totalDist += Math.sqrt(dx * dx + dy * dy);
	}

	if (totalDist < 1) return 100;

	const chord = strokeLength ?? (() => {
		const dx = points[points.length - 1].x - points[0].x;
		const dy = points[points.length - 1].y - points[0].y;
		return Math.sqrt(dx * dx + dy * dy);
	})();

	// For closed shapes (circle, ellipse) chord ≈ 0 — use arc length as reference
	const refLength = (chord > totalDist * 0.4) ? chord : totalDist;

	const totalTime = (points[points.length - 1].timestamp - points[0].timestamp) / 1000;
	if (totalTime <= 0) return 100;

	const normalizedSpeed = (totalDist / refLength) / totalTime;

	return Math.round(speedCurve(normalizedSpeed));
}

/**
 * Maps normalised speed (stroke-lengths/sec) to 0–100.
 */
function speedCurve(slps: number): number {
	if (slps < 0.1) return 0;
	if (slps < 0.3) return lerp(0, 40, (slps - 0.1) / 0.2);
	if (slps < 0.5) return lerp(40, 85, (slps - 0.3) / 0.2);
	if (slps <= 3.0) return lerp(85, 100, Math.min(1, (slps - 0.5) / 1.0));
	if (slps <= 5.0) return lerp(100, 75, (slps - 3.0) / 2.0);
	return Math.max(30, lerp(75, 30, (slps - 5.0) / 5.0));
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
