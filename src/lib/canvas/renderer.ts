import type { Stroke } from '$lib/input/stroke';
import type { ExerciseConfig, PerspectiveBoxParams } from '$lib/exercises/types';
import type { ViewTransform } from './transform';
import type { StrokeScore } from '$lib/scoring/types';
import { applyTransform, worldToScreen } from './transform';
import { renderGuides, type GuideVisibility } from './guides';
import { renderHighlights } from './highlights';

export interface FadingLayer {
	config: ExerciseConfig;
	strokes: Stroke[];
	scores: StrokeScore[] | null;
	alpha: number;
}

export interface RenderState {
	exerciseConfig: ExerciseConfig | null;
	strokes: Stroke[];
	currentStroke: Stroke | null;
	transform: ViewTransform;
	guideVisibility: GuideVisibility;
	scores: StrokeScore[] | null;
	fadingLayer?: FadingLayer | null;
	bgColor?: string;
}

export function render(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	state: RenderState
): void {
	const rect = canvas.getBoundingClientRect();
	const w = rect.width;
	const h = rect.height;
	const center = { x: w / 2, y: h / 2 };

	const bg = state.bgColor ?? '#1a1a2e';
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	applyTransform(ctx, state.transform, center);

	// Fading layer (old shape + strokes, fading out)
	if (state.fadingLayer && state.fadingLayer.alpha > 0) {
		const fl = state.fadingLayer;
		ctx.save();
		ctx.globalAlpha = fl.alpha;
		renderGuides(ctx, fl.config, 'full');
		for (let i = 0; i < fl.strokes.length; i++) {
			const score = fl.scores?.[i] ?? null;
			if (score) {
				renderHighlights(ctx, fl.strokes[i], score);
			} else {
				drawStroke(ctx, fl.strokes[i], '#e2e2e2', 2.5);
			}
		}
		ctx.restore();
	}

	// Current guides (new shape, at full alpha)
	if (state.exerciseConfig) {
		renderGuides(ctx, state.exerciseConfig, state.guideVisibility);
	}

	// Current strokes
	for (let i = 0; i < state.strokes.length; i++) {
		const score = state.scores?.[i] ?? null;
		if (score) {
			renderHighlights(ctx, state.strokes[i], score);
		} else {
			drawStroke(ctx, state.strokes[i], state.bgColor === '#ffffff' ? '#222222' : '#e2e2e2', 2.5);
		}
	}

	if (state.currentStroke && state.currentStroke.rawPoints.length > 0) {
		drawStroke(ctx, state.currentStroke, state.bgColor === '#ffffff' ? '#111111' : '#ffffff', 2.5);
	}

	ctx.restore();

	if (state.exerciseConfig && state.guideVisibility !== 'hidden') {
		renderOffscreenIndicator(ctx, state.exerciseConfig, state.transform, w, h, state.bgColor === '#ffffff');
	}
}

function drawStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	color: string,
	lineWidth: number
): void {
	const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
	if (pts.length < 2) return;

	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) {
		ctx.lineTo(pts[i].x, pts[i].y);
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();
}

function getShapeCenter(config: ExerciseConfig): { x: number; y: number } | null {
	if (!config.references.length) return null;
	const params = config.references[0].params;

	if ('givenCorner' in params) {
		const bp = params as PerspectiveBoxParams;
		const pts = [
			bp.givenCorner,
			{ x: bp.givenEdges.horizontal.x2, y: bp.givenEdges.horizontal.y2 },
			{ x: bp.givenEdges.vertical.x2, y: bp.givenEdges.vertical.y2 },
			{ x: bp.givenEdges.depth.x2, y: bp.givenEdges.depth.y2 },
			...bp.expectedEdges.flatMap((e) => [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }])
		];
		return {
			x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
			y: pts.reduce((s, p) => s + p.y, 0) / pts.length
		};
	}
	if ('w' in params && 'cx' in params) {
		return { x: (params as { cx: number; cy: number }).cx, y: (params as { cx: number; cy: number }).cy };
	}
	if ('cx' in params && 'cy' in params) {
		return { x: (params as { cx: number; cy: number }).cx, y: (params as { cx: number; cy: number }).cy };
	}
	if ('x1' in params && 'x2' in params) {
		const lp = params as { x1: number; y1: number; x2: number; y2: number };
		return { x: (lp.x1 + lp.x2) / 2, y: (lp.y1 + lp.y2) / 2 };
	}
	return null;
}

function renderOffscreenIndicator(
	ctx: CanvasRenderingContext2D,
	config: ExerciseConfig,
	transform: ViewTransform,
	viewW: number,
	viewH: number,
	isLight: boolean
): void {
	const wc = getShapeCenter(config);
	if (!wc) return;

	const center = { x: viewW / 2, y: viewH / 2 };
	const screen = worldToScreen(wc, transform, center);

	const pad = 50;
	if (screen.x >= pad && screen.x <= viewW - pad && screen.y >= pad && screen.y <= viewH - pad) {
		return;
	}

	const dx = screen.x - center.x;
	const dy = screen.y - center.y;
	if (dx === 0 && dy === 0) return;

	// Ray from viewport center toward shape; intersect with viewport edges
	let t = Infinity;
	if (dx > 0) t = Math.min(t, (viewW - pad - center.x) / dx);
	else if (dx < 0) t = Math.min(t, (pad - center.x) / dx);
	if (dy > 0) t = Math.min(t, (viewH - pad - center.y) / dy);
	else if (dy < 0) t = Math.min(t, (pad - center.y) / dy);

	const ax = center.x + dx * t;
	const ay = center.y + dy * t;
	const angle = Math.atan2(dy, dx);

	const sz = 14;
	ctx.save();
	ctx.translate(ax, ay);
	ctx.rotate(angle);

	ctx.beginPath();
	ctx.moveTo(sz, 0);
	ctx.lineTo(-sz * 0.5, -sz * 0.7);
	ctx.lineTo(-sz * 0.2, 0);
	ctx.lineTo(-sz * 0.5, sz * 0.7);
	ctx.closePath();

	ctx.fillStyle = isLight ? 'rgba(76, 110, 245, 0.75)' : 'rgba(100, 160, 255, 0.75)';
	ctx.fill();

	// Pulsing ring behind the arrow for visibility
	ctx.beginPath();
	ctx.arc(0, 0, sz + 6, 0, Math.PI * 2);
	ctx.strokeStyle = isLight ? 'rgba(76, 110, 245, 0.3)' : 'rgba(100, 160, 255, 0.3)';
	ctx.lineWidth = 2;
	ctx.stroke();

	ctx.restore();
}
