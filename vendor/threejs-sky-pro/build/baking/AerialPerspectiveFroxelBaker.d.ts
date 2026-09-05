import * as THREE from "three/webgpu";
import { Atmosphere } from "../state/Atmosphere";
import { Clouds } from "../state/Clouds";
import { Sun } from "../state/Sun";
/**
 * Camera-aligned aerial-perspective volume. The logical 32×18×32 froxel grid is stored in
 * two RGBA16F 2D atlases so the same path works on both WebGPU and Three's WebGL2 fallback:
 * one atlas holds RGB in-scatter, the other RGB transmittance.
 */
export declare class AerialPerspectiveFroxelBaker {
    readonly target: THREE.RenderTarget;
    /** Pass texture nodes carry the dependency that renders a dirty atlas before cloud sampling. */
    readonly inscatterTexture: THREE.TextureNode;
    readonly transmittanceTexture: THREE.TextureNode;
    private readonly _atmosphere;
    private readonly _sun;
    private readonly _clouds;
    private readonly _rayBasis;
    private readonly _maxDistanceKm;
    private readonly _material;
    private readonly _scene;
    private readonly _passNode;
    private readonly _lastCameraQuaternion;
    private _lastFov;
    private _lastAspect;
    private readonly _lastSunDirection;
    private _lastRayleigh;
    private _lastTurbidity;
    private _lastMieG;
    private _lastMieStrength;
    private _lastSkyMultipleScattering;
    private _lastHazeDensityScale;
    private _lastMaxDistanceMeters;
    private readonly _lastGroundAlbedo;
    constructor(atmosphere: Atmosphere, sun: Sun, clouds: Clouds, transmittanceLUT: THREE.Texture, multiScatterLUT: THREE.Texture);
    /** Bake when the camera frame or any atmosphere input changes; static views reuse it. */
    update(camera: THREE.PerspectiveCamera): void;
    dispose(): void;
}
