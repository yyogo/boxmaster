export interface ViewTransform {
	panX: number;
	panY: number;
	rotation: number;
}

export function identityTransform(): ViewTransform {
	return { panX: 0, panY: 0, rotation: 0 };
}

export function applyTransform(
	ctx: CanvasRenderingContext2D,
	t: ViewTransform,
	center: { x: number; y: number },
): void {
	ctx.translate(center.x, center.y);
	ctx.rotate(t.rotation);
	ctx.translate(-center.x + t.panX, -center.y + t.panY);
}

export function screenToWorld(
	screen: { x: number; y: number },
	t: ViewTransform,
	center: { x: number; y: number },
): { x: number; y: number } {
	const dx = screen.x - center.x;
	const dy = screen.y - center.y;
	const cos = Math.cos(-t.rotation);
	const sin = Math.sin(-t.rotation);
	return {
		x: cos * dx - sin * dy + center.x - t.panX,
		y: sin * dx + cos * dy + center.y - t.panY,
	};
}

export function worldToScreen(
	world: { x: number; y: number },
	t: ViewTransform,
	center: { x: number; y: number },
): { x: number; y: number } {
	const wx = world.x + t.panX - center.x;
	const wy = world.y + t.panY - center.y;
	const cos = Math.cos(t.rotation);
	const sin = Math.sin(t.rotation);
	return {
		x: cos * wx - sin * wy + center.x,
		y: sin * wx + cos * wy + center.y,
	};
}
