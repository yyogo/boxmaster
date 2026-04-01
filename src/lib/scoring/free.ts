import type { StrokePoint } from '$lib/input/stroke';

export function scoreFreeLine(points: StrokePoint[]): {
	accuracy: number;
	fittedLine: { x1: number; y1: number; x2: number; y2: number };
} {
	if (points.length < 2) {
		return { accuracy: 0, fittedLine: { x1: 0, y1: 0, x2: 0, y2: 0 } };
	}

	const start = points[0];
	const end = points[points.length - 1];

	// Arc length
	let arcLen = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		arcLen += Math.sqrt(dx * dx + dy * dy);
	}

	// Chord length
	const chord = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);

	if (chord < 5) {
		return { accuracy: 0, fittedLine: { x1: start.x, y1: start.y, x2: end.x, y2: end.y } };
	}

	// Straightness = chord / arcLen, 1.0 = perfectly straight
	const straightness = chord / arcLen;
	const accuracy = Math.max(0, Math.min(100, straightness * 100));

	return {
		accuracy,
		fittedLine: { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
	};
}

export function scoreFreeRectangle(
	strokes: { points: StrokePoint[] }[]
): {
	accuracy: number;
	perpendicularity: number;
	parallelism: number;
} {
	if (strokes.length < 4) {
		return { accuracy: 0, perpendicularity: 0, parallelism: 0 };
	}

	const edges = strokes.slice(0, 4).map((s) => {
		const pts = s.points;
		const start = pts[0];
		const end = pts[pts.length - 1];
		return {
			dx: end.x - start.x,
			dy: end.y - start.y,
			start,
			end
		};
	});

	// Score perpendicularity of adjacent edges
	let perpTotal = 0;
	for (let i = 0; i < 4; i++) {
		const a = edges[i];
		const b = edges[(i + 1) % 4];
		const dot = a.dx * b.dx + a.dy * b.dy;
		const magA = Math.sqrt(a.dx ** 2 + a.dy ** 2);
		const magB = Math.sqrt(b.dx ** 2 + b.dy ** 2);
		if (magA > 0 && magB > 0) {
			const cosAngle = Math.abs(dot / (magA * magB));
			perpTotal += 1 - cosAngle; // 1 = perpendicular, 0 = parallel
		}
	}
	const perpendicularity = Math.max(0, Math.min(100, (perpTotal / 4) * 100));

	// Score parallelism of opposite edges
	let paraTotal = 0;
	for (let i = 0; i < 2; i++) {
		const a = edges[i];
		const b = edges[i + 2];
		const magA = Math.sqrt(a.dx ** 2 + a.dy ** 2);
		const magB = Math.sqrt(b.dx ** 2 + b.dy ** 2);
		if (magA > 0 && magB > 0) {
			const cosAngle = Math.abs(
				(a.dx * b.dx + a.dy * b.dy) / (magA * magB)
			);
			paraTotal += cosAngle;
		}
	}
	const parallelism = Math.max(0, Math.min(100, (paraTotal / 2) * 100));

	// Straightness of each stroke
	let straightTotal = 0;
	for (const s of strokes.slice(0, 4)) {
		const { accuracy } = scoreFreeLine(s.points);
		straightTotal += accuracy;
	}
	const straightness = straightTotal / 4;

	const accuracy = straightness * 0.4 + perpendicularity * 0.3 + parallelism * 0.3;

	return { accuracy, perpendicularity, parallelism };
}
