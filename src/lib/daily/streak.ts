const KEY = 'boxmaster-streak';

export interface StreakData {
	current: number;
	lastDate: string;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return d.toISOString().slice(0, 10);
}

export function loadStreak(): StreakData {
	if (typeof localStorage === 'undefined') return { current: 0, lastDate: '' };
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { current: 0, lastDate: '' };
		return JSON.parse(raw);
	} catch {
		return { current: 0, lastDate: '' };
	}
}

export function getActiveStreak(): number {
	const data = loadStreak();
	const t = today();
	const y = yesterday();
	if (data.lastDate === t || data.lastDate === y) return data.current;
	return 0;
}

export function recordSession(): StreakData {
	const data = loadStreak();
	const t = today();

	if (data.lastDate === t) return data;

	const y = yesterday();
	const newStreak: StreakData = {
		current: data.lastDate === y ? data.current + 1 : 1,
		lastDate: t,
	};

	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(KEY, JSON.stringify(newStreak));
	}
	return newStreak;
}
