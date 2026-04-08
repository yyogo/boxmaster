import type { Stroke } from '$lib/input/stroke';
import type { ExerciseConfig } from '$lib/exercises/types';
import type { ViewTransform } from './transform';
import type { StrokeScore } from '$lib/scoring/types';
import { applyTransform, worldToScreen } from './transform';
import { renderGuides, type GuideVisibility } from './guides';
import { renderHighlights } from './highlights';
import { getPlugin, tryGetPlugin } from '$lib/exercises/registry';
import { renderHatchFillProgress, type HatchParams } from '$lib/exercises/hatching';
import { renderAdvancedFillProgress, type HatchAdvancedParams } from '$lib/exercises/hatching-advanced';

export interface HatchProgressState {
	completed: number;
	total: number;
	fillFromLowY: boolean | null;
	lightTheme: boolean;
}

export interface FadingLayer {
	id: number;
	config: ExerciseConfig;
	strokes: Stroke[];
	scores: StrokeScore[] | null;
	alpha: number;
	guideVisibility: GuideVisibility;
	/** Snapshot for hatching fill overlay during fade */
	hatchProgress?: HatchProgressState | null;
}

export interface RenderState {
	exerciseConfig: ExerciseConfig | null;
	strokes: Stroke[];
	currentStroke: Stroke | null;
	transform: ViewTransform;
	guideVisibility: GuideVisibility;
	scores: StrokeScore[] | null;
	fadingLayers?: FadingLayer[];
	bgColor?: string;
	/** Basic hatching: progressive fill toward completion */
	hatchProgress?: HatchProgressState | null;
	reviewing?: boolean;
}

export function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: RenderState): void {
	const rect = canvas.getBoundingClientRect();
	const w = rect.width;
	const h = rect.height;
	const center = { x: w / 2, y: h / 2 };

	const bg = state.bgColor ?? '#1a1a2e';
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.save();
	applyTransform(ctx, state.transform, center);

	const plugin = state.exerciseConfig ? tryGetPlugin(state.exerciseConfig.type) : undefined;

	if (state.fadingLayers) {
		for (const fl of state.fadingLayers) {
			if (fl.alpha <= 0) continue;
			const flPlugin = tryGetPlugin(fl.config.type);
			ctx.save();
			ctx.globalAlpha = fl.alpha;
			if (fl.hatchProgress && fl.hatchProgress.fillFromLowY !== null && fl.hatchProgress.total > 0) {
				const progress = fl.hatchProgress.completed / fl.hatchProgress.total;
				if (fl.config.type === 'hatching') {
					renderHatchFillProgress(
						ctx,
						fl.config.references[0].params as HatchParams,
						progress,
						fl.hatchProgress.fillFromLowY,
						fl.hatchProgress.lightTheme,
					);
				} else if (fl.config.type === 'hatching-advanced') {
					renderAdvancedFillProgress(
						ctx,
						fl.config.references[0].params as HatchAdvancedParams,
						progress,
						fl.hatchProgress.fillFromLowY,
						fl.hatchProgress.lightTheme,
					);
				}
			}
			renderGuides(ctx, fl.config, fl.guideVisibility);
			for (let i = 0; i < fl.strokes.length; i++) {
				const score = fl.scores?.[i] ?? null;
				if (score) {
					if (flPlugin?.renderScoredStroke) flPlugin.renderScoredStroke(ctx, fl.strokes[i], score);
					else renderHighlights(ctx, fl.strokes[i], score);
				} else {
					if (flPlugin?.renderStroke) flPlugin.renderStroke(ctx, fl.strokes[i], '#e2e2e2', 2.5);
					else drawStroke(ctx, fl.strokes[i], '#e2e2e2', 2.5);
				}
			}
			ctx.restore();
		}
	}

	if (state.exerciseConfig) {
		if (state.hatchProgress && state.hatchProgress.fillFromLowY !== null && state.hatchProgress.total > 0) {
			const progress = state.hatchProgress.completed / state.hatchProgress.total;
			if (state.exerciseConfig.type === 'hatching') {
				renderHatchFillProgress(
					ctx,
					state.exerciseConfig.references[0].params as HatchParams,
					progress,
					state.hatchProgress.fillFromLowY,
					state.hatchProgress.lightTheme,
				);
			} else if (state.exerciseConfig.type === 'hatching-advanced') {
				renderAdvancedFillProgress(
					ctx,
					state.exerciseConfig.references[0].params as HatchAdvancedParams,
					progress,
					state.hatchProgress.fillFromLowY,
					state.hatchProgress.lightTheme,
				);
			}
		}
		renderGuides(ctx, state.exerciseConfig, state.guideVisibility);
	}

	for (let i = 0; i < state.strokes.length; i++) {
		const score = state.scores?.[i] ?? null;
		if (score) {
			if (plugin?.renderScoredStroke) plugin.renderScoredStroke(ctx, state.strokes[i], score);
			else renderHighlights(ctx, state.strokes[i], score);
		} else {
			const color = state.bgColor === '#ffffff' ? '#222222' : '#e2e2e2';
			if (plugin?.renderStroke) plugin.renderStroke(ctx, state.strokes[i], color, 2.5);
			else drawStroke(ctx, state.strokes[i], color, 2.5);
		}
	}

	if (state.currentStroke && state.currentStroke.rawPoints.length > 0) {
		const color = state.bgColor === '#ffffff' ? '#111111' : '#ffffff';
		if (plugin?.renderStroke) plugin.renderStroke(ctx, state.currentStroke, color, 2.5);
		else drawStroke(ctx, state.currentStroke, color, 2.5);
	}

	if (state.reviewing && plugin?.renderReview && state.exerciseConfig && state.exerciseConfig.references.length > 0) {
		plugin.renderReview(ctx, state.exerciseConfig.references[0].params as Record<string, unknown>, state.strokes);
	}

	ctx.restore();

	if (state.exerciseConfig && state.guideVisibility !== 'hidden') {
		renderOffscreenIndicator(ctx, state.exerciseConfig, state.transform, w, h, state.bgColor === '#ffffff');
	}
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, color: string, lineWidth: number): void {
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

export function drawPressureStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	color: string,
	baseWidth: number,
): void {
	const pts = stroke.smoothedPoints.length > 0 ? stroke.smoothedPoints : stroke.rawPoints;
	if (pts.length < 2) return;

	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	for (let i = 0; i < pts.length - 1; i++) {
		const avgP = (pts[i].pressure + pts[i + 1].pressure) / 2;
		ctx.beginPath();
		ctx.moveTo(pts[i].x, pts[i].y);
		ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
		ctx.lineWidth = Math.max(0.5, baseWidth * avgP * 3);
		ctx.stroke();
	}
}

function getShapeCenter(config: ExerciseConfig): { x: number; y: number } | null {
	if (!config.references.length) return null;
	const plugin = getPlugin(config.type);
	return plugin.getCenter(config.references[0].params as Record<string, unknown>);
}

function renderOffscreenIndicator(
	ctx: CanvasRenderingContext2D,
	config: ExerciseConfig,
	transform: ViewTransform,
	viewW: number,
	viewH: number,
	isLight: boolean,
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

	ctx.beginPath();
	ctx.arc(0, 0, sz + 6, 0, Math.PI * 2);
	ctx.strokeStyle = isLight ? 'rgba(76, 110, 245, 0.3)' : 'rgba(100, 160, 255, 0.3)';
	ctx.lineWidth = 2;
	ctx.stroke();

	ctx.restore();
}
