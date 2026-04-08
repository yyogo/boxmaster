import { openDB, type IDBPDatabase } from 'idb';
import type { ExerciseResult } from '$lib/scoring/types';

const DB_NAME = 'boxmaster';
const DB_VERSION = 2;
const STORE_NAME = 'results';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
				if (oldVersion < 1) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
					store.createIndex('by-type', 'exerciseType');
					store.createIndex('by-timestamp', 'timestamp');
					store.createIndex('by-unit', 'unit');
				}
				// v2: metricAverages added to ExerciseResult — no schema change needed,
				// old records without the field are still valid (Partial<Record>).
			},
		});
	}
	return dbPromise;
}

export async function saveResult(result: ExerciseResult): Promise<void> {
	const db = await getDb();
	await db.put(STORE_NAME, result);
}

export async function getResultsByType(exerciseType: string): Promise<ExerciseResult[]> {
	const db = await getDb();
	const results = await db.getAllFromIndex(STORE_NAME, 'by-type', exerciseType);
	return results.sort((a: ExerciseResult, b: ExerciseResult) => a.timestamp - b.timestamp);
}

export async function getResultsByUnit(unit: string): Promise<ExerciseResult[]> {
	const db = await getDb();
	const results = await db.getAllFromIndex(STORE_NAME, 'by-unit', unit);
	return results.sort((a: ExerciseResult, b: ExerciseResult) => a.timestamp - b.timestamp);
}

export async function getAllResults(): Promise<ExerciseResult[]> {
	const db = await getDb();
	const results = await db.getAll(STORE_NAME);
	return results.sort((a: ExerciseResult, b: ExerciseResult) => a.timestamp - b.timestamp);
}

export async function getRecentResults(limit = 20): Promise<ExerciseResult[]> {
	const all = await getAllResults();
	return all.slice(-limit);
}

export async function clearAllResults(): Promise<void> {
	const db = await getDb();
	await db.clear(STORE_NAME);
}
