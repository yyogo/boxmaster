# BoxMaster — Architecture

## Overview

```
┌──────────────────────────────────────────────────────────┐
│  Routes (+page.svelte)                                   │
│  ┌──────────┐  ┌──────────────────────┐  ┌───────────┐  │
│  │  Home /  │  │  /exercise/[type]    │  │ /progress  │  │
│  │  Picker  │  │  Session orchestrator│  │ Dashboard  │  │
│  └──────────┘  └──────────┬───────────┘  └─────┬─────┘  │
│                           │                    │         │
│  ┌────────────────────────┼────────────────────┼──────┐  │
│  │  Components            │                    │      │  │
│  │  Canvas ───────────────┤    ResultsGrid     │      │  │
│  │  ExercisePicker        │    ProgressChart ──┘      │  │
│  └────────┬───────────────┼───────────────────────────┘  │
│           │               │                              │
├───────────┼───────────────┼──────────────────────────────┤
│  Library  │               │                              │
│  ┌────────┴────┐  ┌──────┴──────┐  ┌─────────────────┐  │
│  │   canvas/   │  │  exercises/ │  │    scoring/      │  │
│  │  renderer   │  │  plugin API │  │  accuracy, flow  │  │
│  │  transform  │  │  registry   │  │  confidence      │  │
│  │  guides     │  │  utils      │  │  consistency     │  │
│  │  highlights │  │  9 built-in │  │  geometry utils   │  │
│  └─────────────┘  │  plugins    │  └─────────────────┘  │
│  ┌─────────────┐  └─────────────┘                       │
│  │   input/    │  ┌─────────────────────────────────┐    │
│  │  pointer    │  │           storage/               │    │
│  │  stroke     │  │  db.ts    (IndexedDB / idb)      │    │
│  └─────────────┘  │  prefs.ts (localStorage)         │    │
│                   │  progress.ts (aggregation)       │    │
│                   └─────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Directory layout

```
src/
├── routes/
│   ├── +layout.svelte            App shell (nav, global styles)
│   ├── +page.svelte              Home — exercise picker grid
│   ├── exercise/[type]/
│   │   └── +page.svelte          Session orchestrator (core game loop)
│   └── progress/
│       └── +page.svelte          Progress dashboard with charts
│
├── lib/
│   ├── canvas/
│   │   ├── renderer.ts           rAF draw loop: background, guides, strokes, fading
│   │   ├── transform.ts          ViewTransform: pan, rotate, screen↔world mapping
│   │   ├── guides.ts             Delegates guide/scaffold rendering to plugins
│   │   └── highlights.ts         Colors stroke segments by scoring issue type
│   │
│   ├── components/
│   │   ├── Canvas.svelte         Full-viewport drawing surface with pointer pipeline
│   │   ├── ExercisePicker.svelte Exercise grid grouped by unit
│   │   ├── ResultsGrid.svelte    Post-session results: thumbnails, breakdown, actions
│   │   └── ProgressChart.svelte  SVG sparkline of aggregate scores over time
│   │
│   ├── exercises/
│   │   ├── plugin.ts             ExercisePlugin interface, helpers, CoordTransform
│   │   ├── registry.ts           In-memory plugin map: register, get, list, group
│   │   ├── types.ts              Shared types: ExerciseMode, shape params, ExerciseConfig
│   │   ├── utils.ts              Shared helpers: drawDot, randomLine, scoreLineAccuracy, etc.
│   │   ├── init.ts               Side-effect imports to register all built-in plugins
│   │   ├── placement.ts          Non-overlapping random layout utility
│   │   ├── lines.ts              Line exercise plugin
│   │   ├── circles.ts            Circle exercise plugin
│   │   ├── ellipses.ts           Ellipse exercise plugin
│   │   ├── rectangles.ts         Rectangle exercise plugin
│   │   ├── perspective.ts        1-point perspective box exercise plugin
│   │   ├── curves.ts             Bezier curve exercise plugin
│   │   ├── constant-pressure.ts  Constant pressure line exercise plugin
│   │   ├── taper.ts              Tapered pressure line exercise plugin
│   │   └── pressure-control.ts   Combined curve + pressure exercise plugin
│   │
│   ├── input/
│   │   ├── pointer.ts            Pointer state machine: draw / pan / rotate gestures
│   │   └── stroke.ts             Stroke model, point capture, moving-window smoothing
│   │
│   ├── scoring/
│   │   ├── geometry.ts           Point-to-segment/bezier distance, rect edge/corner helpers
│   │   ├── metrics.ts            Smoothness, speed, endpoints, pressure, hesitation/jitter, etc.
│   │   ├── consistency.ts        Cross-session score consistency (CV-based)
│   │   └── types.ts              StrokeScore, ScoredSegment, RoundResult, ExerciseResult
│   │
│   └── storage/
│       ├── db.ts                 IndexedDB via idb: save/query ExerciseResult
│       ├── prefs.ts              localStorage: theme, mode, counts, timer, pen-only
│       └── progress.ts           Aggregates DB results into ProgressSummary objects
```

## Exercise session lifecycle

```
  ┌─ draw strokes ──┐
  │                  ▼
  │   stroke count met?
  │        │ yes          no │
  │        ▼                 └──┐
  │   score shape               │
  │   push RoundResult          │
  │        │                    │
  │        ▼                    │
  │   roundIndex < total?       │
  │     yes │      no           │
  │         ▼       ▼           │
  │    start fade   finish ─────┤
  │    spawn next   save to DB  │
  │         │       show results│
  └─────────┘                   │
                                │
         (or timer expires) ────┘
```

The session is driven by a phase state machine: `drawing` → `fading` → back to
`drawing`, or `drawing` → `complete`. Each round produces a `RoundResult`
(reference shape, user strokes, per-stroke scores, composite shape score).

## Plugin system

Every exercise is an `ExercisePlugin` registered at import time. Adding a new
exercise requires implementing the interface and adding a side-effect import
in `init.ts`.

```typescript
interface ExercisePlugin {
	// Identity
	id: string; // URL slug, e.g. "line"
	unit: string; // grouping, e.g. "basic-shapes"
	label: string; // display name
	icon: string; // emoji
	description: string;
	availableModes: ExerciseMode[];
	requiredStrokes: number; // strokes needed per shape
	defaultCount: number; // shapes per session
	requiresPressure?: boolean; // marks exercises needing a pressure-sensitive pen

	// Generation
	generate(mode, canvasW, canvasH, toWorld?): ExerciseConfig;
	createSession?(canvasW, canvasH): unknown;
	generateFromSession?(session, mode, canvasW, canvasH, toWorld?): ExerciseConfig;

	// Rendering
	renderGuide(ctx, params, visibility): void;
	renderScaffold?(ctx, params): void;
	renderStroke?(ctx, stroke, color, baseWidth): void; // custom stroke rendering
	renderScoredStroke?(ctx, stroke, score): void; // custom scored highlight rendering

	// Scoring
	scoreStroke(points, reference, strokeIndex, mode): StrokeScore;
	computeShapeScore?(strokeScores): number;

	// Geometry
	getCenter(params): { x; y };
	getBounds(params): { minX; minY; maxX; maxY };

	// Stroke filtering
	isStrokeRelevant?(stroke, reference, canvasW, canvasH, mode): boolean;
}
```

Built-in plugins: `lines`, `circles`, `ellipses`, `rectangles`,
`perspective` (1-point box), `curves`, `constant-pressure`, `taper`,
`pressure-control`.

### Shared utilities (`utils.ts`)

Common helpers extracted from exercise plugins to avoid duplication:

- `GUIDE_COLOR`, `HINT_COLOR` — standard guide rendering colors
- `drawDot` — filled circle at a point
- `randomLine(canvasW, canvasH, diagonal, margin, lenRange?)` — random line within bounds
- `randomCurve(canvasW, canvasH, diagonal, margin)` — random cubic bezier curve
- `scoreLineAccuracy(points, line)` — average point-to-segment distance score
- `highlightLineDivergent(points, line)` — windowed geometric divergence detection
- `drawRibbon(ctx, x1, y1, x2, y2, width, color)` — uniform-width filled ribbon
- `drawTaperedRibbon(ctx, pathPoints, startWidth, endWidth, color)` — polyline-path tapered ribbon
- `lineToPathPoints(x1, y1, x2, y2, n?)` — subdivides a line into sample points
- `projectOntoLine(p, line)` — projects a point onto a line segment (returns t ∈ [0,1])
- `pressureShapeScore(strokeScores)` — pressure-weighted shape scoring (25/15/60)

### Adding a new exercise

1. Create `src/lib/exercises/myexercise.ts`
2. Implement the `ExercisePlugin` interface using `defineExercise()`
3. Call `registerExercise()` at module scope
4. Add a side-effect import in `src/lib/exercises/init.ts`

The exercise automatically appears in the picker, gets its own route at
`/exercise/myexercise`, and inherits scoring, persistence, and all UI
features.

### Plugin-level rendering

Plugins can optionally provide `renderStroke` and `renderScoredStroke` to
control how their strokes are drawn. The renderer dispatches through the
plugin first, falling back to the default `drawStroke` / `renderHighlights`.
This decouples the renderer from exercise-specific semantics (e.g., pressure-
sensitive width rendering lives in the pressure plugins, not in `renderer.ts`).

The renderer exports `drawStroke` and `drawPressureStroke` so plugins can
reuse the built-in rendering logic from their custom methods.

### Session-level state

Plugins can optionally define `createSession` and `generateFromSession` to
maintain state across rounds within a single exercise session. The perspective
plugin uses this to share a single horizon line and vanishing point across all
boxes in a session.

### Pressure input gating

Plugins with `requiresPressure: true` trigger two UI behaviors:

- **ExercisePicker**: a pink "pen required" badge on the exercise card
- **Exercise page**: a floating warning banner when no pen has been detected yet

## Canvas and input pipeline

`Canvas.svelte` owns the HTML `<canvas>` element. It runs a `requestAnimationFrame`
render loop (`renderer.ts`) and feeds pointer events into `pointer.ts`.

### Pointer state machine

Classifies input into three gestures:

- **Draw**: single pointer (mouse, pen, or touch when pen-only is off)
  → creates `Stroke` objects via `stroke.ts`
- **Pan**: two-finger drag, or Shift+drag
- **Rotate**: Ctrl/Cmd+drag

Pen detection: when a `pointerType === 'pen'` event arrives, the component
signals the parent, which can enable pen-only mode (single-finger touch becomes
pan instead of drawing).

### View transform

Pan + rotation only (no zoom by design — zoom would defeat the purpose of the
exercises). `transform.ts` provides `screenToWorld` / `worldToScreen`
conversions. Plugins can receive an optional `CoordTransform` to generate
shapes within the current viewport.

Pan deltas are inverse-rotated by the current view rotation so dragging
always moves in the expected screen direction regardless of canvas angle.

## Scoring

Each stroke is scored on three axes:

| Metric         | Source                                                           | Weight |
| -------------- | ---------------------------------------------------------------- | ------ |
| **Accuracy**   | Plugin-specific: point-to-reference-shape distance               | 50%    |
| **Flow**       | `metrics.ts`: smoothness + speed consistency (CV-based)          | 30%    |
| **Confidence** | `metrics.ts`: pressure control / taper (pen exercises, nullable) | 20%    |

### Extensible metrics

`StrokeScore` supports an optional `metrics?: Record<string, number>` map for
plugin-specific scoring dimensions. Pressure exercises use
`metrics.pressureMatch` to store their custom pressure-match score separately
from the built-in `confidence` field:

- **Constant pressure**: `pressureMatch` = pressure standard deviation score
- **Taper / Pressure control**: `pressureMatch` = average pressure-vs-expected deviation score

`ResultsGrid` automatically displays `pressureMatch` as a "Pressure Control"
breakdown bar when present. Plugins can add arbitrary metrics to this map —
future exercises can introduce new scoring dimensions without changing the
core `StrokeScore` interface.

Pressure exercises use custom `computeShapeScore` weights (accuracy 25%,
flow 15%, `metrics.pressureMatch` 60%) via the shared `pressureShapeScore`
helper.

### Issue detection

Colored segment overlays on the stroke highlight problems:

- `divergent` — stroke deviates from reference
- `jittery` — excessive direction changes in a sliding window
- `hesitation` — near-zero velocity for > 80 ms
- `pressure_spike` — sudden pressure deviation
- `pressure_inconsistent` — pressure varies when constant is expected (strokes unit)
- `pressure_deviation` — pressure deviates from expected taper curve (strokes unit)

### Cross-session consistency

Computed from the coefficient of variation of the last N aggregate scores.
Lower variance = higher consistency score.

### Stroke relevance / outlier detection

Each plugin defines `isStrokeRelevant` to filter stray marks. Passing
criteria vary per shape but generally check:

- Start point proximity to reference endpoints
- Angular tolerance vs. reference direction
- Minimum stroke length
- Mode-specific rules (free mode is more lenient)

## Exercise modes

| Mode          | Guides shown                            | Behavior                                          |
| ------------- | --------------------------------------- | ------------------------------------------------- |
| **Guided**    | Full reference shape                    | User traces the displayed shape                   |
| **Challenge** | Hints only (endpoints, center, corners) | Dotted outlines, key points visible               |
| **Free**      | None                                    | User draws; scored against nearest matching shape |

Not all exercises support all modes (e.g., perspective only supports guided
and challenge).

## Persistence

| Store            | Engine            | Contents                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------ |
| `ExerciseResult` | IndexedDB (`idb`) | Per-session: scores, mode, timestamps. Indexed by type, unit, timestamp. |
| `UserPrefs`      | `localStorage`    | Theme, shape count, timer settings, per-exercise mode, pen-only.         |

**Svelte 5 caveat**: reactive state must be snapshot via `$state.snapshot()`
before passing to IndexedDB — the structured clone algorithm cannot serialize
Proxy objects.

## Perspective exercise specifics

The 1-point perspective box plugin uses session-level state (shared horizon +
vanishing point across all boxes in a session). Generation uses rejection
sampling to ensure valid geometry:

- Minimum edge length (4% of min canvas dimension)
- Minimum angle at every vertex (30°, prevents degenerate depth lines)
- Minimum horizontal distance from VP for all front-face corners
- Minimum vertical distance from horizon for given corner (15% of canvas height)

A deterministic fallback places the box on the opposite side of the canvas
from the VP if random sampling exhausts its budget.

## Strokes exercises

The `strokes` unit contains four exercises focused on stroke quality and
pressure control:

| Plugin            | ID                  | Pressure | Description                                                 |
| ----------------- | ------------------- | -------- | ----------------------------------------------------------- |
| Curves            | `curve`             | No       | Draw bezier curves; scored on geometric accuracy            |
| Constant Pressure | `constant-pressure` | Yes      | Trace a line with even, constant pressure                   |
| Taper             | `taper`             | Yes      | Trace a line with smoothly increasing/decreasing pressure   |
| Pressure Control  | `pressure-control`  | Yes      | Combined: curves or lines with constant or tapered pressure |

### Pressure-sensitive rendering

Pressure exercises provide custom `renderStroke` and `renderScoredStroke`
methods that draw each consecutive point pair as a separate line segment with
`lineWidth` proportional to the average pressure of the two endpoints. The
renderer dispatches through these plugin methods, falling back to the default
uniform-width rendering for non-pressure exercises. This applies to live
drawing, completed strokes, fading layers, and scored highlights.

### Pressure scoring

Pressure exercises store their custom pressure-match score in
`metrics.pressureMatch` and use `pressureShapeScore` with weights
(accuracy 25%, flow 15%, pressureMatch 60%) compared to the default
(accuracy 50%, flow 30%, confidence 20%).

- **Constant pressure**: scores by pressure standard deviation (low = good)
- **Taper**: scores by average absolute difference between actual pressure
  and expected pressure at each point's projected position along the reference
- **Pressure control**: combines both approaches depending on the generated
  variation (constant vs tapered, line vs curve)

### Bezier curve geometry

`geometry.ts` provides `sampleBezier`, `pointToBezierDist`, and
`bezierArcLen`. All use polyline sampling (N=100 by default) of a cubic
bezier rather than exact analytical solutions.

## Tech stack

- **SvelteKit 2** with **Svelte 5** (runes mode: `$state`, `$derived`, `$effect`)
- **TypeScript** (strict mode)
- **Vite 7** for dev/build
- **idb** for IndexedDB wrapper
- **Canvas 2D API** for all rendering
- **Pointer Events API** for unified mouse/touch/pen input
- No external UI framework — minimal custom CSS
