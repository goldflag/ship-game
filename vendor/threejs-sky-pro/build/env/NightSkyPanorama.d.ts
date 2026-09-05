import * as THREE from "three/webgpu";
import { TimeOfDay } from "../state/TimeOfDay";
/** Bundled lunar surface map as a base64 data URL. The default for `nightSky.moonTexture`. */
export declare const BUNDLED_MOON_TEXTURE_URL: string;
/** Night-sky settings for `SkySystem.create()`'s `nightSky` option. */
export interface NightSkyPanoramaOptions {
    /**
     * Star panorama, equirectangular and sRGB, as a `THREE.Texture` or a URL. Required —
     * this one is not bundled. Omit the whole `nightSky` config to disable stars; the moon
     * still renders as a flat tinted disc.
     */
    texture: THREE.Texture | string;
    /** Override the bundled lunar surface map. `THREE.Texture` or URL. */
    moonTexture?: THREE.Texture | string;
    /** Sphere radius in world units. Default 90_000; must sit inside the camera far plane. */
    radius?: number;
    /** Initial intensity multiplier on the panorama sample. Default 0.3. */
    intensity?: number;
}
/**
 * Rotating equirectangular star background, faded in by `skyDarkness`.
 *
 * Built from `SkySystem`'s `nightSky` config and reached at `sky.nightSky`.
 */
export declare class NightSkyPanorama {
    /** The background sphere. Added to and removed from the scene by `SkySystem`. */
    readonly mesh: THREE.Mesh;
    /** Brightness multiplier on the sampled texture, calibrated for exposure 1. Default 0.3. */
    readonly intensity: THREE.UniformNode<"float", number>;
    /** Lunar surface map — the bundled one unless `moonTexture` overrode it. @internal */
    readonly moonTexture: THREE.Texture;
    private readonly _material;
    private readonly _timeOfDay;
    private readonly _textureNode;
    private _texture;
    private _textureRevision;
    private _ownsTexture;
    private readonly _ownsMoonTexture;
    /**
     * Load the star panorama and the lunar map, then build the panorama. Anything given as a
     * URL is loaded here and released by {@link dispose}; a `THREE.Texture` passed in stays
     * the caller's to dispose.
     * @internal
     */
    static load(options: NightSkyPanoramaOptions, timeOfDay: TimeOfDay): Promise<NightSkyPanorama>;
    private constructor();
    /** Per-frame visibility cull — hides the mesh in full daylight. */
    updateVisibility(): void;
    /**
     * Swap the star panorama. The outgoing texture is disposed only if this instance owned it.
     * @param ownsNewTexture True to hand ownership of `panoramaTexture` over for disposal.
     */
    setTexture(panoramaTexture: THREE.Texture, ownsNewTexture?: boolean): void;
    /** Monotonic revision for environment bakes that consume the panorama. @internal */
    get textureRevision(): number;
    /** Current Three.js upload version of the bound panorama texture. @internal */
    get textureVersion(): number;
    /** Release the sphere, its material, and any texture this instance loaded. */
    dispose(): void;
    /** Equirect sampling setup: wrap in longitude, clamp at the poles, mip down. */
    private _configureTexture;
    /**
     * Lit star color (linear RGB, TSL vec3) for a world-space direction node. Shared by the
     * background sphere and the env-map bake.
     * @param direction Unit world-space direction node to sample along.
     * @internal
     */
    colorNodeForDirection(direction: any): any;
    private _buildColorNode;
}
