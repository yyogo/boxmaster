import type { StrokePoint, Stroke } from "$lib/input/stroke";
import type { ExerciseConfig, ExerciseMode, ReferenceShape } from "./types";
import type { StrokeScore, ScoredSegment, MetricKey } from "$lib/scoring/types";
import type { GuideVisibility } from "$lib/canvas/guides";
import {
  scoreSmoothness,
  scoreSpeedConsistency,
  scoreEndpointAccuracy,
  scoreClosureGap,
  scorePressureControl,
  scoreTaperQuality,
  scoreStrokeEconomy,
  detectHesitations,
  detectJitter,
  detectPressureSpikes,
} from "$lib/scoring/metrics";

/** Maps a screen-space point to world-space. Identity when no pan/rotate. */
export type CoordTransform = (x: number, y: number) => { x: number; y: number };

export interface ExercisePlugin {
  id: string;
  unit: string;
  label: string;
  description: string;
  icon: string;
  availableModes: ExerciseMode[];
  requiredStrokes: number;
  defaultCount: number;
  requiresPressure?: boolean;

  generate(
    mode: ExerciseMode,
    canvasW: number,
    canvasH: number,
    toWorld?: CoordTransform,
  ): ExerciseConfig;
  createSession?(canvasW: number, canvasH: number): unknown;
  generateFromSession?(
    session: unknown,
    mode: ExerciseMode,
    canvasW: number,
    canvasH: number,
    toWorld?: CoordTransform,
  ): ExerciseConfig;

  renderGuide(
    ctx: CanvasRenderingContext2D,
    params: Record<string, unknown>,
    visibility: GuideVisibility,
  ): void;
  renderScaffold?(
    ctx: CanvasRenderingContext2D,
    params: Record<string, unknown>,
  ): void;

  renderStroke?(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    color: string,
    baseWidth: number,
  ): void;

  renderScoredStroke?(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    score: StrokeScore,
  ): void;

  scoreStroke(
    points: StrokePoint[],
    reference: ReferenceShape,
    strokeIndex: number,
    mode: ExerciseMode,
  ): StrokeScore;
  computeShapeScore?(strokeScores: StrokeScore[]): number;

  getCenter(params: Record<string, unknown>): { x: number; y: number };
  getBounds(params: Record<string, unknown>): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  isStrokeRelevant?(
    stroke: Stroke,
    reference: ReferenceShape,
    canvasW: number,
    canvasH: number,
    mode: ExerciseMode,
  ): boolean;
}

export type ExercisePluginConfig = Omit<
  ExercisePlugin,
  | "computeShapeScore"
  | "isStrokeRelevant"
  | "createSession"
  | "generateFromSession"
  | "renderScaffold"
  | "renderStroke"
  | "renderScoredStroke"
> &
  Partial<
    Pick<
      ExercisePlugin,
      | "computeShapeScore"
      | "isStrokeRelevant"
      | "createSession"
      | "generateFromSession"
      | "renderScaffold"
      | "renderStroke"
      | "renderScoredStroke"
    >
  >;

// --- Composite scoring ---

const METRIC_WEIGHTS: Record<MetricKey, number> = {
  pathDeviation: 0.35,
  smoothness: 0.15,
  speedConsistency: 0.15,
  endpointAccuracy: 0.15,
  closureGap: 0.15,
  pressureControl: 0.20,
  taperQuality: 0.20,
  strokeEconomy: 0.10,
};

export function compositeScore(score: StrokeScore): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const key of Object.keys(METRIC_WEIGHTS) as MetricKey[]) {
    const val = score[key];
    if (val != null) {
      const w = METRIC_WEIGHTS[key];
      weightSum += w;
      valueSum += val * w;
    }
  }
  return weightSum > 0 ? Math.round(valueSum / weightSum) : 0;
}

export function defaultShapeScore(strokeScores: StrokeScore[]): number {
  if (strokeScores.length === 0) return 0;
  return Math.round(
    strokeScores.reduce((s, sc) => s + sc.composite, 0) / strokeScores.length,
  );
}

// --- buildMetricScore ---

export interface MetricConfig {
  pathDeviation?: number | null;
  smoothness?: boolean;
  speedConsistency?: boolean;
  endpointAccuracy?: { start: { x: number; y: number }; end: { x: number; y: number } };
  closureGap?: { perimeter: number };
  pressureControl?: boolean | { target: number[] };
  taperQuality?: { startPressure: number; endPressure: number };
  strokeEconomy?: { actual: number; expected: number };
  extraSegments?: ScoredSegment[];
}

export function buildMetricScore(
  points: StrokePoint[],
  config: MetricConfig,
): StrokeScore {
  const score: StrokeScore = {
    pathDeviation: config.pathDeviation ?? null,
    smoothness: null,
    speedConsistency: null,
    endpointAccuracy: null,
    closureGap: null,
    pressureControl: null,
    taperQuality: null,
    strokeEconomy: null,
    composite: 0,
    segments: [],
  };

  if (config.smoothness) {
    score.smoothness = scoreSmoothness(points);
  }
  if (config.speedConsistency) {
    score.speedConsistency = scoreSpeedConsistency(points);
  }
  if (config.endpointAccuracy) {
    score.endpointAccuracy = scoreEndpointAccuracy(points, config.endpointAccuracy);
  }
  if (config.closureGap) {
    score.closureGap = scoreClosureGap(points, config.closureGap.perimeter);
  }
  if (config.pressureControl) {
    const target = typeof config.pressureControl === 'object' ? config.pressureControl.target : undefined;
    score.pressureControl = scorePressureControl(points, target);
  }
  if (config.taperQuality) {
    score.taperQuality = scoreTaperQuality(points, config.taperQuality);
  }
  if (config.strokeEconomy) {
    score.strokeEconomy = scoreStrokeEconomy(config.strokeEconomy.actual, config.strokeEconomy.expected);
  }

  // Collect segment-level diagnostics
  const segments: ScoredSegment[] = [...(config.extraSegments ?? [])];

  for (const h of detectHesitations(points)) {
    segments.push({ startIdx: h.start, endIdx: h.end, issue: "hesitation", severity: 0.7 });
  }
  for (const j of detectJitter(points)) {
    segments.push({ startIdx: j.start, endIdx: j.end, issue: "jittery", severity: 0.6 });
  }
  if (config.pressureControl || config.taperQuality) {
    for (const s of detectPressureSpikes(points)) {
      segments.push({ startIdx: s.start, endIdx: s.end, issue: "pressure_spike", severity: 0.5 });
    }
  }

  score.segments = segments;
  score.composite = compositeScore(score);
  return score;
}

// --- Helpers shared by multiple plugins ---

export function strokeChord(pts: { x: number; y: number }[]): number {
  if (pts.length < 2) return 0;
  const s = pts[0],
    e = pts[pts.length - 1];
  return Math.sqrt((e.x - s.x) ** 2 + (e.y - s.y) ** 2);
}

export function strokeArcLen(pts: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.sqrt(
      (pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2,
    );
  }
  return len;
}

export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

export function getStrokePoints(stroke: Stroke): StrokePoint[] {
  return stroke.smoothedPoints.length > 0
    ? stroke.smoothedPoints
    : stroke.rawPoints;
}

export function defineExercise(config: ExercisePluginConfig): ExercisePlugin {
  return { ...config };
}
