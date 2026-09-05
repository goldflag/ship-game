import * as THREE from 'three/webgpu';
import { CloudCompositeMaterial } from '../../materials/CloudCompositeMaterial';
import { TimeOfDay } from '../../state/TimeOfDay';
import { CameraRayBasis } from '../../tsl/screen-ray';
/**
 * Volumetric cloud layer drawn as a fullscreen scene mesh. Depth-tests the reprojected
 * ray-hit distance against scene geometry, so opaques occlude cloud and transparent objects
 * drawn after it blend over it.
 */
export declare class CloudCompositePass {
    /** The composite material. `SkyRenderPipeline.updateFrame` writes its view-projection. */
    readonly material: CloudCompositeMaterial;
    /** Fullscreen mesh. Add it to your scene. */
    readonly mesh: THREE.Mesh;
    /**
     * @param cloudColor Cloud temporal output: premultiplied HDR rgb + coverage alpha.
     * @param cloudHitDist Cloud temporal reconstructed ray-hit distance (`.r`, world meters).
     * @param rayBasis `SkyPass.rayBasis`.
     * @param cameraPositionUniform `SkyPass.cameraPositionUniform`.
     * @param logarithmicDepthBuffer Whether the renderer uses logarithmic depth.
     * @param timeOfDay When supplied, steepens cloud occlusion over the night sky.
     */
    constructor(cloudColor: any, cloudHitDist: any, rayBasis: CameraRayBasis, cameraPositionUniform: any, logarithmicDepthBuffer: boolean, timeOfDay?: TimeOfDay | null);
    dispose(): void;
}
