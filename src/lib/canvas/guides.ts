import type { ExerciseConfig } from '$lib/exercises/types';
import { getPlugin } from '$lib/exercises/registry';

export type GuideVisibility = 'full' | 'hints' | 'hidden';

export function renderGuides(ctx: CanvasRenderingContext2D, config: ExerciseConfig, visibility: GuideVisibility): void {
	const plugin = getPlugin(config.type);

	if (plugin.renderScaffold && config.references.length > 0) {
		plugin.renderScaffold(ctx, config.references[0].params as Record<string, unknown>);
	}

	if (visibility === 'hidden' && !plugin.renderScaffold) return;

	for (const ref of config.references) {
		plugin.renderGuide(ctx, ref.params as Record<string, unknown>, visibility);
	}
}
