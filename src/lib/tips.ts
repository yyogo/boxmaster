import type { StrokeScore } from '$lib/scoring/types';

export interface Tip {
	text: string;
	/** Which exercise types this applies to (empty = all) */
	exercises?: string[];
	/** If set, only show when the named score is below this threshold */
	trigger?: { score: keyof Pick<StrokeScore, 'accuracy' | 'flow' | 'speed' | 'confidence'>; below: number };
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
];

const PERFORMANCE_TIPS: Tip[] = [
	{ text: 'Your accuracy is dipping — try slowing down slightly and focusing on the guide path.', trigger: { score: 'accuracy', below: 55 } },
	{ text: 'Great accuracy! Now try to match it at a faster pace to build muscle memory.', trigger: { score: 'accuracy', below: 101 } }, // always eligible, filtered by high accuracy + low speed below
	{ text: 'Your strokes are uneven — try to maintain a constant speed throughout each stroke.', trigger: { score: 'flow', below: 50 } },
	{ text: 'Smooth strokes! Keep that even tempo — it\'s a sign of good arm control.', trigger: { score: 'flow', below: 101 } },
	{ text: 'You\'re drawing quite slowly — trust your arm and commit to the stroke with more speed.', trigger: { score: 'speed', below: 45 } },
	{ text: 'Your speed is good. Focus on keeping it steady from start to finish.', trigger: { score: 'speed', below: 101 } },
	{ text: 'Your pressure is inconsistent — relax your grip and let the pen rest naturally.', trigger: { score: 'confidence', below: 50 } },
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

	// Try a performance tip first if we have recent scores
	if (recentScores.length >= 2) {
		const avg = (key: keyof Pick<StrokeScore, 'accuracy' | 'flow' | 'speed'>) =>
			Math.round(recentScores.reduce((s, sc) => s + sc[key], 0) / recentScores.length);

		const avgAcc = avg('accuracy');
		const avgFlow = avg('flow');
		const avgSpeed = avg('speed');

		const confScores = recentScores.map(s => s.confidence).filter((c): c is number => c != null);
		const avgConf = confScores.length > 0
			? Math.round(confScores.reduce((a, b) => a + b, 0) / confScores.length)
			: null;

		const scoreMap: Record<string, number | null> = { accuracy: avgAcc, flow: avgFlow, speed: avgSpeed, confidence: avgConf };

		// Find applicable performance tips (prioritise the weakest score)
		for (const pt of PERFORMANCE_TIPS) {
			if (!pt.trigger) continue;
			const val = scoreMap[pt.trigger.score];
			if (val == null) continue;
			if (val < pt.trigger.below) {
				// Special case: "great accuracy, now go faster" only when accuracy ≥ 75 and speed < 55
				if (pt.trigger.below === 101 && pt.trigger.score === 'accuracy') {
					if (avgAcc < 75 || avgSpeed >= 55) continue;
				}
				if (pt.trigger.below === 101 && pt.trigger.score === 'flow') {
					if (avgFlow < 70) continue;
				}
				if (pt.trigger.below === 101 && pt.trigger.score === 'speed') {
					if (avgSpeed < 60) continue;
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
