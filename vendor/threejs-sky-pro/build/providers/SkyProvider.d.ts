import * as THREE from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import type { SkySystem } from "../SkySystem";
import { SkyEnvironment } from "../env/SkyEnvironment";
/**
 * Fulfills `threejs-water-pro`'s `SkyProvider` contract. Publishes a `SkyEnvironment`'s
 * equirect bake as the environment — the single source for `getEnvironmentTexture()` and
 * the reflection sampler. Falls back to its own clouds-off bake when the caller supplies
 * none.
 */
export declare class SkyProvider {
    private readonly sys;
    private readonly _skyColorLUT;
    private readonly _envMap;
    private readonly _ownsEnvMap;
    /**
     * @param sys The sky whose state is published.
     * @param envMap Bake to publish. Omit to build a clouds-off bake owned by this provider
     *   and disposed with it.
     */
    constructor(sys: SkySystem, envMap?: SkyEnvironment | null);
    /** Samples the prefiltered sky along a reflection direction. Linear HDR; the sun disc is in the bake, blurred by prefiltering. */
    createReflectionSampler(): (dir: any) => any;
    /** Samples the sharp sky along a world direction, for tinting distant fog. Linear HDR; no sun disc. */
    createFogSampler(): (dir: any) => any;
    /** The equirect environment bake. Replaced when the bake's resolution changes. */
    getEnvironmentTexture(): THREE.Texture;
    /** The backdrop meshes, cloud layer included. */
    getMeshes(): THREE.Object3D[];
    /** Live sun state for following an animated sun (time of day, presets). */
    getSun(): {
        color: UniformNode<"color", THREE.Color>;
        direction: UniformNode<"vec3", THREE.Vector3>;
        intensity: UniformNode<"float", number>;
    };
    /**
     * Re-centers the env-bake origin's XZ on the camera, keeping its Y. Also ticks the bake
     * when this provider owns it, so call it once per frame.
     */
    followCamera(camera: THREE.Camera): void;
    /** Submersion gate. `false` freezes the env-bake and switches the cloud layer off entirely. */
    setActive(visible: boolean): void;
    /** Disposes the bake if this provider created it. */
    dispose(): void;
}
