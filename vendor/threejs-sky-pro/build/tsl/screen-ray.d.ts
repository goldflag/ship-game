import * as THREE from 'three/webgpu';
type Node = any;
/**
 * Camera frame a view ray is built from, refreshed once per frame.
 *
 * Rays come from these axes rather than from an inverse view-projection. Unprojecting
 * NDC subtracts two nearly-equal large numbers whose size grows with `far / near`, and
 * the surviving difference scales about the world origin — so the direction drifts with
 * a close near plane, and worse the further the camera sits from that origin. At a 0.1 m
 * near plane, 40 km out, that reached ten pixels. Combining basis vectors has no such
 * cancellation and holds at any near/far.
 */
export declare class CameraRayBasis {
    /** Unit forward axis (camera −Z), world space. */
    readonly forward: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Right axis scaled by `tan(fov/2) · aspect`, so NDC x = ±1 lands on the frustum edge. */
    readonly right: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** Up axis scaled by `tan(fov/2)`. */
    readonly up: THREE.UniformNode<"vec3", THREE.Vector3>;
    private readonly _axis;
    /** Refresh from a camera; call before anything samples a ray this frame. */
    update(camera: THREE.PerspectiveCamera): void;
}
/** Ray direction for an NDC coordinate in [−1, 1]². */
export declare function rayFromNdc(basis: CameraRayBasis, ndcX: Node, ndcY: Node): Node;
/**
 * Unit world-space ray direction through the fragment, from `uv()`.
 *
 * @param basis Camera frame supplying the axes.
 * @param ndcJitter Optional NDC nudge applied before the ray is built, for a sub-pixel
 *   sample offset. Omit for the un-jittered ray.
 */
export declare function screenRayDir(basis: CameraRayBasis, ndcJitter?: Node): Node;
/** Same ray for a caller holding its own top-left-origin screen UV. */
export declare function rayDirAt(basis: CameraRayBasis, screenUVNode: Node): Node;
/**
 * World position behind a sampled scene depth.
 *
 * @param screenUV Top-left-origin screen UV; the NDC y is flipped internally.
 * @param depth Raw depth-buffer value in [0, 1].
 * @param basis Camera frame supplying the ray.
 * @param cameraPos Camera world position. Must be a uniform, not the `cameraPosition`
 *   builtin, which under a fullscreen pass resolves to the ortho camera at the origin.
 * @param viewZFromDepth Converts the stored depth to a (negative) view-space Z.
 * @returns `worldPos`, the unit `viewDir` toward it, and `dist` from the camera.
 */
export declare function reconstructWorldPosition(screenUV: Node, depth: Node, basis: CameraRayBasis, cameraPos: Node, viewZFromDepth: (depth: Node) => Node): {
    worldPos: Node;
    viewDir: Node;
    dist: Node;
};
/**
 * Clip-space passthrough `vertexNode` for a fullscreen `PlaneGeometry(2, 2)` quad.
 *
 * Emits raw NDC z = 0, whose depth-test result is backend-dependent — pin `depthNode` on
 * the material if the pass needs a defined one.
 */
export declare function fullscreenVertexNode(): any;
export {};
