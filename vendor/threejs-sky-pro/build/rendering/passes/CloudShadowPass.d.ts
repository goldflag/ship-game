import * as THREE from "three/webgpu";
import type { CloudShadowProjection } from "../../tsl/cloudShadow";
import { Clouds } from "../../state/Clouds";
import { CloudQuality } from "../../state/CloudQuality";
import { Sun } from "../../state/Sun";
import { TimeOfDay } from "../../state/TimeOfDay";
/** Wiring for a {@link CloudShadowPass}. */
export interface CloudShadowPassConfig {
    cloud: Clouds;
    quality: CloudQuality;
    sun: Sun;
    /** Optional time-of-day; when set, the bake follows the moon after sunset. */
    timeOfDay?: TimeOfDay | null;
    /** Weather map (2D): r = coverage height. Same texture the cloud march reads. */
    weatherTexture: THREE.Texture;
    /** Base-shape noise volume (3D). */
    baseShapeTexture: THREE.Data3DTexture;
    /** Compile animated wind/evolution coordinates into the density graph. */
    animatedClouds: boolean;
    /** Shadow-map resolution (square). Default 512. */
    resolution?: number;
    /** Half-width of the footprint (m); map covers a ~`2·extent` world-XZ box centered on the camera. Default 4000. */
    extent?: number;
    /** Ground reference altitude the map is centered on. Default 0 (sea level). */
    groundReferenceY?: number;
    /** Re-bake every N frames. Default 1 (every frame). */
    bakeInterval?: number;
}
/**
 * Cloud shadow baker — marches light transmittance through the shell (same `sampleCloudDensity`
 * field as the primary raymarch) into a low-res top-down texture; scene reads it in one fetch.
 * World-XZ ortho projection; the center/axes/extent uniforms feed `cloudShadowFactor` for
 * receivers. With a `TimeOfDay`, the bake follows the active light — sun by day, moon
 * after sunset — so night scenes get moon shadows and moon god rays get real cloud structure.
 */
export declare class CloudShadowPass {
    readonly target: THREE.RenderTarget;
    readonly texture: THREE.Texture;
    /** World point the map is centered on (camera XZ at the ground altitude). */
    readonly center: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Map U axis — world +X. */
    readonly axisU: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Map V axis — world +Z. */
    readonly axisV: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Half-width of the world-XZ footprint in meters. */
    readonly extent: THREE.UniformNode<"float", number>;
    /** Shadow strength (0 = no shadow, 1 = full). Consumed by `cloudShadowFactor`. */
    readonly intensity: THREE.UniformNode<"float", number>;
    /** Master enable as a shader uniform (1 = on, 0 = off) for `cloudShadowFactor`. */
    readonly enabledUniform: THREE.UniformNode<"float", number>;
    /** Sun-transmittance march step count through the shell. Step length adapts to the in-shell segment. */
    readonly lightSteps: THREE.UniformNode<"float", number>;
    /** Absolute mip level for every noise tap (0 = full detail); raising it softens + cheapens the bake. */
    readonly mipLevel: THREE.UniformNode<"float", number>;
    /** Virtual planet center `(camX, -PLANET_RADIUS, camZ)`, tracked per frame. */
    readonly planetCenter: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Active light direction the bake marches toward — sun by day, moon below `nightThreshold`. */
    readonly lightDir: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Re-bake cadence (frames). */
    bakeInterval: number;
    /** Sun elevation (radians) below which the bake follows the moon. Keep in sync with `GodRaysPass.nightThreshold`. */
    nightThreshold: number;
    private readonly _groundReferenceY;
    private readonly _cloud;
    private readonly _sun;
    private readonly _timeOfDay;
    private readonly _animatedClouds;
    private _weatherTexture;
    private _baseShapeTexture;
    private readonly _material;
    private readonly _scene;
    private _frame;
    private _enabled;
    private _dirty;
    private _lastDensityRevision;
    private _lastCameraX;
    private _lastCameraZ;
    private readonly _lastLightDir;
    private _lastLightSteps;
    private _lastMipLevel;
    private _lastExtent;
    private _lastWeatherTextureVersion;
    private _lastBaseShapeTextureVersion;
    constructor(config: CloudShadowPassConfig);
    /** The world-XZ projection uniforms, for `cloudShadowFactor`. */
    get projection(): CloudShadowProjection;
    /** Current shadow-map resolution (square). */
    get resolution(): number;
    /** Resize the map; keeps the texture object, so the sampler node stays valid. */
    setResolution(n: number): void;
    /** Master enable. `false` skips the bake and drives the `enabled` uniform so receivers read full sun. */
    get enabled(): boolean;
    set enabled(v: boolean);
    /** Swap the base-shape noise texture and recompile; mirrors `CloudMaterial.setNoiseTextures`. */
    setNoiseTextures(textures: {
        baseShape?: THREE.Data3DTexture;
        weather?: THREE.Texture;
    }): void;
    /** Refresh the projection from the camera (centers on camera XZ) and pick the active light; call once per frame before `bake()`. */
    updateFrame(camera: THREE.PerspectiveCamera, densityRevision: number): void;
    /** Bake a dirty shadow map on its configured cadence. */
    bake(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    private _buildColorNode;
}
