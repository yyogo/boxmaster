import type { StrokeScore, MetricKey } from '$lib/scoring/types';

export interface Tip {
	text: string;
	/** Which exercise types this applies to (empty = all) */
	exercises?: string[];
	/** If set, only show when the named metric is below this threshold */
	trigger?: { score: MetricKey; below: number };
}

const GENERAL_TIPS: Tip[] = [
	{ text: 'Draw from your shoulder, not your wrist — it produces smoother, more confident lines.' },
	{ text: 'Ghost your stroke a few times before committing. Hover over the path without touching down, then draw.' },
	{ text: 'You can pan and zoom the canvas — use two fingers or scroll to find a comfortable working area.' },
	{ text: 'Focus on the destination, not your pen tip. Your hand follows your eyes.' },
	{ text: 'Speed over precision — a fast, slightly off stroke trains better muscle memory than a slow, traced one.' },
	{ text: 'Breathe. Tension in your hand will make your strokes shaky.' },
	{ text: 'Try rotating the canvas so strokes travel in your most natural direction.' },
	{ text: 'Warm up with a few loose scribbles before starting a focused session.' },
	{ text: 'Lock your wrist and elbow for long strokes. Short strokes can use wrist motion.' },
	{ text: 'Consistency matters more than perfection — aim for evenly-paced, repeatable strokes.' },
];

const EXERCISE_TIPS: Tip[] = [
	// Lines
	{ text: 'For straight lines, plant your pen at the start, look at the endpoint, and draw in one swift motion.', exercises: ['line'] },
	{ text: 'Superimpose your line directly on top of the guide — the closer, the better your accuracy.', exercises: ['line'] },
	{ text: 'Vary your arm motion: horizontal lines use shoulder rotation, vertical lines use elbow extension.', exercises: ['line'] },
	// Circles & ellipses
	{ text: 'Draw circles in one continuous motion. Lift off where you started — don\'t overshoot the loop.', exercises: ['circle'] },
	{ text: 'Start with a ghost circle in the air, then drop your pen in and trace the same path.', exercises: ['circle', 'ellipse'] },
	{ text: 'For ellipses, tilt your hand to match the axis angle before you start drawing.', exercises: ['ellipse'] },
	{ text: 'Focus on keeping the ellipse symmetrical — both halves should mirror each other.', exercises: ['ellipse'] },
	// Curves
	{ text: 'Curves should flow — think of them as a section of a larger circle, not a bent line.', exercises: ['curve'] },
	{ text: 'Match the curvature at the start and end. The tangent direction matters as much as position.', exercises: ['curve'] },
	// Rectangles
	{ text: 'Draw each edge as a separate confident stroke. Don\'t try to round the corners.', exercises: ['rectangle'] },
	{ text: 'Keep opposite edges parallel — focus on the angle of each stroke.', exercises: ['rectangle'] },
	// Perspective
	{ text: 'All receding edges should converge toward the vanishing point. Use it as your visual anchor.', exercises: ['perspective'] },
	{ text: 'Draw the vertical edges truly vertical — they don\'t converge in one-point perspective.', exercises: ['perspective'] },
	{ text: 'Ghost each receding line from the corner toward the vanishing point before committing.', exercises: ['perspective'] },
	// Pressure
	{ text: 'Let the weight of the pen do the work — squeeze less, press less, let gravity help.', exercises: ['constant-pressure', 'taper', 'pressure-control'] },
	{ text: 'For tapers, start heavy and lift gradually — or the reverse. Practice both directions.', exercises: ['taper'] },
	{ text: 'Consistent pressure comes from a relaxed grip. If your hand is tight, your pressure will spike.', exercises: ['constant-pressure'] },
	// Hatching
	{ text: 'Keep each hatch stroke the same length and angle — consistency matters more than speed.', exercises: ['hatching'] },
	{ text: 'Space your hatching evenly. Imagine invisible guide rails between each line.', exercises: ['hatching'] },
	// S-Curves
	{ text: 'An S-curve has an inflection point — feel the direction change and flow through it smoothly.', exercises: ['s-curve'] },
	{ text: 'Ghost the full S shape before committing. Your arm should know the path before the pen touches down.', exercises: ['s-curve'] },
	// Converging lines
	{ text: 'Keep your eye on the vanishing point — every line should aim toward it.', exercises: ['converging'] },
	{ text: 'Start each stroke at the edge and draw inward. The VP is your target.', exercises: ['converging'] },
	// Draw-through
	{ text: 'Visualize the hidden corner before you draw. Where would the back edges meet?', exercises: ['draw-through'] },
	{ text: 'Use the visible edges as reference — hidden edges follow the same perspective rules.', exercises: ['draw-through'] },
	// Mirror
	{ text: 'Focus on matching distances from the axis. Each point on your stroke should be the same distance away.', exercises: ['mirror'] },
	{ text: 'Scan back and forth between the original and your mirror — check key points as you go.', exercises: ['mirror'] },
	// 2-Point perspective
	{ text: 'In 2-point perspective, only verticals stay vertical. All horizontal edges recede to a VP.', exercises: ['2-point-box'] },
	{ text: 'Left-facing edges go to the left VP, right-facing edges go to the right VP. Never mix them.', exercises: ['2-point-box'] },
];

const PERFORMANCE_TIPS: Tip[] = [
	{ text: 'Your accuracy is dipping — try slowing down slightly and focusing on the guide path.', trigger: { score: 'pathDeviation', below: 55 } },
	{ text: 'Great accuracy! Now try to match it at a faster pace to build muscle memory.', trigger: { score: 'pathDeviation', below: 101 } },
	{ text: 'Your strokes are jerky — focus on a single fluid motion without corrections.', trigger: { score: 'smoothness', below: 55 } },
	{ text: 'Your strokes are uneven — try to maintain a constant speed throughout each stroke.', trigger: { score: 'speedConsistency', below: 50 } },
	{ text: 'Smooth strokes! Keep that even tempo — it\'s a sign of good arm control.', trigger: { score: 'speedConsistency', below: 101 } },
	{ text: 'Your pressure is inconsistent — relax your grip and let the pen rest naturally.', trigger: { score: 'pressureControl', below: 50 } },
	{ text: 'Your endpoints are drifting — aim for the target dots before you start the stroke.', trigger: { score: 'endpointAccuracy', below: 50 } },
	{ text: 'Close the gap — aim to end your stroke exactly where you started.', trigger: { score: 'closureGap', below: 60 } },
];

/**
 * Pick the next tip to show given the current context.
 * Mixes performance-triggered tips (if recent scores are weak) with
 * general / exercise-specific tips on a rotating basis.
 */
export function pickTip(
	exerciseType: string,
	recentScores: StrokeScore[],
	shownIndices: Set<number>,
): { text: string; index: number } {
	const pool = buildPool(exerciseType);

	if (recentScores.length >= 2) {
		const metricAvg = (key: MetricKey): number | null => {
			const vals = recentScores.map(s => s[key]).filter((v): v is number => v != null);
			return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
		};

		const scoreMap: Partial<Record<MetricKey, number | null>> = {
			pathDeviation: metricAvg('pathDeviation'),
			smoothness: metricAvg('smoothness'),
			speedConsistency: metricAvg('speedConsistency'),
			pressureControl: metricAvg('pressureControl'),
			endpointAccuracy: metricAvg('endpointAccuracy'),
			closureGap: metricAvg('closureGap'),
		};

		for (const pt of PERFORMANCE_TIPS) {
			if (!pt.trigger) continue;
			const val = scoreMap[pt.trigger.score];
			if (val == null) continue;
			if (val < pt.trigger.below) {
				// "Great accuracy, now go faster" — only when path accuracy is high but speed consistency is low
				if (pt.trigger.below === 101 && pt.trigger.score === 'pathDeviation') {
					const sc = scoreMap.speedConsistency;
					if ((val) < 75 || (sc != null && sc >= 55)) continue;
				}
				if (pt.trigger.below === 101 && pt.trigger.score === 'speedConsistency') {
					if ((val) < 60) continue;
				}
				const idx = pool.findIndex(t => t.text === pt.text);
				if (idx !== -1 && !shownIndices.has(idx)) {
					return { text: pool[idx].text, index: idx };
				}
			}
		}
	}

	// Fall back to a general/exercise tip we haven't shown yet
	for (let i = 0; i < pool.length; i++) {
		if (!shownIndices.has(i)) {
			return { text: pool[i].text, index: i };
		}
	}

	// All shown — wrap around
	shownIndices.clear();
	return { text: pool[0].text, index: 0 };
}

function buildPool(exerciseType: string): Tip[] {
	const exerciseTips = EXERCISE_TIPS.filter(
		t => !t.exercises || t.exercises.includes(exerciseType),
	);
	const perfTips = PERFORMANCE_TIPS;

	// Interleave: exercise-specific, general, performance
	const pool: Tip[] = [];
	const g = [...GENERAL_TIPS];
	const e = [...exerciseTips];
	const p = [...perfTips];

	while (g.length || e.length || p.length) {
		if (e.length) pool.push(e.shift()!);
		if (g.length) pool.push(g.shift()!);
		if (g.length) pool.push(g.shift()!);
		if (p.length) pool.push(p.shift()!);
	}
	return pool;
}
