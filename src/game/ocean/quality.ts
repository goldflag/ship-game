import type { OceanQuality, WaveCascadeInfo } from './contracts';

/** What each Graphics → Ocean tier spends. The wave field owns the cascade layout;
 * the surface owns mesh density; the wake and reflections read their budgets here. */
export interface OceanTier {
  /** Largest tile first. Tile sizes avoid simple ratios so the tiles never realign. */
  readonly cascades: readonly WaveCascadeInfo[];
  /** Clipmap cells per level edge (the base level spans 256 m). */
  readonly segments: number;
  /** Wake field cells per edge, or 0 for no wake simulation. */
  readonly wakeResolution: number;
  /** Screen-space reflection ray steps, or 0 where scene reflections are unavailable. */
  readonly reflectionSteps: number;
}

export const OCEAN_TIERS: Readonly<Record<OceanQuality, OceanTier>> = {
  low: { cascades: [{ size: 1024, resolution: 256 }], segments: 16, wakeResolution: 0, reflectionSteps: 0 },
  medium: { cascades: [{ size: 1024, resolution: 256 }, { size: 181, resolution: 256 }], segments: 32, wakeResolution: 256, reflectionSteps: 0 },
  high: { cascades: [{ size: 1024, resolution: 256 }, { size: 181, resolution: 256 }, { size: 31, resolution: 256 }], segments: 64, wakeResolution: 512, reflectionSteps: 16 },
  ultra: { cascades: [{ size: 1024, resolution: 512 }, { size: 181, resolution: 512 }, { size: 31, resolution: 512 }], segments: 128, wakeResolution: 1024, reflectionSteps: 32 },
};
