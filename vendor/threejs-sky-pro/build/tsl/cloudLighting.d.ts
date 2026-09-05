import { Sun } from '../state/Sun';
import { Clouds } from '../state/Clouds';
import { TimeOfDay } from '../state/TimeOfDay';
import { AmbientSkyBaker } from '../baking/AmbientSkyBaker';
type Node = any;
/** Moon uniform bundle forwarded to the march. Null when no time-of-day state. */
export interface CloudMoonNodes {
    dir: Node;
    color: Node;
    intensity: Node;
    gain: Node;
    illum: Node;
    /** 1 − smoothstep(sunIntensity over the fade band): moonlight's fade-out as the sun rises.
     *  March-invariant (depends only on frame-constant sunIntensity), hoisted here instead of
     *  recomputing per lit sample. */
    moonSunFade: Node;
    /** CPU-packed `vec4(offset.xyz, stepLength)` uniforms for moon-cone taps 1..N-1. */
    coneOffsets: readonly Node[];
}
/** Per-fragment lighting state for the cumulus march — every field is march-invariant. */
export interface CloudLightingNodes {
    /** Per-channel atmospheric transmittance along the sun direction. */
    sunTint: Node;
    /** Dual-HG phases at the sun's cosθ, one per octave (length 3). */
    octavePhasesSun: Node[];
    /** Diffuse-fill radiance looking up. */
    zenithRadiance: Node;
    /** Diffuse-fill radiance toward the horizon. */
    horizonRadiance: Node;
    /** Ground-bounce upwelling radiance. */
    groundBounceRadiance: Node;
    /** Moon uniform bundle, or null when no time-of-day state was supplied. */
    moonNodes: CloudMoonNodes | null;
    /** Hoisted dual-HG phases at the moon's cosθ (length 3), or null. */
    octavePhasesMoon: Node[] | null;
    /** CPU-packed `vec4(offset.xyz, stepLength)` uniforms for sun-cone taps 1..N-1. */
    sunConeOffsets: readonly Node[];
}
/** Inputs to {@link buildCloudLightingNodes}: the per-fragment ray plus the lighting state. */
export interface BuildCloudLightingNodesOptions {
    /** Per-fragment view-direction node (already `.toVar()`'d by the caller). */
    rayDir: Node;
    sun: Sun;
    cloud: Clouds;
    timeOfDay: TimeOfDay | null;
    ambientSky: AmbientSkyBaker;
    /** CPU-packed sun-cone offsets owned by the cloud material. */
    sunConeOffsets: readonly Node[];
    /** CPU-packed moon-cone offsets, or null when moon lighting is compiled out. */
    moonConeOffsets: readonly Node[] | null;
    /** Framebuffer-local validity gate, such as a successful cloud-shell intersection. */
    enabled?: Node;
}
/** Minimal lighting state consumed by the analytic cirrus layer. */
export interface CirrusLightingNodes {
    sunTint: Node;
    phaseSun: Node;
    zenithRadiance: Node;
}
export interface BuildCirrusLightingNodesOptions {
    rayDir: Node;
    sun: Sun;
    ambientSky: AmbientSkyBaker;
    enabled?: Node;
}
/** Build only the sun phase and ambient uniforms used by the analytic cirrus layer. */
export declare function buildCirrusLightingNodes(opts: BuildCirrusLightingNodesOptions): CirrusLightingNodes;
/** Build the per-fragment lighting state shared across the march; must run inside an outer TSL `Fn` body. */
export declare function buildCloudLightingNodes(opts: BuildCloudLightingNodesOptions): CloudLightingNodes;
export {};
