# BoxMaster — Drawing Practice Web App

A web application inspired by [drawabox.com](https://drawabox.com) that helps users
improve drawing technique through guided exercises, real-time scoring, and
progress tracking. Built with SvelteKit 2 / Svelte 5, fully client-side with
offline persistence.

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm check        # svelte-check + TypeScript
pnpm build        # production build (adapter-auto)
```

## Exercises

Five built-in exercises across two units:

**Basic Shapes** — lines, circles, ellipses, rectangles
**Perspective** — 1-point perspective boxes

Each exercise supports up to three modes: guided (trace the shape),
challenge (hints only), and free (no guides). Sessions show one shape at
a time; after a configurable count (or timer), results are displayed with
per-shape thumbnails and a score breakdown.

## Scoring

Strokes are evaluated on accuracy (distance from reference), flow (speed and
velocity consistency), and confidence (pressure consistency, when using a
pen/stylus). Problem areas are highlighted directly on the stroke.

## Progress

Completed sessions are saved to IndexedDB. The progress page shows per-exercise
trends, best scores, and recent averages.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design documentation:
plugin system, canvas pipeline, scoring details, persistence, and how to add
new exercises.
