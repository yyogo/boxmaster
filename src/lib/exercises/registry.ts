import type { ExercisePlugin } from './plugin';

const registry = new Map<string, ExercisePlugin>();

export function registerExercise(plugin: ExercisePlugin): void {
	registry.set(plugin.id, plugin);
}

export function getPlugin(id: string): ExercisePlugin {
	const plugin = registry.get(id);
	if (!plugin) throw new Error(`Unknown exercise type: ${id}`);
	return plugin;
}

export function tryGetPlugin(id: string): ExercisePlugin | undefined {
	return registry.get(id);
}

export function getAllPlugins(): ExercisePlugin[] {
	return Array.from(registry.values());
}

export function getPluginsByUnit(): Map<string, ExercisePlugin[]> {
	const byUnit = new Map<string, ExercisePlugin[]>();
	for (const plugin of registry.values()) {
		const list = byUnit.get(plugin.unit) ?? [];
		list.push(plugin);
		byUnit.set(plugin.unit, list);
	}
	return byUnit;
}
