import type { StrokePoint, Stroke } from "$lib/input/stroke";
import type { ExerciseConfig, ExerciseMode, ReferenceShape } from "./types";
import type { StrokeScore, ScoredSegment } from "$lib/scoring/types";
import type { GuideVisibility } from "$lib/canvas/guides";
import { scoreFlow, detectHesitations, detectJitter } from "$lib/scoring/flow";
import { scoreConfidence, detectPressureSpikes } from "$lib/scoring/confidence";

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
> &
  Partial<
    Pick<
      ExercisePlugin,
      | "computeShapeScore"
      | "isStrokeRelevant"
      | "createSession"
      | "generateFromSession"
      | "renderScaffold"
    >
  >;

export function defaultShapeScore(strokeScores: StrokeScore[]): number {
  if (strokeScores.length === 0) return 0;
  return Math.round(
    strokeScores.reduce(
      (s, sc) =>
        s +
        (sc.accuracy * 0.5 + sc.flow * 0.3 + (sc.confidence ?? sc.flow) * 0.2),
      0,
    ) / strokeScores.length,
  );
}

/** Helpers shared by multiple plugins' isStrokeRelevant */

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

export function buildStrokeScore(
  accuracy: number,
  points: StrokePoint[],
  extraSegments: ScoredSegment[] = [],
): StrokeScore {
  const flow = scoreFlow(points);
  const confidence = scoreConfidence(points);

  const segments: ScoredSegment[] = [...extraSegments];

  for (const h of detectHesitations(points)) {
    segments.push({
      startIdx: h.start,
      endIdx: h.end,
      issue: "hesitation",
      severity: 0.7,
    });
  }
  for (const j of detectJitter(points)) {
    segments.push({
      startIdx: j.start,
      endIdx: j.end,
      issue: "jittery",
      severity: 0.6,
    });
  }
  for (const s of detectPressureSpikes(points)) {
    segments.push({
      startIdx: s.start,
      endIdx: s.end,
      issue: "pressure_spike",
      severity: 0.5,
    });
  }

  return { accuracy, flow, confidence, segments };
}

export function defineExercise(config: ExercisePluginConfig): ExercisePlugin {
  return { ...config };
}
