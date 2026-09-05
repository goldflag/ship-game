import * as THREE from 'three/webgpu';
/**
 * Void-and-cluster blue-noise tile as an R8 `DataTexture`: `size`² texels holding values in
 * [0,1), repeat-wrapped and nearest-filtered. The tile is toroidal, so it repeats seamlessly.
 * `size` is the edge length in texels.
 */
export declare function createBlueNoiseTexture(size?: number): THREE.DataTexture;
