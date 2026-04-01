import type { ExerciseConfig, LineParams, CircleParams, EllipseParams, RectParams, PerspectiveBoxParams } from '$lib/exercises/types';

export type GuideVisibility = 'full' | 'hints' | 'hidden';

const GUIDE_COLOR = 'rgba(100, 160, 255, 0.6)';
const GUIDE_COLOR_FAINT = 'rgba(100, 160, 255, 0.15)';
const HINT_COLOR = 'rgba(100, 160, 255, 0.5)';
const SCAFFOLD_COLOR = 'rgba(255, 200, 80, 0.7)';
const VP_COLOR = 'rgba(255, 120, 80, 0.9)';
const GIVEN_EDGE_COLOR = 'rgba(180, 220, 255, 0.8)';

export function renderGuides(
	ctx: CanvasRenderingContext2D,
	config: ExerciseConfig,
	visibility: GuideVisibility
): void {
	if (visibility === 'hidden' && config.type !== '1-point-box') return;

	// For perspective: draw shared horizon/VP once, then per-box scaffolding
	if (config.type === '1-point-box' && config.references.length > 0) {
		const first = config.references[0].params as PerspectiveBoxParams;
		drawPerspectiveScaffold(ctx, first);
		for (const ref of config.references) {
			drawPerspectiveBox(ctx, ref.params as PerspectiveBoxParams, visibility);
		}
		return;
	}

	for (const ref of config.references) {
		switch (ref.type) {
			case 'line':
				if (visibility === 'full') drawLineGuide(ctx, ref.params as LineParams);
				else if (visibility === 'hints') drawLineHints(ctx, ref.params as LineParams);
				break;
			case 'circle':
				if (visibility === 'full') drawCircleGuide(ctx, ref.params as CircleParams);
				else if (visibility === 'hints') drawCircleHints(ctx, ref.params as CircleParams);
				break;
			case 'ellipse':
				if (visibility === 'full') drawEllipseGuide(ctx, ref.params as EllipseParams);
				else if (visibility === 'hints') drawEllipseHints(ctx, ref.params as EllipseParams);
				break;
			case 'rectangle':
				if (visibility === 'full') drawRectGuide(ctx, ref.params as RectParams);
				else if (visibility === 'hints') drawRectHints(ctx, ref.params as RectParams);
				break;
			case '1-point-box':
				drawPerspectiveBox(ctx, ref.params as PerspectiveBoxParams, visibility);
				break;
		}
	}
}

// --- Full guides (guided mode) ---

function drawLineGuide(ctx: CanvasRenderingContext2D, p: LineParams): void {
	ctx.beginPath();
	ctx.moveTo(p.x1, p.y1);
	ctx.lineTo(p.x2, p.y2);
	ctx.strokeStyle = GUIDE_COLOR;
	ctx.lineWidth = 2;
	ctx.setLineDash([8, 6]);
	ctx.stroke();
	ctx.setLineDash([]);
	drawDot(ctx, p.x1, p.y1, 4, GUIDE_COLOR);
	drawDot(ctx, p.x2, p.y2, 4, GUIDE_COLOR);
}

function drawCircleGuide(ctx: CanvasRenderingContext2D, p: CircleParams): void {
	ctx.beginPath();
	ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
	ctx.strokeStyle = GUIDE_COLOR;
	ctx.lineWidth = 2;
	ctx.setLineDash([8, 6]);
	ctx.stroke();
	ctx.setLineDash([]);
	drawCrosshair(ctx, p.cx, p.cy, 6, GUIDE_COLOR);
}

function drawEllipseGuide(ctx: CanvasRenderingContext2D, p: EllipseParams): void {
	ctx.beginPath();
	ctx.ellipse(p.cx, p.cy, p.rx, p.ry, p.rotation, 0, Math.PI * 2);
	ctx.strokeStyle = GUIDE_COLOR;
	ctx.lineWidth = 2;
	ctx.setLineDash([8, 6]);
	ctx.stroke();
	ctx.setLineDash([]);
	drawCrosshair(ctx, p.cx, p.cy, 6, GUIDE_COLOR);
}

function drawRectGuide(ctx: CanvasRenderingContext2D, p: RectParams): void {
	ctx.save();
	ctx.translate(p.cx, p.cy);
	ctx.rotate(p.rotation);
	ctx.strokeStyle = GUIDE_COLOR;
	ctx.lineWidth = 2;
	ctx.setLineDash([8, 6]);
	ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
	ctx.setLineDash([]);
	ctx.restore();
}

// --- Hints only (semi-guided mode) ---

function drawLineHints(ctx: CanvasRenderingContext2D, p: LineParams): void {
	ctx.beginPath();
	ctx.moveTo(p.x1, p.y1);
	ctx.lineTo(p.x2, p.y2);
	ctx.strokeStyle = HINT_COLOR;
	ctx.lineWidth = 1.5;
	ctx.setLineDash([6, 8]);
	ctx.stroke();
	ctx.setLineDash([]);
	drawDot(ctx, p.x1, p.y1, 4, HINT_COLOR);
	drawDot(ctx, p.x2, p.y2, 4, HINT_COLOR);
}

function drawCircleHints(ctx: CanvasRenderingContext2D, p: CircleParams): void {
	drawCrosshair(ctx, p.cx, p.cy, 8, HINT_COLOR);
	// Radius at a seeded-random angle (stable per circle position)
	const angle = (p.cx * 7 + p.cy * 13) % (Math.PI * 2);
	const rx = p.cx + Math.cos(angle) * p.r;
	const ry = p.cy + Math.sin(angle) * p.r;
	ctx.beginPath();
	ctx.moveTo(p.cx, p.cy);
	ctx.lineTo(rx, ry);
	ctx.strokeStyle = HINT_COLOR;
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	ctx.stroke();
	ctx.setLineDash([]);
	drawDot(ctx, rx, ry, 3, HINT_COLOR);
}

function drawEllipseHints(ctx: CanvasRenderingContext2D, p: EllipseParams): void {
	drawCrosshair(ctx, p.cx, p.cy, 8, HINT_COLOR);
	const cos = Math.cos(p.rotation);
	const sin = Math.sin(p.rotation);
	// Major axis endpoints
	const ax1 = { x: p.cx + cos * p.rx, y: p.cy + sin * p.rx };
	const ax2 = { x: p.cx - cos * p.rx, y: p.cy - sin * p.rx };
	// Minor axis endpoints
	const bx1 = { x: p.cx - sin * p.ry, y: p.cy + cos * p.ry };
	const bx2 = { x: p.cx + sin * p.ry, y: p.cy - cos * p.ry };

	ctx.beginPath();
	ctx.moveTo(ax1.x, ax1.y);
	ctx.lineTo(ax2.x, ax2.y);
	ctx.moveTo(bx1.x, bx1.y);
	ctx.lineTo(bx2.x, bx2.y);
	ctx.strokeStyle = HINT_COLOR;
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	ctx.stroke();
	ctx.setLineDash([]);

	drawDot(ctx, ax1.x, ax1.y, 3, HINT_COLOR);
	drawDot(ctx, ax2.x, ax2.y, 3, HINT_COLOR);
	drawDot(ctx, bx1.x, bx1.y, 3, HINT_COLOR);
	drawDot(ctx, bx2.x, bx2.y, 3, HINT_COLOR);
}

function drawRectHints(ctx: CanvasRenderingContext2D, p: RectParams): void {
	const cos = Math.cos(p.rotation);
	const sin = Math.sin(p.rotation);
	const hw = p.w / 2;
	const hh = p.h / 2;
	const corners = [
		{ x: p.cx + cos * -hw - sin * -hh, y: p.cy + sin * -hw + cos * -hh },
		{ x: p.cx + cos * hw - sin * -hh, y: p.cy + sin * hw + cos * -hh },
		{ x: p.cx + cos * hw - sin * hh, y: p.cy + sin * hw + cos * hh },
		{ x: p.cx + cos * -hw - sin * hh, y: p.cy + sin * -hw + cos * hh }
	];
	for (const c of corners) {
		drawDot(ctx, c.x, c.y, 5, HINT_COLOR);
	}
}

// --- Perspective ---

function drawPerspectiveScaffold(
	ctx: CanvasRenderingContext2D,
	p: PerspectiveBoxParams
): void {
	ctx.beginPath();
	ctx.moveTo(-5000, p.horizon.y);
	ctx.lineTo(5000, p.horizon.y);
	ctx.strokeStyle = SCAFFOLD_COLOR;
	ctx.lineWidth = 1;
	ctx.setLineDash([12, 8]);
	ctx.stroke();
	ctx.setLineDash([]);

	const vp = p.vanishingPoint;
	drawDot(ctx, vp.x, vp.y, 6, VP_COLOR);
	drawCrosshair(ctx, vp.x, vp.y, 10, VP_COLOR);
}

function drawPerspectiveBox(
	ctx: CanvasRenderingContext2D,
	p: PerspectiveBoxParams,
	visibility: GuideVisibility
): void {
	for (const edge of [p.givenEdges.horizontal, p.givenEdges.vertical, p.givenEdges.depth]) {
		ctx.beginPath();
		ctx.moveTo(edge.x1, edge.y1);
		ctx.lineTo(edge.x2, edge.y2);
		ctx.strokeStyle = GIVEN_EDGE_COLOR;
		ctx.lineWidth = 2.5;
		ctx.stroke();
	}

	drawDot(ctx, p.givenCorner.x, p.givenCorner.y, 4, GIVEN_EDGE_COLOR);

	if (visibility === 'full') {
		for (const edge of p.expectedEdges) {
			ctx.beginPath();
			ctx.moveTo(edge.x1, edge.y1);
			ctx.lineTo(edge.x2, edge.y2);
			ctx.strokeStyle = GUIDE_COLOR_FAINT;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([6, 6]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}
}

// --- Primitives ---

function drawDot(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	r: number,
	color: string
): void {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

function drawCrosshair(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	color: string
): void {
	ctx.beginPath();
	ctx.moveTo(x - size, y);
	ctx.lineTo(x + size, y);
	ctx.moveTo(x, y - size);
	ctx.lineTo(x, y + size);
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.stroke();
}
