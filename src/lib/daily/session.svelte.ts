import type { ExerciseMode } from '$lib/exercises/types';
import { buildDailyPlan, type DailyPlan } from './planner';

export interface DailyExerciseResult {
	type: string;
	score: number;
	shapesCompleted: number;
}

class DailySession {
	active = $state(false);
	durationMs = $state(15 * 60 * 1000);
	startTime = $state(0);
	elapsed = $state(0);
	plan: DailyPlan | null = $state(null);
	currentIndex = $state(0);
	completed: DailyExerciseResult[] = $state([]);

	private _timer: ReturnType<typeof setInterval> | null = null;

	get remaining(): number {
		return Math.max(0, this.durationMs - this.elapsed);
	}

	get remainingSeconds(): number {
		return Math.ceil(this.remaining / 1000);
	}

	get expired(): boolean {
		return this.active && this.remaining <= 0;
	}

	get currentExercise(): string | null {
		if (!this.plan || this.currentIndex >= this.plan.exercises.length) return null;
		return this.plan.exercises[this.currentIndex].type;
	}

	get currentShapesCount(): number {
		if (!this.plan || this.currentIndex >= this.plan.exercises.length) return 10;
		return this.plan.exercises[this.currentIndex].shapesCount;
	}

	get currentMode(): ExerciseMode | null {
		if (!this.plan || this.currentIndex >= this.plan.exercises.length) return null;
		return this.plan.exercises[this.currentIndex].mode;
	}

	get totalExercises(): number {
		return this.plan?.exercises.length ?? 0;
	}

	get progress(): number {
		if (!this.plan || this.plan.exercises.length === 0) return 0;
		return this.currentIndex / this.plan.exercises.length;
	}

	async start(durationMinutes: number) {
		this.durationMs = durationMinutes * 60 * 1000;
		this.plan = await buildDailyPlan(durationMinutes);
		this.currentIndex = 0;
		this.completed = [];
		this.startTime = Date.now();
		this.elapsed = 0;
		this.active = true;
		this._startClock();
	}

	recordExercise(type: string, score: number, shapesCompleted: number) {
		this.completed = [...this.completed, { type, score, shapesCompleted }];
	}

	peekNextExercise(): string | null {
		if (!this.plan) return null;
		const nextIdx = this.currentIndex + 1;
		if (nextIdx >= this.plan.exercises.length || this.expired) return null;
		return this.plan.exercises[nextIdx].type;
	}

	advanceExercise(): string | null {
		if (!this.plan) return null;
		this.currentIndex++;
		if (this.currentIndex >= this.plan.exercises.length || this.expired) {
			return null;
		}
		return this.plan.exercises[this.currentIndex].type;
	}

	stop() {
		this.active = false;
		this._stopClock();
	}

	private _startClock() {
		this._stopClock();
		this._timer = setInterval(() => {
			this.elapsed = Date.now() - this.startTime;
		}, 250);
	}

	private _stopClock() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}
}

export const dailySession = new DailySession();
