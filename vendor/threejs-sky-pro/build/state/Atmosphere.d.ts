import * as THREE from 'three';
/**
 * One field per {@link Atmosphere} uniform, minus the `.value`. This is also the shape
 * of a preset's `atmosphere` block.
 */
export interface AtmosphereParams {
    /** Rayleigh scattering multiplier. 1 = physical Earth; higher deepens the blue and reddens a low sun. Default 1. */
    rayleigh: number;
    /** Aerosol / haze amount. 1 = very clear, 10 = heavy haze. Default 3.3. */
    turbidity: number;
    /** Mie forward-scattering asymmetry. Range [0, 0.99]. 0 = isotropic, 0.99 = strongly forward. Default 0.7. */
    mieDirectionalG: number;
    /** Multiplier on the sun's forward aureole. 1 = consistent with `turbidity`. Default 1. */
    mieScatteringStrength: number;
    /** Multi-scatter fill for the sky light reaching the clouds. 0 = single-scatter. Default 0.2. */
    multipleScattering: number;
    /** Sky-dome multi-scatter strength. 0 = single-scatter dome, 1 = nominal. Default 0.5. */
    skyMultipleScattering: number;
    /** Scalar multiply on linear radiance. 1 = neutral. Default 1. */
    exposure: number;
    /** Ground albedo, linear RGB. Tints the sky's multiple-scatter bounce. Default (0.18, 0.17, 0.15). */
    groundAlbedo: THREE.Color;
    /** Distance-fog fade rate. 1 puts the 50%-fogged point near 23 km; 0 disables the fog. Default 1.25. */
    fogDensity: number;
    /** Distance in meters where the far-fade band starts. Default 1,000,000. */
    fogFarFadeStart: number;
    /** Distance in meters where geometry is fully sky. Default 1,100,000. */
    fogFarFadeEnd: number;
}
/**
 * Atmospheric scattering state shared by the sky and the clouds: Rayleigh and Mie
 * coefficients, ground albedo, exposure, and distance fog. Write any field through
 * its `.value`.
 */
export declare class Atmosphere {
    /**
     * Rayleigh (molecular) scattering strength — a multiplier on the sea-level coefficient.
     * 1 = physical Earth; higher deepens the blue sky and reddens a low sun. Default 1.
     */
    readonly rayleigh: import("three/webgpu").UniformNode<"float", number>;
    /** Aerosol / haze amount. 1 = very clear, 10 = heavy haze. Default 3.3. */
    readonly turbidity: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Mie forward-scattering asymmetry for the Henyey-Greenstein phase function.
     * 0 = isotropic, 0.99 = strongly forward. Default 0.7.
     */
    readonly mieDirectionalG: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Multiplier on the Mie single-scatter term — the sun's forward aureole.
     * 1 = consistent with `turbidity`. Default 1.
     */
    readonly mieScatteringStrength: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Multi-scatter fill for the sky light reaching the clouds. 0 = single-scatter,
     * 0.2 typical. Default 0.2.
     */
    readonly multipleScattering: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Sky-dome multi-scatter strength. 0 = single-scatter dome, 1 = nominal.
     * Default 0.5.
     */
    readonly skyMultipleScattering: import("three/webgpu").UniformNode<"float", number>;
    /** Tonemap exposure — a scalar multiply on linear radiance. 1 = neutral. Default 1. */
    readonly exposure: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Lambertian ground albedo (linear RGB) tinting the sky's multiple-scatter bounce and
     * the cloud ground-bounce fill. Roughly (0.12, 0.16, 0.09) for green land, brighter for
     * snow or sand, near-black for water; the whole-Earth land average is about 0.15.
     * Default (0.18, 0.17, 0.15).
     */
    readonly groundAlbedo: import("three/webgpu").UniformNode<"color", THREE.Color>;
    /**
     * Distance-fog fade rate. 1 puts the 50%-fogged point near 23 km; 0 disables the fog.
     * Default 1.25.
     */
    readonly fogDensity: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Camera-to-surface distance (world meters) where the far-fade band starts pulling
     * geometry toward sky. The default sits past any practical scene, so the band is off
     * until you lower it. Default 1,000,000.
     */
    readonly fogFarFadeStart: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Camera-to-surface distance (world meters) where geometry is fully sky. Set it above
     * `fogFarFadeStart`; the span between the two is the ramp. Default 1,100,000.
     */
    readonly fogFarFadeEnd: import("three/webgpu").UniformNode<"float", number>;
    /** @param params Initial values; omitted fields keep their default. */
    constructor(params?: Partial<AtmosphereParams>);
    /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
    applyParams(params: Partial<AtmosphereParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. `groundAlbedo` is
     * cloned, so later writes to this `Atmosphere` don't reach the returned object. Passing
     * the result to {@link applyParams} restores the state it was taken from.
     */
    toParams(): AtmosphereParams;
}
