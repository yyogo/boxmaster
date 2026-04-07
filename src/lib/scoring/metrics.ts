import type { StrokePoint } from '$lib/input/stroke';

/**
 * Path Deviation — average distance of user points from an ideal path.
 * The caller supplies a distanceFn that returns the distance from a single
 * point to the reference shape (line, curve, circle, etc.).
 * Returns 0-100 where 100 = perfect overlap.
 */
export function scorePathDeviation(
	points: StrokePoint[],
	distanceFn: (px: number, py: number) => number,
	tolerance = 50,
): number {
	if (points.length === 0) return 0;
	let total = 0;
	for (const p of points) total += distanceFn(p.x, p.y);
	const avg = total / points.length;
	return Math.round(Math.max(0, Math.min(100, 100 - (avg / tolerance) * 100)));
}

/**
 * Smoothness — inverse of directional jitter.
 * Counts abrupt direction changes in a sliding window; fewer = smoother.
 * Distinct from speedConsistency: this is spatial, not temporal.
 */
export function scoreSmoothness(points: StrokePoint[]): number {
	if (points.length < 6) return 100;

	let dirChanges = 0;
	let totalChecks = 0;

	for (let i = 2; i < points.length; i++) {
		const d1x = points[i - 1].x - points[i - 2].x;
		const d1y = points[i - 1].y - points[i - 2].y;
		const d2x = points[i].x - points[i - 1].x;
		const d2y = points[i].y - points[i - 1].y;

		const mag1 = Math.sqrt(d1x * d1x + d1y * d1y);
		const mag2 = Math.sqrt(d2x * d2x + d2y * d2y);
		if (mag1 < 0.5 || mag2 < 0.5) continue;

		totalChecks++;
		const cross = d1x * d2y - d1y * d2x;
		const dot = d1x * d2x + d1y * d2y;
		if (dot < 0 || Math.abs(cross) > Math.abs(dot) * 0.5) {
			dirChanges++;
		}
	}

	if (totalChecks === 0) return 100;
	const jitterRatio = dirChanges / totalChecks;
	return Math.round(Math.max(0, Math.min(100, 100 - jitterRatio * 200)));
}

/**
 * Speed Consistency — how even the velocity is along the stroke.
 * Uses coefficient of variation on smoothed velocities, trimming
 * natural start/end acceleration.
 */
export function scoreSpeedConsistency(points: StrokePoint[]): number {
	if (points.length < 5) return 100;

	const rawVel: number[] = [];
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		const dt = points[i].timestamp - points[i - 1].timestamp;
		if (dt > 0) rawVel.push(Math.sqrt(dx * dx + dy * dy) / dt);
	}
	if (rawVel.length < 4) return 100;

	const W = Math.min(5, Math.floor(rawVel.length / 2));
	const smoothed: number[] = [];
	for (let i = 0; i < rawVel.length; i++) {
		const lo = Math.max(0, i - Math.floor(W / 2));
		const hi = Math.min(rawVel.length, i + Math.ceil(W / 2));
		let sum = 0;
		for (let j = lo; j < hi; j++) sum += rawVel[j];
		smoothed.push(sum / (hi - lo));
	}

	const trim = Math.max(1, Math.floor(smoothed.length * 0.15));
	const mid = smoothed.slice(trim, smoothed.length - trim);
	const velocities = mid.length >= 3 ? mid : smoothed;

	const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
	if (mean === 0) return 0;

	const variance = velocities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / velocities.length;
	const cv = Math.sqrt(variance) / mean;

	return Math.round(Math.max(0, Math.min(100, 100 - cv * 33)));
}

/**
 * Endpoint Accuracy — how close the stroke's start/end are to the target endpoints.
 * Normalised by the reference length so short and long strokes are comparable.
 */
export function scoreEndpointAccuracy(
	points: StrokePoint[],
	target: { start: { x: number; y: number }; end: { x: number; y: number } },
	options?: { startWeight?: number },
): number {
	if (points.length < 2) return 0;

	const s = points[0];
	const e = points[points.length - 1];
	const refLen = Math.sqrt(
		(target.end.x - target.start.x) ** 2 + (target.end.y - target.start.y) ** 2,
	);
	if (refLen < 1) return 100;

	const fwdStart = Math.sqrt((s.x - target.start.x) ** 2 + (s.y - target.start.y) ** 2);
	const fwdEnd = Math.sqrt((e.x - target.end.x) ** 2 + (e.y - target.end.y) ** 2);
	const revStart = Math.sqrt((s.x - target.end.x) ** 2 + (s.y - target.end.y) ** 2);
	const revEnd = Math.sqrt((e.x - target.start.x) ** 2 + (e.y - target.start.y) ** 2);

	const isForward = fwdStart + fwdEnd <= revStart + revEnd;
	const startDist = isForward ? fwdStart : revStart;
	const endDist = isForward ? fwdEnd : revEnd;

	const sw = options?.startWeight ?? 0.5;
	const scoreOne = (d: number) => Math.max(0, Math.min(100, 100 - (d / refLen) * 400));
	return Math.round(sw * scoreOne(startDist) + (1 - sw) * scoreOne(endDist));
}

/**
 * Closure Gap — how well a closed shape's stroke returns to its start.
 * Normalised by perimeter so large and small shapes are comparable.
 */
export function scoreClosureGap(
	points: StrokePoint[],
	refPerimeter: number,
): number {
	if (points.length < 3 || refPerimeter < 1) return 100;

	const s = points[0];
	const e = points[points.length - 1];
	const gap = Math.sqrt((e.x - s.x) ** 2 + (e.y - s.y) ** 2);
	const ratio = gap / refPerimeter;
	// Gap = 0 → 100, gap > 10% of perimeter → 0
	return Math.round(Math.max(0, Math.min(100, 100 - ratio * 1000)));
}

/**
 * Pressure Control — consistency of pressure along a stroke.
 * Without a target profile: measures raw pressure variance (low variance = high score).
 * With a target profile: measures match to the target.
 */
export function scorePressureControl(
	points: StrokePoint[],
	targetProfile?: number[],
): number | null {
	if (points.length < 3) return null;

	const uniqueP = new Set(points.map(p => Math.round(p.pressure * 100)));
	if (uniqueP.size <= 1) return null;

	if (targetProfile && targetProfile.length > 0) {
		const step = (targetProfile.length - 1) / Math.max(1, points.length - 1);
		let totalErr = 0;
		for (let i = 0; i < points.length; i++) {
			const tIdx = Math.min(targetProfile.length - 1, Math.round(i * step));
			totalErr += Math.abs(points[i].pressure - targetProfile[tIdx]);
		}
		const avgErr = totalErr / points.length;
		return Math.round(Math.max(0, Math.min(100, 100 - avgErr * 333)));
	}

	const pressures = points.map(p => p.pressure);
	const mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
	const variance = pressures.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pressures.length;
	const stdev = Math.sqrt(variance);
	return Math.round(Math.max(0, Math.min(100, 100 - (stdev / 0.3) * 100)));
}

/**
 * Taper Quality — how well the stroke's pressure ramps match the target.
 * Checks the first and last 20% of the stroke against the expected pressures.
 */
export function scoreTaperQuality(
	points: StrokePoint[],
	target: { startPressure: number; endPressure: number },
): number | null {
	if (points.length < 5) return null;

	const uniqueP = new Set(points.map(p => Math.round(p.pressure * 100)));
	if (uniqueP.size <= 1) return null;

	const n = points.length;
	const headCount = Math.max(2, Math.floor(n * 0.2));
	const tailCount = Math.max(2, Math.floor(n * 0.2));

	let headErr = 0;
	for (let i = 0; i < headCount; i++) {
		headErr += Math.abs(points[i].pressure - target.startPressure);
	}
	headErr /= headCount;

	let tailErr = 0;
	for (let i = n - tailCount; i < n; i++) {
		tailErr += Math.abs(points[i].pressure - target.endPressure);
	}
	tailErr /= tailCount;

	const avgErr = (headErr + tailErr) / 2;
	return Math.round(Math.max(0, Math.min(100, 100 - avgErr * 250)));
}

/**
 * Stroke Economy — did the user use the expected number of strokes?
 */
export function scoreStrokeEconomy(actual: number, expected: number): number {
	if (expected <= 0) return 100;
	if (actual <= expected) return 100;
	const excess = actual - expected;
	return Math.round(Math.max(0, 100 - (excess / expected) * 100));
}

// --- Segment detection (moved from flow.ts) ---

export function detectHesitations(
	points: StrokePoint[],
	thresholdMs = 80,
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
	windowSize = 10,
): { start: number; end: number }[] {
	if (points.length < windowSize) return [];

	const jittery: { start: number; end: number }[] = [];

	for (let i = 0; i <= points.length - windowSize; i++) {
		const w = points.slice(i, i + windowSize);
		let dirChanges = 0;
		for (let j = 2; j < w.length; j++) {
			const d1x = w[j - 1].x - w[j - 2].x;
			const d1y = w[j - 1].y - w[j - 2].y;
			const d2x = w[j].x - w[j - 1].x;
			const d2y = w[j].y - w[j - 1].y;
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

export function detectPressureSpikes(
	points: StrokePoint[],
): { start: number; end: number }[] {
	if (points.length < 5) return [];

	const pressures = points.map(p => p.pressure);
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
