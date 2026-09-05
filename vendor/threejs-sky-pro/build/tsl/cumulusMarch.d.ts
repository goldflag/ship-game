import { Sun } from "../state/Sun";
import { Clouds } from "../state/Clouds";
import { CloudQuality } from "../state/CloudQuality";
import type { CloudLightingNodes } from "./cloudLighting";
type Node = any;
/**
 * Where along the ray its coverage came from, in the four reductions
 * `HIT_DISTANCE_MODE` names. `weightedDist` is always accumulated for haze; the march
 * updates only the additional accumulator selected for the stored hit distance.
 * Distances are meters along the view ray.
 */
export interface DepthAccumulators {
    /** Σ t·dα. Divide by final alpha for the coverage-weighted linear mean. */
    weightedDist: Node;
    /** Σ dα/t. Divide final alpha by this for the coverage-weighted reciprocal mean. */
    weightedInvDist: Node;
    /** Smallest t whose sample cleared `HIT_SAMPLE_MIN_ALPHA`. Init to `HIT_DISTANCE_MAX`; stays there if none did. */
    nearestDist: Node;
    /** Largest t whose sample cleared `HIT_SAMPLE_MIN_ALPHA`. Init to 0; stays there if none did. */
    farthestDist: Node;
}
/** Inputs to {@link emitCumulusMarch}. All positions and distances are world-space meters. */
export interface EmitCumulusMarchOptions {
    /** Per-fragment ray (caller `.toVar()`s before passing in). */
    rayOrigin: Node;
    rayDir: Node;
    /** `float(PLANET_RADIUS)` and the per-frame planet-center uniform. */
    planetRadius: Node;
    planetCenter: Node;
    cloud: Clouds;
    /** Construction-time graph choice: include wind drift/evolution coordinates. */
    animatedClouds: boolean;
    quality: CloudQuality;
    sun: Sun;
    buildLighting: (enabled: Node) => CloudLightingNodes;
    /** Cloud-noise `texture()` nodes sampled by `sampleCloudDensity`. */
    weatherNode: Node;
    baseNode: Node;
    /** Per-pixel ray-start dither in [0,1], scrolled every frame: fraction of the entry step to offset the first sample by (breaks march banding). 0 = no dither. */
    startDitherFraction: Node;
    /** Shared accumulators, mutated in place. */
    luminance: Node;
    transmittance: Node;
    depth: DepthAccumulators;
    /** Runtime-uniform `HIT_DISTANCE_MODE`; selects the one mode-specific depth reducer. */
    hitDistanceMode: Node;
}
/** Emit the cumulus shell intersection + ray-march; must run inside the outer color-node `Fn` body. */
export declare function emitCumulusMarch(opts: EmitCumulusMarchOptions): void;
export {};
