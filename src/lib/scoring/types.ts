export type IssueType = 'accurate' | 'divergent' | 'jittery' | 'pressure_spike' | 'hesitation' | 'pressure_inconsistent' | 'pressure_deviation';

export interface ScoredSegment {
	startIdx: number;
	endIdx: number;
	issue: IssueType;
	severity: number;
}

export interface StrokeScore {
	accuracy: number;
	flow: number;
	confidence: number | null;
	segments: ScoredSegment[];
	metrics?: Record<string, number>;
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
	consistency: number;
}
