type Node = any;
/** Forward HG lobe — strongly forward-peaked, giving the silver lining toward the sun. */
export declare const HG_FORWARD = 0.8;
/** Backward HG lobe — weak backscatter glow away from the sun. */
export declare const HG_BACKWARD = -0.2;
/** Forward/backward lobe mix (0 = forward only, 1 = backward only). */
export declare const PHASE_BLEND = 0.5;
/** Per-octave extinction multiplier: octave n attenuates with 0.5ⁿ × the optical depth. */
export declare const MS_EXTINCTION = 0.5;
/** Per-octave scattering weight: octave n contributes 0.5ⁿ of the energy. */
export declare const MS_SCATTER = 0.5;
/** Per-octave phase eccentricity: octave n scales both HG lobes' g by 0.5ⁿ (flatter each time). */
export declare const MS_ECCENTRICITY = 0.5;
/** Inputs to {@link sampleLightEnergy}: one light-cone march from a single sample. */
export interface SampleLightEnergyParams {
    /** Sample position the light ray starts from. */
    position: Node;
    /** Extinction coefficient (per meter). */
    extinction: Node;
    /** Per-octave phases at the light's cosθ, length 3 (octave 0 = base phase). */
    octavePhases: Node[];
    /** Per-octave scattering-weight falloff (see `MS_SCATTER`). */
    msScatter: Node;
    /** Step length for tap 0 at the shaded point (world meters). */
    originStepLength: Node;
    /** CPU-packed `vec4(offset.xyz, stepLength)` uniforms for taps 1..N-1. */
    packedOffsets: readonly Node[];
    /** Density at a world position (sampled by the caller's `densityAt` closure). */
    densityAt: (position: Node) => Node;
    /** Primary-march density at `position`; reused for the first tap (at the origin)
     *  instead of re-fetching at the coarser frozen light LOD. */
    originDensity: Node;
}
/** Inputs to {@link ambientLight}: the sky/ground fill at one in-cloud sample. */
export interface AmbientLightParams {
    /** Shell height fraction, clamped to [0,1] (0 = cloud base, 1 = shell top) — the
     *  unclamped march-side `shellHeightFraction` would break the height mix below. */
    heightFraction: Node;
    /** Diffuse-fill radiance looking up (pre-multiplied by sun intensity). */
    zenithRadiance: Node;
    /** Diffuse-fill radiance toward the horizon. */
    horizonRadiance: Node;
    /** Ground-bounce upwelling radiance on the cloud base (carries ground albedo × sun). */
    groundBounceRadiance: Node;
    /** User multiplier on the combined ambient. */
    ambientIntensity: Node;
}
/**
 * Henyey-Greenstein phase function: the fraction of light scattered from `lightDir` into
 * the view direction, normalized over the sphere.
 *
 * @param cosTheta dot(viewDir, lightDir), in [−1, 1].
 * @param g Asymmetry in (−1, 1): >0 forward-scatters, <0 backscatters, 0 is isotropic.
 */
export declare const henyeyGreenstein: any;
/**
 * Dual-lobe HG phase — one HG lobe scattering forward and one back, linearly mixed. Real
 * cloud droplets do both; a single lobe can't give the sunward silver lining and the
 * away-from-sun glow at once.
 *
 * @param cosTheta dot(viewDir, lightDir), in [−1, 1].
 * @param gForward Forward lobe asymmetry (>0).
 * @param gBackward Backward lobe asymmetry (<0).
 * @param blend Lobe mix in [0,1]: 0 = forward only, 1 = backward only.
 */
export declare const dualHenyeyGreenstein: any;
/**
 * Powder dark-edge term: darkens thin cloud margins, where light scatters back out before
 * building enough in-scatter to look bright. Returns 1 at high density (no change), falling
 * toward 0 as density → 0; `strength` blends from off (1.0) to full.
 *
 * @param density Dimensionless field density in [0,1] — NOT an optical depth. The 2.0 is a
 *   unitless falloff rate over that [0,1] domain (the term reaches ~0.86 at density 1), not a
 *   Beer-Lambert extinction, so it does not track the `density` uniform's per-meter scaling.
 * @param strength Blend in [0,1]: 0 = term disabled (returns 1.0), 1 = full darkening.
 */
export declare const powderTerm: any;
/** Light energy at a sample: 3-octave multiple-scatter sum over the marched optical depth toward the light. */
export declare function sampleLightEnergy(params: SampleLightEnergyParams): Node;
/** Cool-skylight ambient fill: zenith-blue dominates at every height (the "silver" cast on
 *  cloud bottoms); a little warm horizon + ground bounce blends in toward the base. */
export declare const ambientLight: any;
export {};
