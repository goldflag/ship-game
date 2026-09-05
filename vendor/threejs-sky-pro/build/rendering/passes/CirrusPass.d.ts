import * as THREE from 'three/webgpu';
import { CirrusMaterial } from '../../materials/CirrusMaterial';
import { Atmosphere } from '../../state/Atmosphere';
import { Sun } from '../../state/Sun';
import { Clouds } from '../../state/Clouds';
import { TimeOfDay } from '../../state/TimeOfDay';
import { AmbientSkyBaker } from '../../baking/AmbientSkyBaker';
import { CameraRayBasis } from '../../tsl/screen-ray';
/**
 * Full-resolution cirrus deck drawn as a scene-background mesh. Add `mesh` to the scene right
 * after the sky dome. Needs no per-frame update — it reads the sky pass' view-ray uniforms.
 */
export declare class CirrusPass {
    /** The cirrus material. */
    readonly material: CirrusMaterial;
    /** Backdrop mesh. Add it to your scene. */
    readonly mesh: THREE.Mesh;
    /**
     * @param rayBasis `SkyPass.rayBasis`.
     * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
     * @param weatherTexture weather map (2D) — the same texture the cloud march reads.
     * @param timeOfDay when supplied, adds the moon-key term.
     * @param ambientSky baked ambient-sky terms lighting the deck.
     */
    constructor(atmosphere: Atmosphere, sun: Sun, cloud: Clouds, rayBasis: CameraRayBasis, cameraPositionUniform: any, weatherTexture: THREE.DataTexture, timeOfDay: (TimeOfDay | null) | undefined, ambientSky: AmbientSkyBaker, animatedClouds: boolean);
    /** Set (or clear with `null`) the cirrus mask. */
    setTexture(cirrusTexture: THREE.Texture | null): void;
    dispose(): void;
}
