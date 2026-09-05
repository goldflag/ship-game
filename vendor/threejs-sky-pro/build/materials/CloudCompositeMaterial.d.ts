import * as THREE from "three/webgpu";
import { TimeOfDay } from "../state/TimeOfDay";
/**
 * Composites the reconstructed volumetric cloud layer as a fullscreen scene overlay. Outputs
 * the temporal pass' premultiplied HDR color, tent-blurred one texel across silhouettes
 * while the camera moves; fragment depth is the reconstructed ray-hit distance, so the
 * hardware depth test hides cloud behind scene geometry, and transparent objects drawn
 * later blend over it.
 */
export declare class CloudCompositeMaterial extends THREE.MeshBasicNodeMaterial {
    /** User-camera view-projection. Written each frame by `SkyRenderPipeline.updateFrame`. */
    readonly viewProjection: THREE.UniformNode<"mat4", THREE.Matrix4>;
    /** Cloud temporal output size in pixels. Updated when the shared sampling layout changes. */
    readonly sourceSize: THREE.UniformNode<"vec2", THREE.Vector2>;
    /**
     * 1 when the camera didn't move this frame; selects the one-tap center path so the
     * converged image displays untouched without paying for silhouette filtering.
     */
    readonly cameraStatic: THREE.UniformNode<"float", number>;
    /**
     * @param cloudColor Cloud temporal output: premultiplied HDR rgb + coverage alpha.
     * @param cloudHitDist Cloud temporal reconstructed ray-hit distance (`.r`, world meters).
     * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
     * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
     * @param logarithmicDepthBuffer Whether the renderer uses logarithmic depth.
     * @param timeOfDay Time-of-day state, or `null` to compile the night steepening out.
     */
    constructor(cloudColor: any, cloudHitDist: any, rayDirOverride: any, cameraPositionUniform: any, logarithmicDepthBuffer: boolean, timeOfDay: TimeOfDay | null);
}
