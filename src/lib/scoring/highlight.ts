import type { StrokePoint } from '$lib/input/stroke';
import type { ReferenceShape } from '$lib/exercises/types';
import type { ScoredSegment, StrokeScore } from './types';
import { scoreAccuracy, pointToSegmentDist } from './accuracy';
import { scoreFlow, detectHesitations, detectJitter } from './flow';
import { scoreConfidence, detectPressureSpikes } from './confidence';

export function scoreStroke(
	points: StrokePoint[],
	reference: ReferenceShape | null,
	strokeIndex: number
): StrokeScore {
	const segments: ScoredSegment[] = [];

	const accuracy = reference ? scoreAccuracy(points, reference, strokeIndex) : 50;
	const flow = scoreFlow(points);
	const confidence = scoreConfidence(points);

	// Detect issues and create segments
	if (reference && reference.type === 'line') {
		const lineParams = reference.params as import('$lib/exercises/types').LineParams;
		highlightDivergentRegions(points, lineParams, segments);
	}

	const hesitations = detectHesitations(points);
	for (const h of hesitations) {
		segments.push({
			startIdx: h.start,
			endIdx: h.end,
			issue: 'hesitation',
			severity: 0.7
		});
	}

	const jitter = detectJitter(points);
	for (const j of jitter) {
		segments.push({
			startIdx: j.start,
			endIdx: j.end,
			issue: 'jittery',
			severity: 0.6
		});
	}

	const spikes = detectPressureSpikes(points);
	for (const s of spikes) {
		segments.push({
			startIdx: s.start,
			endIdx: s.end,
			issue: 'pressure_spike',
			severity: 0.5
		});
	}

	return { accuracy, flow, confidence, segments };
}

function highlightDivergentRegions(
	points: StrokePoint[],
	line: import('$lib/exercises/types').LineParams,
	segments: ScoredSegment[]
): void {
	const windowSize = 15;
	const threshold = 15; // pixels

	for (let i = 0; i <= points.length - windowSize; i += Math.floor(windowSize / 2)) {
		let totalDist = 0;
		const end = Math.min(i + windowSize, points.length);
		for (let j = i; j < end; j++) {
			totalDist += pointToSegmentDist(points[j].x, points[j].y, line);
		}
		const avgDist = totalDist / (end - i);

		if (avgDist > threshold) {
			const severity = Math.min(1, avgDist / 50);
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last.issue === 'divergent' && last.endIdx >= i - 2) {
					last.endIdx = end - 1;
					last.severity = Math.max(last.severity, severity);
					continue;
				}
			}
			segments.push({
				startIdx: i,
				endIdx: end - 1,
				issue: 'divergent',
				severity
			});
		}
	}
}
