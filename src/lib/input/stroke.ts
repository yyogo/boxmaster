export interface StrokePoint {
	x: number;
	y: number;
	pressure: number;
	timestamp: number;
}

export interface Stroke {
	id: string;
	rawPoints: StrokePoint[];
	smoothedPoints: StrokePoint[];
}

let nextId = 0;

export function createStroke(): Stroke {
	return {
		id: `stroke-${nextId++}-${Date.now()}`,
		rawPoints: [],
		smoothedPoints: []
	};
}

export function addPoint(stroke: Stroke, point: StrokePoint): void {
	stroke.rawPoints.push(point);
	stroke.smoothedPoints = smoothPoints(stroke.rawPoints);
}

const SMOOTH_WINDOW = 5;

function smoothPoints(raw: StrokePoint[]): StrokePoint[] {
	if (raw.length <= 2) return [...raw];

	const result: StrokePoint[] = [];
	const half = Math.floor(SMOOTH_WINDOW / 2);

	for (let i = 0; i < raw.length; i++) {
		let sx = 0,
			sy = 0,
			count = 0;
		for (let j = Math.max(0, i - half); j <= Math.min(raw.length - 1, i + half); j++) {
			sx += raw[j].x;
			sy += raw[j].y;
			count++;
		}
		result.push({
			x: sx / count,
			y: sy / count,
			pressure: raw[i].pressure,
			timestamp: raw[i].timestamp
		});
	}
	return result;
}
