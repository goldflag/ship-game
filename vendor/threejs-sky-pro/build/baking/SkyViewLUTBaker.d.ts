import * as THREE from "three/webgpu";
import { Atmosphere } from "../state/Atmosphere";
import { Sun } from "../state/Sun";
/** Angular sky-view resolution: relative sun azimuth × view elevation. */
export declare const SKY_VIEW_LUT_WIDTH = 200;
export declare const SKY_VIEW_LUT_HEIGHT = 100;
/**
 * Dirty-updated angular sky-radiance cache. It stores raw atmospheric radiance only;
 * screen-space consumers retain analytic sun/moon discs and multiply by live sun intensity.
 * Camera rotation and sun azimuth do not invalidate it because directions are stored relative
 * to the sun in a rotationally symmetric atmosphere.
 */
export declare class SkyViewLUTBaker {
    readonly target: THREE.RenderTarget;
    readonly texture: THREE.Texture;
    private readonly _atmosphere;
    private readonly _sun;
    private readonly _material;
    private readonly _scene;
    private _lastSunY;
    private _lastRayleigh;
    private _lastTurbidity;
    private _lastMieG;
    private _lastMieStrength;
    private _lastSkyMultipleScattering;
    private readonly _lastGroundAlbedo;
    constructor(atmosphere: Atmosphere, sun: Sun, transmittanceLUT: THREE.Texture, multiScatterLUT: THREE.Texture);
    /** Bake when sun elevation or any radiance-producing atmosphere input changes. */
    update(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
}
