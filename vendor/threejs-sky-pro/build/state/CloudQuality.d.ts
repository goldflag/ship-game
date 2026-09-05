/**
 * Initial values for {@link CloudQuality} — step sizes, tap counts, and level-of-detail
 * bias. These trade render cost against quality; they are not physical constants.
 * Omitted fields keep their default.
 */
export interface CloudMarchParams {
    /** View-ray march sample cap. Default 128. */
    maxSteps?: number;
    /** Sunward light-march tap count. Changing it recompiles the shader. Default 6. */
    lightMarchTaps?: number;
    /** Base light-march step in meters; steps grow geometrically. Default 400. */
    lightStepSize?: number;
    /** Tangent of the light-cone half-angle. 0 = straight march. Default 0.05. */
    lightConeSpread?: number;
    /**
     * Accumulated cloud alpha at which sun/moon cone marches switch to cheap
     * base-shape density. Range [0, 1]. 0 = always cheap, 1 = always full. Default 0.3.
     */
    fullLightingAlpha?: number;
    /** Base view-ray step in meters. Default 150. */
    baseStepSize?: number;
    /** Distance-based step growth. 0 = off. Default 1. */
    stepConeFactor?: number;
    /** Optical-depth cap per in-cloud step. Smaller = finer and slower. Default 0.5. */
    maxOpticalDepthPerStep?: number;
    /** Additive level-of-detail bias on the cone footprint. Default 0. */
    mipBaseLevel?: number;
    /** Texel count per axis of the bound base-shape volume. */
    baseShapeResolution?: number;
    /** Ray-start dither strength. Range [0, 1]. 0 = off. Default 1. */
    ditherStrength?: number;
}
/**
 * Cost knobs for one cloud raymarch. Each `CloudMaterial` carries its own instance.
 * Write the uniform fields through `.value`.
 */
export declare class CloudQuality {
    /** View-ray march sample cap. Default 128. */
    readonly maxSteps: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Tap count for the sunward cone that produces the self-shadow. A plain number, read
     * when the shader is built — changing it recompiles. Default 6.
     */
    lightMarchTaps: number;
    /**
     * Base step of the sunward light march, in meters. Steps grow geometrically by 1.5x,
     * so total reach is about 21x this value. Default 400.
     */
    readonly lightStepSize: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Tangent of the light-cone half-angle. The sampling disc widens with march distance,
     * softening the self-shadow. 0 = straight march. Default 0.05.
     */
    readonly lightConeSpread: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Accumulated cloud alpha at which light-cone marches stop sampling erosion
     * detail and use base-shape-only density. Range [0, 1]. Default 0.3.
     */
    readonly fullLightingAlpha: import("three/webgpu").UniformNode<"float", number>;
    /** Base view-ray step in meters, and the floor for the distance-based stride. Default 150. */
    readonly baseStepSize: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Distance-based step growth: the stride is `stepConeFactor × stepConeAngle × distance`,
     * floored at `baseStepSize`. 0 = off. Default 1.
     */
    readonly stepConeFactor: import("three/webgpu").UniformNode<"float", number>;
    /** Ray-cone angle of the reconstruction grid, written each frame. Not saved in snapshots. */
    readonly stepConeAngle: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Cap on optical depth per in-cloud step, used to adapt sampling to density. Smaller =
     * finer and slower. Default 0.5.
     */
    readonly maxOpticalDepthPerStep: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Early-exit threshold: the march stops once transmittance falls below this. A plain
     * number, read when the shader is built. Default 0.001.
     */
    earlyExitTransmittance: number;
    /**
     * Additive level-of-detail bias on the cone-footprint lookup. Raise it to sample
     * coarser mips for a cheaper, blurrier march. Default 0.
     */
    readonly mipBaseLevel: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Texel count per axis of the bound base-shape volume; the cone footprint's world-texel
     * size is `baseScale / this`. Kept in sync with the bound texture by
     * `SkySystem.setBaseNoiseTextures`.
     */
    readonly baseShapeResolution: import("three/webgpu").UniformNode<"float", number>;
    /** Per-pixel ray-cone angle (`2·tan(fov/2)/screenHeight`), written each frame. Not saved in snapshots. */
    readonly pixelConeAngle: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Ray-start dither: the fraction of the entry step added to the first sample, which
     * breaks march banding into noise. Range [0, 1]. 0 = off. Default 1.
     */
    readonly ditherStrength: import("three/webgpu").UniformNode<"float", number>;
    /** Per-frame scroll of the dither tile, written each frame. Not saved in snapshots. */
    readonly ditherTemporalPhase: import("three/webgpu").UniformNode<"float", number>;
    /** @param params Initial values; omitted fields keep their default. */
    constructor(params?: CloudMarchParams);
    /**
     * Writes each provided field onto its uniform, clamping to its valid range. Omitted
     * fields are left untouched.
     */
    applyParams(params: CloudMarchParams): void;
    /**
     * Returns a new params object holding every march setting's current value. Passing the
     * result to {@link applyParams} restores the state it was taken from.
     */
    toParams(): Required<CloudMarchParams>;
}
