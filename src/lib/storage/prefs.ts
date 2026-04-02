import type { ExerciseMode } from '$lib/exercises/types';

const KEY = 'boxmaster-prefs';

export interface UserPrefs {
	lightTheme: boolean;
	totalShapes: number;
	attemptsPerShape: number;
	timerMode: boolean;
	timerSeconds: number;
	penOnly: boolean;
	/** Per-exercise-type mode, e.g. { "line": "guided", "circle": "free" } */
	modes: Record<string, ExerciseMode>;
}

const DEFAULTS: UserPrefs = {
	lightTheme: true,
	totalShapes: 20,
	attemptsPerShape: 3,
	timerMode: false,
	timerSeconds: 60,
	penOnly: false,
	modes: {}
};

export function loadPrefs(): UserPrefs {
	if (typeof localStorage === 'undefined') return { ...DEFAULTS, modes: {} };
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULTS, modes: {} };
		const parsed = JSON.parse(raw);
		return { ...DEFAULTS, modes: {}, ...parsed };
	} catch {
		return { ...DEFAULTS, modes: {} };
	}
}

export function savePrefs(prefs: UserPrefs): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs));
	} catch {
		// storage full or unavailable — non-fatal
	}
}

export function updatePrefs(partial: Partial<UserPrefs>): void {
	const current = loadPrefs();
	if (partial.modes) {
		partial.modes = { ...current.modes, ...partial.modes };
	}
	savePrefs({ ...current, ...partial });
}
