import * as THREE from 'three/webgpu';
import { type WeatherMapProfile } from './noiseProfiles';
/** Values for {@link WeatherMap.applyParams}. */
export interface WeatherMapParams {
    /** Weather-map edge length, pixels (square). */
    resolution: number;
    /** FBM profile for the coverage map. */
    profile: WeatherMapProfile;
}
/**
 * Procedural weather map driving cloud placement: a CPU-generated 2D R8 coverage texture.
 * Linear color space, repeat-wrapped, linear-filtered.
 *
 * {@link texture} keeps its JS identity across re-fills, so bound materials never need
 * rebinding. Mutate {@link profile} then call {@link regenerate}, or replace resolution and
 * profile together with {@link applyParams}.
 */
export declare class WeatherMap {
    /** The live texture. Stable across re-fills. */
    readonly texture: THREE.DataTexture;
    /** Generation profile. Mutate in place, then call {@link regenerate}. */
    readonly profile: WeatherMapProfile;
    private _resolution;
    /**
     * @param resolution Edge length in texels.
     * @param profile Generation profile; deep-copied, so later mutation of the argument
     *   doesn't reach this map.
     */
    constructor(resolution?: number, profile?: WeatherMapProfile);
    /** Edge length of the live map, in texels. */
    get resolution(): number;
    /** Re-fill at `size`. No-op when the map is already that size. */
    setResolution(size: number): void;
    /** Adopt `params` wholesale — profile is deep-copied — then re-fill once. */
    applyParams(params: WeatherMapParams): void;
    /**
     * Reads the current resolution and profile back as params. Inverse of
     * {@link applyParams}. The profile is deep-copied, so later mutation of the live
     * map doesn't reach the returned value.
     */
    toParams(): WeatherMapParams;
    /** Re-fill the texture from the current resolution and profile. */
    regenerate(): void;
    dispose(): void;
}
