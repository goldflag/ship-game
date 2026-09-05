import * as THREE from "three/webgpu";
import { CloudMaterial } from "../../materials/CloudMaterial";
import { Atmosphere } from "../../state/Atmosphere";
import { Sun } from "../../state/Sun";
import { Clouds } from "../../state/Clouds";
import { CloudQuality } from "../../state/CloudQuality";
import { TimeOfDay } from "../../state/TimeOfDay";
import { AmbientSkyBaker } from "../../baking/AmbientSkyBaker";
import { CameraRayBasis } from "../../tsl/screen-ray";
import type { CloudSamplingLayout } from "../cloudSampling";
/** Construction inputs for {@link CloudPass}. */
export interface CloudPassOptions {
    /** Raymarch target divisor vs screen: history divisor × active sampling-lattice edge. */
    sourceDiv: number;
    /** Pre-computed noise textures (see `src/noise/`). */
    textures: {
        /** Base-shape noise volume (3D). */
        baseShape: THREE.Data3DTexture;
        /** Weather map (2D): r = coverage height. */
        weather: THREE.DataTexture;
    };
    /** Sky transmittance LUT — distant clouds blend toward the real sky color (aerial perspective). */
    transmittanceLUT: THREE.Texture;
    /** Sky multi-scatter LUT, pairing with `transmittanceLUT` for the aerial-perspective haze. */
    multiScatterLUT: THREE.Texture;
    /** Shared angular sky radiance for far-cloud horizon convergence. */
    skyViewLUT: THREE.Texture;
    /** Camera-aligned aerial-perspective in-scatter froxel atlas. */
    aerialInscatterLUT: THREE.TextureNode;
    /** Camera-aligned aerial-perspective transmittance froxel atlas. */
    aerialTransmittanceLUT: THREE.TextureNode;
}
/**
 * Volumetric cloud raymarch pass — a `THREE.PassNode` over a fullscreen-quad `CloudMaterial`,
 * fired lazily when a downstream node samples its texture nodes. The Bayer pixel-selection
 * shear rides in `jitterInverseViewProjection`; the main camera is never mutated.
 * MRT: `output` (rgb = premultiplied radiance, a = 1−T), `rayHitDist` (r = meters, see
 * `rendering/hitDistance.ts` for the miss encoding).
 */
export declare class CloudPass {
    /** The cloud material marched by this pass. */
    readonly material: CloudMaterial;
    /** Fullscreen quad carrying `material`; lives in this pass' own `scene`. */
    readonly mesh: THREE.Mesh;
    /** Private scene the PassNode renders — not the user's scene. */
    readonly scene: THREE.Scene;
    /** Tier-driven march budgets. `updateFrame` writes its per-frame cone-angle and dither uniforms. */
    readonly quality: CloudQuality;
    /** Camera axes rays are built from. Shared with the rest of the pipeline. */
    readonly rayBasis: CameraRayBasis;
    /** This frame's Bayer sub-position as an NDC offset. Written each frame. */
    readonly ndcJitter: THREE.UniformNode<"vec2", THREE.Vector2>;
    /** User-camera world position — the raymarch ray origin (the TSL `cameraPosition` builtin is wrong here). */
    readonly cameraPositionUniform: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** PassNode wrapping the raymarch; sampling a texture node triggers it in `pipeline.render()`. */
    readonly passNode: THREE.PassNode;
    /** TextureNode for the color attachment. Sampling it triggers the pass. */
    readonly outputTextureNode: THREE.TextureNode;
    /** TextureNode for the ray-hit-distance attachment. */
    readonly hitDistTextureNode: THREE.TextureNode;
    private _sourceDiv;
    private readonly _blueNoise;
    private readonly _unjitteredProjection;
    constructor(atmosphere: Atmosphere, sun: Sun, state: Clouds, quality: CloudQuality, width: number, height: number, options: CloudPassOptions, timeOfDay: (TimeOfDay | null) | undefined, ambientSky: AmbientSkyBaker, rayBasis: CameraRayBasis, animatedClouds: boolean);
    /** Starts/stops the march. `false` leaves the render target holding whatever it last drew. */
    setRenderEnabled(enabled: boolean): void;
    /**
     * Per-frame update; call before this pass renders. Slides the planet center, snapshots the un-sheared
     * projection, and writes the Bayer-sheared inverse-VP for this frame's active sub-position.
     */
    updateFrame(camera: THREE.PerspectiveCamera, frameIndex: number, sampling: CloudSamplingLayout): void;
    /** Snapshot of the projection matrix as it was before any jitter was applied. */
    get unjitteredProjection(): THREE.Matrix4;
    /** Resolution divisor relative to screen, runtime-tunable. */
    get sourceDiv(): number;
    set sourceDiv(v: number);
    /** Resize the march target. `width`/`height` are CSS px; `setSize` wants drawing-buffer px, so pre-multiply by `pixelRatio`. */
    resize(width: number, height: number, pixelRatio: number): void;
    /** Width of the cloud source target after divisor is applied. */
    get sourceWidth(): number;
    /** Height of the cloud source target after divisor is applied. */
    get sourceHeight(): number;
    dispose(): void;
}
