export type IssueType = 'accurate' | 'divergent' | 'jittery' | 'pressure_spike' | 'hesitation' | 'pressure_inconsistent' | 'pressure_deviation';

export interface ScoredSegment {
	startIdx: number;
	endIdx: number;
	issue: IssueType;
	severity: number;
}

/** Canonical metric keys — each exercise evaluates a subset. */
export const METRIC_KEYS = [
	'pathDeviation',
	'smoothness',
	'speedConsistency',
	'endpointAccuracy',
	'closureGap',
	'pressureControl',
	'taperQuality',
	'strokeEconomy',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
	pathDeviation: 'Path Accuracy',
	smoothness: 'Smoothness',
	speedConsistency: 'Speed Control',
	endpointAccuracy: 'Endpoint Precision',
	closureGap: 'Closure',
	pressureControl: 'Pressure',
	taperQuality: 'Taper',
	strokeEconomy: 'Economy',
};

export interface StrokeScore {
	pathDeviation: number | null;
	smoothness: number | null;
	speedConsistency: number | null;
	endpointAccuracy: number | null;
	closureGap: number | null;
	pressureControl: number | null;
	taperQuality: number | null;
	strokeEconomy: number | null;
	/** Weighted composite score (the headline number) */
	composite: number;
	segments: ScoredSegment[];
}

export interface RoundResult {
	reference: import('$lib/exercises/types').ReferenceShape;
	strokes: import('$lib/input/stroke').Stroke[];
	strokeScores: StrokeScore[];
	shapeScore: number;
}

export interface ExerciseResult {
	id: string;
	timestamp: number;
	unit: string;
	exerciseType: string;
	mode: string;
	strokeCount: number;
	scores: StrokeScore[];
	aggregateScore: number;
	metricAverages: Partial<Record<MetricKey, number>>;
	consistency: number;
}
