import { type NoiseDim3 } from "../noise/noiseProfiles";
/** Name of a built-in quality tier. Pass to `SkySystem.setQualityLevel()`. */
export type QualityLevel = "low" | "medium" | "high" | "ultra";
/**
 * The knobs a quality tier sets. Pass a partial as `setQualityLevel(level, overrides)`
 * to tweak individual fields on top of a tier.
 */
export interface QualityLevelConfig {
    /** Cloud reconstruction divisor. The march also multiplies this by the cloud rendering mode's sampling lattice. */
    cloudHistoryDiv: 1 | 2 | 4 | 8;
    /** Accumulated cloud alpha where screen-cloud lighting switches to its cheaper approximation. Range [0, 1]. */
    cloudFullLightingAlpha: number;
    /** Cloud shadow-map edge length, pixels (square). Higher = sharper cloud shadows on the ground. */
    cloudShadowResolution: number;
    /** Mip the shadow bake samples the cloud field at. 0 = finest; higher = coarser and cheaper. */
    cloudShadowMipLevel: number;
    /** Whether god rays render at all. */
    godRaysEnabled: boolean;
    /** God-ray march steps per view ray. Higher = smoother shafts. */
    godRaySteps: number;
    /** Whether the reflection env map re-bakes each frame. `false` freezes the last bake. */
    envMapEnabled: boolean;
    /** Whether the env-map bake draws clouds. `false` = sky-only reflections. */
    envMapClouds: boolean;
    /** Equirect env-map width, pixels. */
    envMapWidth: number;
    /** Equirect env-map height, pixels. Normally `envMapWidth / 2` (2:1 aspect). */
    envMapHeight: number;
    /** Cloud raymarch steps in the env-map bake. Higher = more detailed reflected clouds. */
    envMapMarchSteps: number;
    /** Mip floor for the base-shape noise in the env-map bake. Higher = coarser, cheaper reflections. */
    envMapMipBase: number;
    /** Weather-map edge length, pixels (square). Changing it re-fills the map on the CPU. */
    weatherMapResolution: number;
    /** Base-shape 3D noise resolution. Tier sizes (16³/32³/64³) load bundled bakes; any other size is generated on the CPU. */
    baseShapeDims: NoiseDim3;
}
/**
 * The built-in quality tiers. Changing `weatherMapResolution` or `baseShapeDims` — by
 * switching tiers or overriding either — re-fills the noise on the CPU and stalls the frame.
 */
export declare const QUALITY_LEVELS: Readonly<Record<QualityLevel, QualityLevelConfig>>;
