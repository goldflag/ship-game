import * as THREE from 'three';
/** The `shape` block of a {@link CloudsParams}: one field per {@link CloudShape} uniform. */
export interface CloudShapeParams {
    /** Altitude of the cloud base in meters. Default 1400. */
    altitude: number;
    /** Vertical thickness of the shell in meters. Default 2800. */
    thickness: number;
    /** Extinction coefficient per meter; higher reads more opaque. Default 0.048. */
    density: number;
    /** Coverage. Range [0, 1]: 0 = clear sky, 1 = the full weather map. Default 1. */
    coverage: number;
    /** Distance from the camera in meters where the horizon coverage lift begins. Default 10,000. */
    horizonCoverageStart: number;
    /** Distance in meters over which the lift ramps in past the start. Default 20,000. */
    horizonCoverageRamp: number;
    /** Extra coverage added at full ramp; may exceed 1 to fill gaps. 0 = off. Default 0. */
    horizonCoverageAmount: number;
    /** Soft-edge half-width at the cloud base, as a shell height fraction. Default 0.05. */
    edgeSoftness: number;
    /** Per-kilometer division of `edgeSoftness` above the base. 1 = constant. Default 1. */
    edgeSoftnessFalloff: number;
    /** World meters per weather-map tile. Default 40,000. */
    weatherScale: number;
    /** World meters per base-shape-texture tile. Default 8000. */
    baseScale: number;
    /** Erosion tile as a fraction of `baseScale`. Range [0, 1], lower = finer. Default 0.5. */
    erosionScaleBaseMultiplier: number;
    /** Multiplier across all base-shape channels. 1 = unchanged. Default 1. */
    baseStrength: number;
    /** Erosion strength at shell height fraction 0. Range [0, 5]. Default 1. */
    erosionStrengthBase: number;
    /** Erosion strength at shell height fraction 1. Range [0, 5]. Default 1. */
    erosionStrengthPeak: number;
    /** Erosion shape. 0 = billowy, 1 = wispy. Default 0. */
    erosionShape: number;
    /** Weather-map floor-carve strength. 0 = off. Default 0. */
    baseWeatherStrength: number;
    /** Shell height fraction where the floor carve is strongest. Default 0.05. */
    baseWeatherHeightStart: number;
    /** Shell height fraction above which the floor carve has fully relaxed. Default 0.1. */
    baseWeatherHeightEnd: number;
}
/** The `lighting` block of a {@link CloudsParams}: one field per {@link CloudLighting} uniform. */
export interface CloudLightingParams {
    /** Single-scattering albedo. Range [0, 1]: 0 = black, 1 = lossless. Default 0.9. */
    scatteringAlbedo: number;
    /** Strength of the powder dark-edge term on direct sun light. Default 1. */
    powderStrength: number;
    /** Multiplier on the ground-tinted ambient fill. Default 0.6. */
    ambientIntensity: number;
    /** Albedo of the ground under the clouds, linear RGB. Default (0.18, 0.17, 0.15). */
    groundBounceAlbedo: THREE.Color;
    /** Cloud-base darkening. Range [0, 1]: 0 = lit bases, 1 = full shading. Default 0. */
    baseShadowStrength: number;
    /** Shell height fraction over which the base shadow eases off. Default 0.6. */
    baseShadowHeight: number;
    /** Gain on the moon-key lighting term. Needs a `TimeOfDay` to have any effect. Default 1. */
    moonGain: number;
}
/** The `wind` block of a {@link CloudsParams}: one field per {@link CloudWind} uniform. */
export interface CloudWindParams {
    /** Drift heading in degrees the clouds move toward. 0 = +Z, 90 = +X. Default 0. */
    heading: number;
    /** Horizontal drift speed in meters per second. 0 = static cloud field. Default 0. */
    speed: number;
    /** Noise-evolution speed in meters per second. Churns the cloud shapes in place. Default 0. */
    evolutionSpeed: number;
    /** Downwind cloud-top lean: meters of horizontal shift from shell base to top. Default 0. */
    skew: number;
}
/** The `cirrus` block of a {@link CloudsParams}: one field per {@link CloudCirrus} uniform. */
export interface CloudCirrusParams {
    /** World meters per cirrus-texture tile. Larger = bigger streaks. Default 30,000. */
    scale: number;
    /** Opacity multiplier on the cirrus mask. 0 = off. Default 0. */
    strength: number;
}
/** The `haze` block of a {@link CloudsParams}: one field per {@link CloudHaze} uniform. */
export interface CloudHazeParams {
    /** World meters per weather-map tile sampled for the haze deck. Default 40,000. */
    scale: number;
    /** Opacity multiplier on the weather coverage. 0 = off; high values saturate to opaque. Default 0. */
    density: number;
}
/** The `fade` block of a {@link CloudsParams}: one field per {@link CloudFade} uniform. */
export interface CloudFadeParams {
    /** Aerial-perspective density multiplier. 1 = physical, higher = hazier, 0 = off. Default 1. */
    hazeDensityScale: number;
    /** Hit distance in meters where the horizon melt begins. Default 25,000. */
    horizonMeltStart: number;
    /** Hit distance in meters where the horizon melt completes. Raised to `horizonMeltStart` if lower. Default 40,000. */
    horizonMeltEnd: number;
}
/**
 * The six groups a {@link Clouds} is made of, each holding one field per uniform. This
 * is also the shape of a preset's `cloud` block. `enabled` is not a field here — it is
 * a session toggle, not preset content.
 */
export interface CloudsParams {
    /** Shell geometry. */
    shape: CloudShapeParams;
    /** Scattering and phase. */
    lighting: CloudLightingParams;
    /** Drift and noise evolution. */
    wind: CloudWindParams;
    /** High cirrus deck. */
    cirrus: CloudCirrusParams;
    /** Storm-haze deck. */
    haze: CloudHazeParams;
    /** Aerial perspective and horizon melt. */
    fade: CloudFadeParams;
}
/**
 * A {@link CloudsParams} with every group optional, and every field within a group
 * optional. What {@link Clouds.applyParams} accepts.
 */
export type PartialCloudsParams = {
    [K in keyof CloudsParams]?: Partial<CloudsParams[K]>;
};
/** Geometry of the cloud shell: altitude, thickness, coverage, and the noise that shapes it. */
export declare class CloudShape {
    /** Altitude of the cloud base in meters. Default 1400. */
    readonly altitude: import("three/webgpu").UniformNode<"float", number>;
    /** Vertical thickness of the shell in meters. Default 2800. */
    readonly thickness: import("three/webgpu").UniformNode<"float", number>;
    /** Extinction coefficient per meter; higher reads more opaque. Default 0.048. */
    readonly density: import("three/webgpu").UniformNode<"float", number>;
    /** Coverage. Range [0, 1]: 0 = clear sky, 1 = the weather map as authored. Default 1. */
    readonly coverage: import("three/webgpu").UniformNode<"float", number>;
    /** Distance from the camera in meters where the horizon coverage lift begins. Default 10,000. */
    readonly horizonCoverageStart: import("three/webgpu").UniformNode<"float", number>;
    /** Distance in meters over which the lift ramps from base coverage to full. Default 20,000. */
    readonly horizonCoverageRamp: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Extra coverage added at full ramp. Above 0 this thickens far clouds into a horizon
     * bank and may exceed 1 to fill gaps. 0 = off. Default 0.
     */
    readonly horizonCoverageAmount: import("three/webgpu").UniformNode<"float", number>;
    /** Soft-edge half-width at the cloud base, as a shell height fraction. Default 0.05. */
    readonly edgeSoftness: import("three/webgpu").UniformNode<"float", number>;
    /** Per-kilometer division applied to `edgeSoftness` above the base. 1 = constant softness. Default 1. */
    readonly edgeSoftnessFalloff: import("three/webgpu").UniformNode<"float", number>;
    /** World meters per weather-map tile. Default 40,000. */
    readonly weatherScale: import("three/webgpu").UniformNode<"float", number>;
    /** World meters per base-shape-texture tile. Default 8000. */
    readonly baseScale: import("three/webgpu").UniformNode<"float", number>;
    /** Erosion tile as a fraction of `baseScale`. Range [0, 1], lower = finer. Default 0.5. */
    readonly erosionScaleBaseMultiplier: import("three/webgpu").UniformNode<"float", number>;
    /** Multiplier across all base-shape channels; dilates the top only. 1 = unchanged. Default 1. */
    readonly baseStrength: import("three/webgpu").UniformNode<"float", number>;
    /** Erosion strength at shell height fraction 0. Carves the top and the base. Default 1. */
    readonly erosionStrengthBase: import("three/webgpu").UniformNode<"float", number>;
    /** Erosion strength at shell height fraction 1. Default 1. */
    readonly erosionStrengthPeak: import("three/webgpu").UniformNode<"float", number>;
    /** Erosion shape. 0 = billowy, 1 = wispy. Default 0. */
    readonly erosionShape: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Weather-map floor-carve strength: the coverage a column needs to keep its base, so
     * thin columns lose their base before thick ones do. 0 = off. Default 0.
     */
    readonly baseWeatherStrength: import("three/webgpu").UniformNode<"float", number>;
    /** Shell height fraction where the floor-carve requirement is strongest. Default 0.05. */
    readonly baseWeatherHeightStart: import("three/webgpu").UniformNode<"float", number>;
    /** Shell height fraction above which the floor-carve requirement has fully relaxed. Default 0.1. */
    readonly baseWeatherHeightEnd: import("three/webgpu").UniformNode<"float", number>;
    /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
    applyParams(params: Partial<CloudShapeParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. Passing the result
     * to {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudShapeParams;
}
/** Cloud lighting: scattering albedo, powder dark-edge, ground-tinted ambient, and moon key. */
export declare class CloudLighting {
    /** Single-scattering albedo — scales scattered radiance. Range [0, 1]. Default 0.9. */
    readonly scatteringAlbedo: import("three/webgpu").UniformNode<"float", number>;
    /** Powder dark-edge strength on the direct sun term. Default 1. */
    readonly powderStrength: import("three/webgpu").UniformNode<"float", number>;
    /** Ground-tinted ambient multiplier. Default 0.6. */
    readonly ambientIntensity: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Albedo of the ground directly under the clouds (linear RGB), tinting the base bounce
     * fill. Set it to art-direct the cloud-base color; `Atmosphere.groundAlbedo` is the
     * separate knob for the sky. Default (0.18, 0.17, 0.15).
     */
    readonly groundBounceAlbedo: import("three/webgpu").UniformNode<"color", THREE.Color>;
    /** Cloud-base darkening. Range [0, 1]: 0 = lit bases, 1 = full shading down to the floor. Default 0. */
    readonly baseShadowStrength: import("three/webgpu").UniformNode<"float", number>;
    /** Shell height fraction over which the base shadow eases back to full light. Bigger = softer. Default 0.6. */
    readonly baseShadowHeight: import("three/webgpu").UniformNode<"float", number>;
    /** Moon-key lighting gain. Default 1. */
    readonly moonGain: import("three/webgpu").UniformNode<"float", number>;
    /** Writes each provided field onto its uniform. Omitted fields are left untouched. */
    applyParams(params: Partial<CloudLightingParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. Passing the result
     * to {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudLightingParams;
}
/**
 * Wind drift and noise evolution. Call `advance(dt)` once per frame to integrate the
 * horizontal drift and the evolution scroll.
 */
export declare class CloudWind {
    /** Drift heading in degrees. 0 = +Z, 90 = +X. Default 0. */
    heading: number;
    /** Horizontal drift speed in meters per second. Default 0. */
    speed: number;
    /** Noise-evolution speed in meters per second, scrolled opposite the drift. Default 0. */
    evolutionSpeed: number;
    /** Downwind cloud-top lean: meters of horizontal shift from base to top. Default 0. */
    readonly skew: import("three/webgpu").UniformNode<"float", number>;
    /** Unit horizontal drift direction. Refreshed from `heading` on each `advance`. */
    readonly direction: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /** Accumulated horizontal world offset in meters. */
    readonly offset: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /** Accumulated evolution-scroll distance in meters, applied against `direction`. */
    readonly evolutionOffset: import("three/webgpu").UniformNode<"float", number>;
    /**
     * Advances the animated offsets. Call once per frame.
     *
     * @param dt Elapsed time in seconds.
     */
    advance(dt: number): void;
    /** Writes each provided field. Omitted fields are left untouched. */
    applyParams(params: Partial<CloudWindParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. The integrated
     * drift offsets are animation state and are excluded, so the result describes the wind,
     * not how far the clouds have travelled. Passing it to {@link applyParams} restores the
     * state it was taken from.
     */
    toParams(): CloudWindParams;
}
/** High thin-cloud deck — a flat 2D layer above the volumetric shell. */
export declare class CloudCirrus {
    /** World meters per cirrus-texture tile. Larger = bigger streaks. Default 30,000. */
    readonly scale: import("three/webgpu").UniformNode<"float", number>;
    /** Opacity multiplier on the sampled mask. 0 = off. Default 0. */
    readonly strength: import("three/webgpu").UniformNode<"float", number>;
    /** Writes each provided field onto its uniform, clamping `scale` to at least 1. */
    applyParams(params: Partial<CloudCirrusParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. Passing the result
     * to {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudCirrusParams;
}
/**
 * Storm-haze deck. Shares the cirrus deck's shell and drift, but is driven by the weather
 * map's coverage, so it thickens wherever the clouds below do and can saturate to opaque.
 */
export declare class CloudHaze {
    /** World meters per weather-map tile sampled for the haze deck. Default 40,000. */
    readonly scale: import("three/webgpu").UniformNode<"float", number>;
    /** Opacity multiplier on the sampled weather coverage. 0 = off. Default 0. */
    readonly density: import("three/webgpu").UniformNode<"float", number>;
    /** Writes each provided field onto its uniform, clamping `scale` to at least 1. */
    applyParams(params: Partial<CloudHazeParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. Passing the result
     * to {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudHazeParams;
}
/** Atmospheric fade: aerial perspective on the camera-to-cloud ray, and the far-field dissolve into sky. */
export declare class CloudFade {
    /** Aerial-perspective density multiplier. 1 = physical, higher = hazier, 0 = off. Default 1. */
    readonly hazeDensityScale: import("three/webgpu").UniformNode<"float", number>;
    /** Hit distance in meters where the far field starts dissolving into sky. Default 25,000. */
    readonly horizonMeltStart: import("three/webgpu").UniformNode<"float", number>;
    /** Hit distance in meters where the dissolve completes. Kept at or above `horizonMeltStart`. Default 40,000. */
    readonly horizonMeltEnd: import("three/webgpu").UniformNode<"float", number>;
    /** View-ray march cap in meters. Not settable directly — raise `horizonMeltEnd` instead. */
    readonly maxMarchDist: import("three/webgpu").Node<"float">;
    /** Writes each provided field onto its uniform, then raises `horizonMeltEnd` to `horizonMeltStart` if it fell below. */
    applyParams(params: Partial<CloudFadeParams>): void;
    /**
     * Returns a new params object holding every uniform's current value. `maxMarchDist` is
     * excluded because {@link applyParams} recomputes it from `horizonMeltEnd`. Passing the
     * result to {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudFadeParams;
}
/** Cloud state: shell geometry, lighting, wind, the cirrus and haze decks, and the distance fade. */
export declare class Clouds {
    /** Shell geometry — altitude, thickness, coverage, and shaping noise. */
    readonly shape: CloudShape;
    /** Scattering, powder, ambient fill, and the moon key. */
    readonly lighting: CloudLighting;
    /** Drift and noise evolution. Its `advance(dt)` is called for you each frame. */
    readonly wind: CloudWind;
    /** High thin-cloud deck. */
    readonly cirrus: CloudCirrus;
    /** Storm-haze deck. */
    readonly haze: CloudHaze;
    /** Aerial perspective and the horizon melt. */
    readonly fade: CloudFade;
    /**
     * Master switch for the cloud layer: the raymarch, the reconstruction, and the ground
     * shadow bake. Set it to `false` to drop clouds from the view and stop paying for them
     * when nothing on screen shows cloud; re-enabling costs a short warm-up. `applyParams`
     * never touches it, so loading a preset cannot turn clouds on or off. Default true.
     */
    enabled: boolean;
    /** @param params Initial values; omitted groups keep their defaults. */
    constructor(params?: PartialCloudsParams);
    /** Applies each provided group to its component. Omitted groups are left untouched. */
    applyParams(params: PartialCloudsParams): void;
    /**
     * Returns a new params object holding all six groups' current values. `enabled` is not
     * included, matching {@link applyParams} never writing it. Passing the result to
     * {@link applyParams} restores the state it was taken from.
     */
    toParams(): CloudsParams;
}
