import type { Texture } from 'three';
type Node = any;
/** Inputs to the cirrus-deck sample. Positions and distances are world-space meters. */
export interface SampleCirrusLayerOptions {
    /** Per-fragment ray, world space (already `.toVar()`'d by the caller). */
    rayOrigin: Node;
    rayDir: Node;
    /** Per-frame planet-center uniform + `float(PLANET_RADIUS)` (m). */
    planetCenter: Node;
    planetRadius: Node;
    /** Grayscale cirrus mask; `.r` is coverage (0 = clear sky, 1 = dense streak). */
    cirrusTexture: Texture;
    /** World meters per tile + opacity multiplier (CloudCirrus uniforms). */
    scale: Node;
    strength: Node;
    /** Procedural weather map (R = coverage) driving the storm-haze contribution; `null` disables it. */
    weatherTexture: Texture | null;
    /** World meters per weather-map tile sampled for the haze deck + opacity multiplier (CloudHaze uniforms). */
    hazeScale: Node;
    hazeDensity: Node;
    /** Shared with the volumetric clouds' own horizon melt (`CloudQuality`), so the flat
     *  deck fades out over the same camera-distance range instead of lingering past where the
     *  raymarched shell has already melted to nothing. */
    horizonMeltStart: Node;
    horizonMeltEnd: Node;
    /** Accumulated world-space wind drift offset; xz drifts the deck. */
    windOffset: Node;
    /** Construction-time graph choice: include wind drift coordinates. */
    animatedClouds: boolean;
    /** Sun color, intensity, and atmospheric transmittance tint toward the sun. */
    sunColor: Node;
    sunIntensity: Node;
    sunTint: Node;
    /** Dual-HG phase at rayDir·sunDir — the forward silver-lining lobe. */
    phaseSun: Node;
    /** Ambient sky fill radiance looking up. */
    zenithRadiance: Node;
}
/**
 * Sample the 2D cirrus/haze deck as a flat high layer: intersect a sphere concentric with
 * the planet above the volumetric shell, project the world XZ of the hit to a tiled UV, and
 * combine two independent coverage sources on that same plane — the static cirrus mask and a
 * storm-haze term read from the procedural weather map (so haze thickens wherever cumulus
 * coverage does). Cirrus always lights as a thin, bright, sunlit streak; haze instead dims
 * from that same sunlit look toward a dark, desaturated overcast gray as its own density
 * builds, so a thick haze cell visually suppresses the sun instead of adding brightness on
 * top of it — a cheap analytic stand-in for extinction, without a second raymarch. Returns
 * `vec4(radiance, coverage)` ready to composite behind the volumetric clouds; coverage fades
 * out toward (and is clipped below) the horizon, melts away over the same camera-distance
 * range the volumetric clouds do (so the flat deck doesn't outlive the raymarched shell's own
 * fade), and saturates to fully opaque (able to occlude the sun disc) when either contribution
 * is dense enough.
 */
export declare function sampleCirrusLayer(opts: SampleCirrusLayerOptions): Node;
export {};
