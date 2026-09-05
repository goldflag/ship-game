import * as THREE from 'three/webgpu';
import { type NoiseDim3, type BaseShapeProfile } from './noiseProfiles';
/** GPU textures produced by a noise load or runtime generation. */
export interface BakedCloudNoise {
    /** Base-shape volume, RGBA8 with a full mip chain, repeat-wrapped on all three axes. */
    baseShape: THREE.Data3DTexture;
}
/**
 * Load a bundled baked base-shape texture at the given cubic resolution — `dims.x` names
 * the asset (`baseShape<edge>.bin`). Defaults to `DEFAULT_BASE_SHAPE_DIMS` (64³). Await the
 * returned promise. `renderer` must already be initialized. See `scripts/bakeNoise.ts` for
 * which resolutions ship (one per distinct quality-tier `baseShapeDims`).
 */
export declare function loadCloudNoiseTextures(renderer: THREE.WebGPURenderer, dims?: NoiseDim3): Promise<BakedCloudNoise>;
/** Overrides for {@link generateCloudNoiseTextures}. */
export interface GenerateCloudNoiseOptions {
    /** Cubic volume resolution. Defaults to `DEFAULT_BASE_SHAPE_DIMS` (64³). */
    baseShapeDims?: NoiseDim3;
    /** Per-channel Worley composition. Defaults to `DEFAULT_BASE_SHAPE_PROFILE`. */
    baseShapeProfile?: BaseShapeProfile;
}
/** CPU-generate the base-shape noise texture. Synchronous — blocks until the volume is built. */
export declare function generateCloudNoiseTextures(renderer: THREE.WebGPURenderer, opts?: GenerateCloudNoiseOptions): BakedCloudNoise;
/**
 * Load the base-shape volume at `dims`, preferring the bundled bake. Every built-in tier
 * resolution ships one (no CPU cost); any other size CPU-generates the volume + mip chain
 * synchronously.
 */
export declare function resolveBaseShapeTexture(renderer: THREE.WebGPURenderer, dims: NoiseDim3): Promise<THREE.Data3DTexture>;
