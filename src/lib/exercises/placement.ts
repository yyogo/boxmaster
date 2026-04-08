export interface BoundingBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

function boxesOverlap(a: BoundingBox, b: BoundingBox, padding: number): boolean {
	return !(
		a.x + a.w + padding < b.x ||
		b.x + b.w + padding < a.x ||
		a.y + a.h + padding < b.y ||
		b.y + b.h + padding < a.y
	);
}

/**
 * Place `count` items within a canvas, avoiding overlap.
 * `sizeFn` returns the desired width/height for each item.
 * Returns an array of {x, y} top-left positions.
 */
export function placeNonOverlapping(
	count: number,
	canvasW: number,
	canvasH: number,
	sizeFn: (index: number) => { w: number; h: number },
	margin = 30,
	gap = 20,
	maxAttempts = 200,
): { x: number; y: number; w: number; h: number }[] {
	const placed: BoundingBox[] = [];

	for (let i = 0; i < count; i++) {
		const size = sizeFn(i);
		let best: BoundingBox | null = null;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const x = margin + Math.random() * Math.max(1, canvasW - 2 * margin - size.w);
			const y = margin + Math.random() * Math.max(1, canvasH - 2 * margin - size.h);
			const candidate: BoundingBox = { x, y, w: size.w, h: size.h };

			const overlaps = placed.some((p) => boxesOverlap(p, candidate, gap));
			if (!overlaps) {
				best = candidate;
				break;
			}
			// Keep last attempt as fallback
			best = candidate;
		}

		placed.push(best!);
	}

	return placed;
}
