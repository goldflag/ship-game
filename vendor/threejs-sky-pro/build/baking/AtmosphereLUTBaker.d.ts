import * as THREE from 'three/webgpu';
import { Atmosphere } from '../state/Atmosphere';
/** Transmittance LUT width: the μ (view-cosine) axis. */
export declare const TRANSMITTANCE_LUT_WIDTH = 256;
/** Transmittance LUT height: the altitude axis. */
export declare const TRANSMITTANCE_LUT_HEIGHT = 64;
/** Multiple-scattering LUT edge length; square, μ_sun by altitude. */
export declare const MULTI_SCATTER_LUT_SIZE = 32;
/**
 * Owns both precomputed 2D atmosphere LUTs: transmittance `T(h, μ)` and multiple-scattering
 * `MS(h, μ_sun)`, the latter baked off the former. Re-bake whenever the atmosphere's medium
 * changes.
 *
 * Both are indexed `U = (μ + 1) / 2`, `V = h / 100` with `h` in km, sampled linearly.
 */
export declare class AtmosphereLUTBaker {
    /** Transmittance LUT target. */
    readonly target: THREE.RenderTarget;
    /** Transmittance LUT texture, sampled by the sky, fog, and cloud lighting. */
    readonly texture: THREE.Texture;
    /** Multiple-scattering LUT target. */
    readonly multiScatterTarget: THREE.RenderTarget;
    /** Multiple-scattering LUT texture, sampled alongside {@link texture}. */
    readonly multiScatterTexture: THREE.Texture;
    private readonly _atmosphere;
    private readonly _material;
    private readonly _scene;
    private readonly _msMaterial;
    private readonly _msScene;
    private _lastBakedRayleigh;
    private _lastBakedTurbidity;
    private readonly _lastBakedGroundAlbedo;
    private _needsBake;
    constructor(atmosphere: Atmosphere);
    /** Call once per frame before the sky pass. Cheap no-op when not dirty. */
    update(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    private _bake;
    private _buildTransmittanceColorNode;
    /** Multiple-scattering LUT integrand: second-order in-scatter times an energy-conserving boost 1/(1−f), where f is the fraction re-scattered per bounce. */
    private _buildMultiScatterColorNode;
}
/** h-divisor for building UVs identically in TSL (shared by both LUTs). */
export declare const TRANSMITTANCE_LUT_H_DIVISOR: 100;
