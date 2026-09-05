/**
 * One field per {@link GodRays} setting. This is also the shape of a preset's `godRays`
 * block. There is no `steps` field: the quality level sets the march budget. Write
 * `godRays.steps.value` to override it.
 */
export interface GodRaysParams {
    /** Whether god rays render. Default true. */
    enabled: boolean;
    /** Master brightness on shaft radiance. Default 2. */
    strength: number;
    /** Contrast on sun visibility. 1 = raw, higher = crisper shafts. Default 2. */
    sharpness: number;
    /** Haze extinction in 1/meters. Higher = shorter, denser shafts. Default 0.0002. */
    extinction: number;
    /** Far bound of the march in meters. Default 12,500. */
    maxDistance: number;
    /** Shaft brightness multiplier while the moon is the light source. Default 0.4. */
    moonGodRayScale: number;
}
/** Volumetric light-shaft ("god ray") state. Write the uniform fields through `.value`. */
export declare class GodRays {
    /** Whether god rays render. Default true. */
    enabled: boolean;
    /** Shaft brightness multiplier applied while the moon is the active light. Default 0.4. */
    moonGodRayScale: number;
    /** Master brightness on in-scattered shaft radiance, in linear pre-exposure space. Default 2. */
    readonly strength: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Contrast (gamma) applied to sun visibility before in-scatter. 1 = raw, above 1 gives
     * crisper shafts. Default 2.
     */
    readonly sharpness: import("three/webgpu").UniformNode<"float", number>;
    /** Haze extinction in 1/meters. Higher = shorter, denser shafts. Default 0.0002. */
    readonly extinction: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Far bound of the march in meters, for open-sky pixels; pixels covering geometry stop
     * at the surface. Default 12,500.
     */
    readonly maxDistance: import("three/webgpu").UniformNode<"float", number>;
    /** March sample count — the dominant cost knob. Set by the quality level. Default 24. */
    readonly steps: import("three/webgpu").UniformNode<"float", number>;
    /** @param params Initial values; omitted fields keep their default. */
    constructor(params?: Partial<GodRaysParams>);
    /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
    applyParams(params: Partial<GodRaysParams>): void;
    /**
     * Returns a new params object holding every setting's current value, `steps` excluded.
     * Passing the result to {@link applyParams} restores the state it was taken from.
     */
    toParams(): GodRaysParams;
}
