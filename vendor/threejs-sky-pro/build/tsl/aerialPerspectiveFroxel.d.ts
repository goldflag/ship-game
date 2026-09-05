import type * as THREE from "three/webgpu";
/** Camera-plane froxel columns. 32×18 keeps cells approximately square at 16:9. */
export declare const AERIAL_FROXEL_WIDTH = 32;
export declare const AERIAL_FROXEL_HEIGHT = 18;
/** Quadratic distance slices, packed left-to-right in the 2D atlas. */
export declare const AERIAL_FROXEL_DEPTH = 32;
export declare const AERIAL_FROXEL_ATLAS_WIDTH: number;
/** Sample cached atmospheric in-scatter and RGB transmittance to a screen-space distance. */
export declare function sampleAerialPerspectiveFroxel(inscatterAtlas: THREE.Texture | THREE.TextureNode, transmittanceAtlas: THREE.Texture | THREE.TextureNode, screenUV: any, distanceMeters: any, maxDistanceMeters: any): {
    inscatter: THREE.Node<"vec3">;
    transmittance: THREE.Node<"vec3">;
};
