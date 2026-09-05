import * as THREE from 'three';
import { Atmosphere } from '../state/Atmosphere';
import { Sun } from '../state/Sun';
import { CloudLighting } from '../state/Clouds';
/**
 * CPU bake of the cloud-shader ambient fill terms (single-scatter sky integral, isotropic
 * phases). Call `update` once per frame; read the uniforms into a TSL graph.
 */
export declare class AmbientSkyBaker {
    /** Zenith diffuse-fill radiance, linear RGB. Pre-multiplied by sunIntensity. */
    readonly zenithRadiance: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /** Toward-sun horizon diffuse-fill radiance, linear RGB. Pre-multiplied by sunIntensity. */
    readonly horizonRadiance: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /**
     * Ground-bounce upwelling fill on the cloud base, linear RGB. Pre-multiplied by
     * sunIntensity. Driven by the cloud's own ground albedo, not the atmosphere's.
     */
    readonly groundBounceRadiance: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    /** Per-channel sun tint at ground level, [0,1]. NOT pre-multiplied by sunIntensity. */
    readonly sunTransmittance: import("three/webgpu").UniformNode<"vec3", THREE.Vector3>;
    private _lastRayleigh;
    private _lastTurbidity;
    private _lastMultipleScattering;
    private _lastSunIntensity;
    private readonly _lastGroundBounceAlbedo;
    private readonly _lastSunDir;
    private readonly _scratchView;
    private readonly _scratchHorizonDir;
    private readonly _scratchOut;
    private readonly _scratchSkyDiffuse;
    /** Recompute the ambient terms if any input changed. Call once per frame. */
    update(atmosphere: Atmosphere, sun: Sun, cloudLighting: CloudLighting): void;
}
