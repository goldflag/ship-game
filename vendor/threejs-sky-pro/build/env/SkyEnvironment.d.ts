import * as THREE from "three/webgpu";
import { Atmosphere } from "../state/Atmosphere";
import { Sun } from "../state/Sun";
import { Clouds } from "../state/Clouds";
import { CloudQuality } from "../state/CloudQuality";
import { TimeOfDay } from "../state/TimeOfDay";
import type { CloudNoiseTextures } from "../noise";
import { NightSkyPanorama } from "./NightSkyPanorama";
import { AmbientSkyBaker } from "../baking/AmbientSkyBaker";
import { CloudInputTracker } from "../rendering/CloudInputTracker";
/** Options for `SkySystem.createEnvironmentMap()`. */
export interface SkyEnvironmentOptions {
    /** Bake width in pixels. Default `384`. */
    width?: number;
    /** Bake height in pixels. Default `width / 2` (equirect is 2:1). */
    height?: number;
    /** Bake clouds in addition to the sky dome. Default `true`. */
    includeClouds?: boolean;
    /** Cloud raymarch step budget for the bake. Default `16`. */
    cloudMarchSteps?: number;
    /** Noise mip floor for the bake. Higher is blurrier and cheaper. Default `0`. */
    cloudMipBase?: number;
    /** World-space point the sky is sampled from. Default `(0, 0, 0)`. */
    origin?: THREE.Vector3;
    /** Frames to skip between volumetric-cloud raymarches. Range [0, 8]. Default `4`. */
    skipFrames?: number;
    /** Populate the texture during construction. Set `false` to defer the first bake until `update()` or `bakeAll()`. Default `true`. */
    initialBake?: boolean;
}
/**
 * Everything a `SkyEnvironment` binds to, on top of {@link SkyEnvironmentOptions}.
 * @internal
 */
export interface SkyEnvironmentConfig extends SkyEnvironmentOptions {
    renderer: THREE.WebGPURenderer;
    atmosphere: Atmosphere;
    sun: Sun;
    clouds: Clouds;
    noiseTextures: CloudNoiseTextures;
    /** Shared 2D transmittance LUT; read, never baked here. */
    transmittanceLUT: THREE.Texture;
    /** Shared 2D multiple-scattering LUT; read, never baked here. */
    multiScatterLUT: THREE.Texture;
    /** Shared angular sky-radiance LUT; read, never baked here. */
    skyViewLUT: THREE.Texture;
    /** Refresh shared atmosphere/sky caches immediately before this environment renders. */
    prepareBake: () => void;
    /** Compile animated wind/evolution coordinates into cloud sampling graphs. */
    animatedClouds: boolean;
    /** Shared allocation-free revisions for directly mutable cloud state. */
    cloudInputTracker: CloudInputTracker;
    /** Time-of-day driving the moon disc and moonlit ambient/key. */
    timeOfDay?: TimeOfDay | null;
    /** Lunar surface texture for the moon disc. */
    moonTexture?: THREE.Texture | null;
    /** Night-sky panorama; its stars bake additively when present. */
    nightSky?: NightSkyPanorama | null;
}
/**
 * Live-baked sky environment map: a 2D RGBA16F equirectangular (lat-long) texture
 * that tracks the sky, sun, and clouds it was built from.
 *
 * Build one with `SkySystem.createEnvironmentMap()`. Call {@link update} once per
 * frame and read {@link texture}.
 */
export declare class SkyEnvironment {
    /**
     * The baked equirectangular texture. Assign it as-is to `scene.environment`, a
     * `pmremTexture` sampler, or a raw TSL `texture()` read via `equirectUVFromDir`.
     * Reassigned by {@link setResolution} — rebind any sampler holding the old
     * reference after a resize.
     */
    texture: THREE.Texture;
    /** Cloud raymarch knobs for the bake, independent of the on-screen cloud quality. */
    readonly bakeQuality: CloudQuality;
    /** Per-frame bake gate. `false` ⇒ {@link update} is a no-op; {@link bakeAll} ignores this. */
    enabled: boolean;
    /** Render the cloud composite on top of the sky dome. */
    bakeClouds: boolean;
    /** Render the night-sky stars into the bake. No-op when built without a night sky. */
    bakeNightSky: boolean;
    /** Render the sky dome into the bake. */
    bakeAtmosphere: boolean;
    /** Bake width in pixels. Set via {@link setResolution}. */
    get width(): number;
    /** Bake height in pixels. Set via {@link setResolution}. */
    get height(): number;
    /** Bumped after each rendered environment frame. Compare against a last-seen value to detect a fresh frame. */
    get bakeVersion(): number;
    /** Number of {@link update} calls skipped between volumetric-cloud raymarches. Clamped to [0, 8]. */
    get skipFrames(): number;
    set skipFrames(v: number);
    private readonly _renderer;
    private readonly _atmosphere;
    private readonly _sun;
    private readonly _clouds;
    private readonly _cloudInputTracker;
    private readonly _prepareBake;
    private readonly _origin;
    private readonly _rayOriginUniform;
    private _target;
    private _width;
    private _height;
    private _skipFrames;
    private _updateCounter;
    private _bakeVersion;
    private readonly _skyMaterial;
    private readonly _skyScene;
    private readonly _cloudMaterial;
    private readonly _cloudScene;
    private readonly _cloudTarget;
    private readonly _cloudCompositeMaterial;
    private readonly _cloudCompositeScene;
    private readonly _cirrusMaterial;
    private readonly _cirrusScene;
    private _cirrusTexture;
    private _cumulusDirty;
    private _compositionDirty;
    private _lastCloudLayersEnabled;
    private readonly _lastCirrusWindOffset;
    private readonly _ambientSky;
    private readonly _environmentSnapshot;
    private readonly _qualitySnapshot;
    private readonly _compositionSnapshot;
    private _lastDensityRevision;
    private _lastLightingRevision;
    private _lastLayerRevision;
    private readonly _timeOfDay;
    private readonly _nightSky;
    private readonly _nightScene;
    private readonly _nightMaterial;
    private readonly _prevClearColor;
    constructor(config: SkyEnvironmentConfig, ambientSky: AmbientSkyBaker);
    /** Set (or clear with `null`) the cirrus-deck mask used by the bake. */
    setCirrusTexture(texture: THREE.Texture | null): void;
    /**
     * Rebind the bake's cloud-noise textures. Call before disposing the outgoing texture.
     * @internal
     */
    setNoiseTextures(textures: {
        baseShape?: THREE.Data3DTexture;
        weather?: THREE.DataTexture;
    }): void;
    /** World-space point the sky is sampled from. Read-only view; write via {@link setOrigin}. */
    get origin(): Readonly<THREE.Vector3>;
    /** Move the sample point. Usually pinned to the reflective surface or the camera. */
    setOrigin(v: THREE.Vector3): void;
    /**
     * Resize the bake. Replaces {@link texture} — rebind any sampler holding the old
     * reference before the next render.
     * @param height defaults to `width / 2` (equirect is 2:1).
     */
    setResolution(width: number, height?: number): void;
    /** Per-frame tick. Dirty cumulus follows {@link skipFrames}; clean inputs render nothing. */
    update(): void;
    /**
     * Bake synchronously, ignoring {@link skipFrames} and {@link enabled}. Use after a
     * preset load or a large sun jump to refresh immediately.
     */
    bakeAll(): void;
    /** Compare all live bake inputs without allocating per-frame snapshots. */
    private _syncInputDirtiness;
    private _renderEnvironment;
    /**
     * Clear {@link texture} to opaque black. Use after disabling the bake so consumers
     * stop sampling the last baked frame.
     */
    clearTexture(): void;
    /** Release the render target and the bake's materials. */
    dispose(): void;
    private _makeTarget;
}
