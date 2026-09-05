import * as THREE from "three/webgpu";
import { type CameraRayBasis } from "../tsl/screen-ray";
/**
 * Amortized temporal reprojection resolve — reconstructs the cloud image from the
 * one-sample-per-block march.
 *
 * A fresh slot takes the marched sample, blended 75/25 with valid history so ray-start
 * dither averages out across revisits. A stale slot takes reprojected history, falling back
 * to the low-res march when reprojection lands off-screen. Color history warps by a separate
 * carried depth, nearest-dilated over the 3×3 history neighborhood so cloud silhouettes
 * move with the foreground rather than the sky-miss sentinel. A depth-consistency gate
 * re-anchors stale carried values to the current march. History color is fetched with a
 * 5-tap Catmull-Rom so repeated rewarps do not compound bilinear blur.
 *
 * Whenever the camera moved, history is clamped into the min/max box of the 3×3 fresh
 * march neighborhood; that clamp is what validates history content, bounding ghosting,
 * drift, and carried speckle against current march data. While the view holds still, a
 * coherent `cameraStatic` branch skips the reprojection math and resolves to the identity.
 *
 * MRT: `output` = RGBA. `hitDistHistory.r` is current consumer depth for scene occlusion
 * and god rays; `.g` is the independently carried color-reprojection depth.
 */
export declare class CloudTemporalMaterial extends THREE.MeshBasicNodeMaterial {
    private readonly _cloudTexNode;
    private readonly _distTexNode;
    private readonly _historyTexNode;
    private readonly _prevDistTexNode;
    readonly prevViewProjection: THREE.UniformNode<"mat4", THREE.Matrix4>;
    readonly cameraPos: THREE.UniformNode<"vec3", THREE.Vector3>;
    readonly prevCameraPos: THREE.UniformNode<"vec3", THREE.Vector3>;
    readonly sourceSize: THREE.UniformNode<"vec2", THREE.Vector2>;
    readonly historySize: THREE.UniformNode<"vec2", THREE.Vector2>;
    readonly freshSlot: THREE.UniformNode<"vec2", THREE.Vector2>;
    readonly latticeSize: THREE.UniformNode<"float", number>;
    readonly cameraStatic: THREE.UniformNode<"float", number>;
    readonly historyValid: THREE.UniformNode<"float", number>;
    readonly freshWeightNear: THREE.UniformNode<"float", number>;
    readonly freshWeightFar: THREE.UniformNode<"float", number>;
    readonly debugView: THREE.UniformNode<"float", number>;
    private readonly _rayBasis;
    private readonly _consumerHitDistProp;
    private readonly _reprojectionHitDistProp;
    constructor(cloudTextureNode: any, hitDistTextureNode: any, historyTextureNode: any, prevHitDistTextureNode: any, rayBasis: CameraRayBasis);
    private _buildColorNode;
}
