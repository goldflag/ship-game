import * as THREE from 'three';
/**
 * One field per {@link Sun} setting. This is also the shape of a preset's `sun` block.
 *
 * `elevation` and `azimuth` are the sun's position as angles; there is no `direction`
 * field, because {@link Sun.applyParams} converts the pair into the `direction` vector.
 * `SunDriver` recomputes `direction` from the clock whenever `time`, `latitude`, or the
 * celestial `azimuth` changes, overwriting the angles set here.
 */
export interface SunParams {
    /** Altitude above the horizon, degrees. 0 = horizon, 90 = zenith. */
    elevation: number;
    /** Compass angle, degrees. 0 = +Z, 90 = +X. */
    azimuth: number;
    /** Peak daytime sun radiance — writes `peakIntensity`. Default 6.6. */
    intensity: number;
    /** Sunlight tint at full daylight, linear RGB. Default (1, 0.95, 0.85). */
    color: THREE.Color;
    /** Sun disc angular radius as `1 - cos(θ)`. Default 0.0003. */
    discSize: number;
}
/**
 * Sun state shared by the sky, the clouds, and the god rays. `direction` points toward
 * the sun. Set the daytime brightness with `peakIntensity`; `intensity` is written for
 * you each frame by `SunDriver`.
 */
export declare class Sun {
    /** World-space direction toward the sun. Unit length. */
    readonly direction: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /**
     * Sun radiance for the current frame (`peakIntensity` faded by elevation). Written by
     * `SunDriver` — read it, but set `peakIntensity` instead of writing here.
     */
    readonly intensity: import("three/webgpu").UniformNode<"float", number>;
    /** Peak daytime sun radiance, calibrated for exposure 1. Default 6.6. */
    peakIntensity: number;
    /**
     * Sunlight tint at full daylight, linear RGB. Leave it warm white — the atmosphere
     * produces the sunset reddening on its own. Default (1, 0.95, 0.85).
     */
    readonly color: import("three/webgpu").UniformNode<"color", THREE.Color>;
    /**
     * Sun disc angular radius as `1 - cos(θ)`. The default 0.0003 is a 1.4° radius (a 2.8°
     * disc) — roughly 5× the physical sun's 0.53°, oversized for visual presence.
     */
    readonly discSize: import("three/webgpu").UniformNode<"float", number>;
    /** @param params Initial values; omitted fields keep their default. */
    constructor(params?: Partial<SunParams>);
    /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
    applyParams(params: Partial<SunParams>): void;
    /**
     * Points `direction` at the given angles, in degrees.
     *
     * @param elevationDeg 0 = horizon, 90 = zenith.
     * @param azimuthDeg 0 = +Z, 90 = +X.
     */
    setFromAngles(elevationDeg: number, azimuthDeg: number): void;
    /** Compass azimuth of `direction`, in degrees, range (-180, 180]. Inverse of {@link setFromAngles}. */
    get azimuthDeg(): number;
    /** Altitude of `direction` above the horizon, in degrees, range [-90, 90]. Inverse of {@link setFromAngles}. */
    get elevationDeg(): number;
    /**
     * Returns a new params object holding the sun's current angles, peak intensity, tint,
     * and disc size. `elevation`/`azimuth` are measured off the current `direction`, and
     * `color` is cloned. Passing the result to {@link applyParams} restores the state it
     * was taken from.
     */
    toParams(): SunParams;
}
