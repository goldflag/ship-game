import * as THREE from 'three';
/** The `moon` block of a {@link TimeOfDayParams}: one field per moon uniform. */
export interface MoonParams {
    /** Moon phase. 0 = new (dark), 0.5 = full, 1 = new again. Default 0.5. */
    phase: number;
    /** Master brightness over disc, cloud key, and sky ambient. Default 1. */
    intensity: number;
    /** Disc-only brightness, stacking on `intensity`. Default 9. */
    discBrightness: number;
    /** Moon angular radius as `1 - cos(theta)`. Default 0.0003. */
    angularSize: number;
    /** Tint for disc, sky ambient, and cloud key. Linear RGB. Default (0.7, 0.78, 0.95). */
    color: THREE.Color;
    /** Gain on the night-sky ambient lift. Range [0, 1]. Default 0.015. */
    ambient: number;
}
/**
 * One field per {@link TimeOfDay} setting. This is also the shape of a preset's `time`
 * block.
 */
export interface TimeOfDayParams {
    /** Sun clock. 0 = midnight, 0.5 = noon. Wrapped to [0, 1). Default 0.5. */
    time: number;
    /** Real seconds per simulated day. 0 = paused. Default 600. */
    autoAdvanceSecondsPerDay: number;
    /** Observer latitude in degrees, clamped to [-90, 90]. Default 45. */
    latitude: number;
    /** Compass rotation of the celestial sphere about +Y, in degrees. Default 0. */
    azimuth: number;
    /** Moon appearance. */
    moon: MoonParams;
}
/**
 * A {@link TimeOfDayParams} with every field optional, including the fields inside
 * `moon`. What {@link TimeOfDay.applyParams} accepts.
 */
export type PartialTimeOfDayParams = Partial<Omit<TimeOfDayParams, 'moon'>> & {
    moon?: Partial<MoonParams>;
};
/**
 * Time-of-day clock and moon state. Drives the sun and moon arcs through `SunDriver`,
 * and the moon's appearance. Write the uniform fields through `.value`.
 */
export declare class TimeOfDay {
    /** Sun clock. 0 = midnight, 0.5 = noon. Default 0.5. Write it directly to jump to a time. */
    readonly time: import("three/webgpu").UniformNode<"float", number>;
    /** Real seconds per simulated day. 0 = paused. Default 600. */
    autoAdvanceSecondsPerDay: number;
    /**
     * Observer latitude in degrees, range [-90, 90]. Places the celestial pole this many
     * degrees above the northern horizon, tilting the sun and moon arcs and the star
     * rotation axis. 0 = equator (sun passes through the zenith), 90 = north pole.
     * Default 45.
     */
    latitude: number;
    /**
     * Compass rotation of the whole celestial sphere — sun path, moon, and stars together —
     * about +Y, in degrees. Same convention as `Sun.setFromAngles`: 0 has the sun culminate
     * toward -Z, 90 rotates the sky toward +X. Default 0.
     */
    azimuth: number;
    /** World-space unit vector toward the moon. Written by `SunDriver` from `time` and `moonPhase`. */
    readonly moonDirection: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /** Moon phase. 0 = new (dark), 0.5 = full, 1 = new again. Default 0.5. */
    readonly moonPhase: import("three/webgpu").UniformNode<"float", number>;
    /** Master moon brightness over disc, sky lift, and cloud key. Default 1. */
    readonly moonIntensity: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Disc-only brightness, stacking on `moonIntensity`. The default 9 keeps the disc
     * visible through the tonemap at exposure 1.
     */
    readonly moonDiscBrightness: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Moon angular radius expressed as `1 - cos(theta)`. The default 0.0003 is a
     * 1.4-degree radius (a 2.8-degree disc), about 5x the physical moon and matching
     * `Sun.discSize`.
     */
    readonly moonAngularSize: import("three/webgpu").UniformNode<"float", number>;
    /** Tint shared by disc, ambient, and cloud key. Linear RGB. Default (0.7, 0.78, 0.95) — cool blue-white. */
    readonly moonColor: import("three/webgpu").UniformNode<"color", THREE.Color>;
    /** Scale on the night-sky ambient lift. 0 = pitch-black sky. Default 0.015. */
    readonly moonAmbient: import("three/webgpu").UniformNode<"float", number>;
    /** 0 = full day, 1 = full night, crossfading across the twilight band at ±6 degrees of sun elevation. */
    readonly skyDarkness: import("three/webgpu").UniformNode<"float", number>;
    /**
     * World-to-panorama rotation for the star panorama. Undoes the celestial-sphere
     * placement — diurnal spin about the pole, pole tilt from `latitude`, then `azimuth` —
     * so a view direction can sample the equatorial-frame texture.
     */
    readonly starRotation: import("three/webgpu").UniformNode<"mat3", THREE.Matrix3>;
    /** Lit fraction of the moon disc, `1 - |2·moonPhase - 1|`, floored. Scales the earthshine terms. */
    readonly moonPhaseIllumination: import("three/webgpu").UniformNode<"float", number>;
    /** `(cos(psi), sin(psi))` for `psi = (moonPhase - 0.5)·2π`. The default matches a full moon. */
    readonly moonPhaseTrig: import("three/webgpu").UniformNode<"vec2", THREE.Vector2>;
    /** @param params Initial values; omitted fields keep their default. */
    constructor(params?: PartialTimeOfDayParams);
    /**
     * Writes each provided field onto its uniform, wrapping `time` and clamping `latitude`.
     * Omitted fields are left untouched.
     */
    applyParams(params: PartialTimeOfDayParams): void;
    /**
     * Returns a new params object holding the clock, the arc placement, and the moon's
     * current values. `moon.color` is cloned. Passing the result to {@link applyParams}
     * restores the state it was taken from.
     */
    toParams(): TimeOfDayParams;
}
