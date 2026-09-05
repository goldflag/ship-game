/**
 * How a set of distances collapses into the one distance a pixel stores. Used twice with the
 * same meanings: by the march over the samples along a ray, and by the temporal resolve over
 * a pixel's 3×3 source-texel neighborhood.
 *
 * NEAREST/FARTHEST take the front/back of the set. LINEAR and RECIPROCAL average it — the
 * first in distance, the second in 1/distance, which is the frame screen-space parallax
 * works in and so weights the near end of a mixed set much harder.
 */
export declare const HIT_DISTANCE_MODE: {
    readonly NEAREST: 0;
    readonly FARTHEST: 1;
    readonly LINEAR: 2;
    readonly RECIPROCAL: 3;
};
/** Sample coverage below which a march sample is too thin to count as a hit for NEAREST/FARTHEST. */
export declare const HIT_SAMPLE_MIN_ALPHA = 0.002;
/** Coverage at which a ray stores its mean depth outright; below it the value fades to the miss sentinel. */
export declare const HIT_ALPHA_FULL_DEPTH = 0.05;
/** Stored value for a ray that gathered no coverage. Finite in f16; above every stored real hit. */
export declare const HIT_DISTANCE_MISS = 65000;
/** Classification threshold: stored values ≥ this carry negligible coverage and count as misses. */
export declare const HIT_DISTANCE_MISS_THRESHOLD = 64000;
/**
 * Farthest storable real hit (meters); longer hits clamp here. Horizon-band clouds sit
 * hundreds of km out — beyond f16 range — and reproject fine from a 60 km proxy point
 * (rotation reprojection is distance-independent; translation parallax at 60 km is nil).
 */
export declare const HIT_DISTANCE_MAX = 60000;
