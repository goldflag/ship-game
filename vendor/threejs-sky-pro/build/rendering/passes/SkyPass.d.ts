import * as THREE from 'three/webgpu';
import { SkyMaterial } from '../../materials/SkyMaterial';
import { Atmosphere } from '../../state/Atmosphere';
import { Sun } from '../../state/Sun';
import { TimeOfDay } from '../../state/TimeOfDay';
import { CameraRayBasis } from '../../tsl/screen-ray';
/** Construction inputs for {@link SkyPass}. */
export interface SkyPassOptions {
    /** 2D transmittance LUT (`AtmosphereLUTBaker`), read once per view-ray sample. */
    transmittanceLUT: THREE.Texture;
    /** 2D multiple-scattering LUT (`AtmosphereLUTBaker`), read once per view-ray sample. */
    multiScatterLUT: THREE.Texture;
    /** Shared angular sky radiance. Null compiles the original per-pixel integrator. */
    skyViewLUT: THREE.Texture | null;
    /** When supplied, adds the moon disc + ambient sky lift. */
    timeOfDay?: TimeOfDay | null;
    /** Moon texture for the moon-disc shader. */
    moonTexture?: THREE.Texture | null;
}
/** Renders the atmospheric-scattering sky. Owns the backdrop mesh, `SkyMaterial`, and the per-frame view-ray uniforms. */
export declare class SkyPass {
    /** The sky material. Its uniforms track the `Atmosphere` and `Sun` passed in. */
    readonly material: SkyMaterial;
    /** Backdrop mesh. Add it to your scene. */
    readonly mesh: THREE.Mesh;
    /** The sun state this pass renders. */
    readonly sun: Sun;
    /** Camera axes every view ray is built from. Written each frame. */
    readonly rayBasis: CameraRayBasis;
    /** User-camera world position. Written each frame by `SkyRenderPipeline.updateFrame`. */
    readonly cameraPositionUniform: THREE.UniformNode<"vec3", THREE.Vector3>;
    /**
     * @param atmosphere atmosphere state driving the scattering march.
     * @param sun sun state; also the target of {@link setSunPosition}.
     */
    constructor(atmosphere: Atmosphere, sun: Sun, options: SkyPassOptions);
    /**
     * Set sun direction from azimuth (radians, 0 = +Z) and elevation (radians, 0 = horizon).
     *
     * @param azimuth radians, 0 = +Z.
     * @param elevation radians, 0 = horizon.
     */
    setSunPosition(azimuth: number, elevation: number): void;
    dispose(): void;
}
