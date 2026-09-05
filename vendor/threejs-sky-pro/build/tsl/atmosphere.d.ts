import type * as THREE from "three/webgpu";
/**
 * Maps a world-space sky direction into the shared sky-view LUT. The atmosphere is
 * rotationally symmetric around world up, so the horizontal coordinate stores unsigned
 * azimuth from the sun and the vertical coordinate stores view elevation. Squaring both
 * coordinates in the bake concentrates resolution around the sun and horizon; these square
 * roots are the inverse mapping used by every consumer.
 */
export declare function skyViewLUTUV(viewDir: any, sunDir: any): THREE.VarNode<"vec2", THREE.JoinNode<"vec2">>;
/** Sample raw atmospheric sky radiance (no sun intensity or analytic discs). */
export declare function sampleSkyViewLUT(skyViewTex: THREE.Texture, viewDir: any, sunDir: any): THREE.Node<"vec3">;
/**
 * Builds the sky-radiance Fn: single-scattered radiance toward `viewDir` for a sun at
 * `sunDir`, reading sun transmittance from the LUTs. Linear HDR, no sun disc.
 */
export declare function makeSkyColorAlongRayLUT(lutTex: THREE.Texture, msLutTex: THREE.Texture): any;
/**
 * Builds the aerial-perspective helper: atmosphere between the camera and an occluder
 * `maxDist` km along `viewDir`.
 *
 * @returns `inscatter`, the phased radiance added along the segment, and `transmittance`,
 *   the per-channel survival of what lies behind it.
 */
export declare function makeAerialPerspectiveLUT(lutTex: THREE.Texture, msLutTex: THREE.Texture): (args: {
    viewDir: any;
    sunDir: any;
    turbidity: any;
    mieG: any;
    rayleigh: any;
    skyMultipleScattering: any;
    mieScatteringStrength: any;
    maxDist: any;
    densityScale: any;
}) => {
    inscatter: any;
    transmittance: any;
};
