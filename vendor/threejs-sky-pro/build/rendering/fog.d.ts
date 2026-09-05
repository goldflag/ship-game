import * as THREE from "three/webgpu";
import type { Atmosphere } from "../state/Atmosphere";
import type { Sun } from "../state/Sun";
type Node = any;
/** Inputs to {@link applyFog}. */
export interface FogParams {
    /** Scene color at the current pixel — already resolved, not a texture to sample. */
    sceneColor: Node;
    /** Camera far plane, world meters. Geometry at that range is open sky. */
    farPlane: Node;
    /** Unit world-space camera→pixel ray. */
    viewDir: Node;
    /** Camera-to-surface distance, world meters. */
    sceneDist: Node;
    atmosphere: Atmosphere;
    sun: Sun;
    /** Transmittance + multiple-scattering LUTs, so the fog color matches the sky dome's march. */
    transmittanceLUT: THREE.Texture;
    multiScatterLUT: THREE.Texture;
    /** Shared angular sky radiance. Null compiles the reference view integrator. */
    skyViewLUT: THREE.Texture | null;
    /** Cloud temporal pass output: premultiplied HDR rgb + coverage alpha. */
    cloudColor: Node;
    /** Cloud temporal pass reprojected ray-hit distance (`.r`, world meters). */
    cloudHitDist: Node;
}
/**
 * Fades opaque geometry toward the sky radiance along its own view direction, so distant terrain
 * converges on the sky sitting directly behind it instead of a flat haze color. Two ramps, maxed:
 * an exponential distance fog (`atmosphere.fogDensity`), and a far-fade band
 * (`fogFarFadeStart`/`fogFarFadeEnd`) that takes geometry fully to sky — that one hides a finite
 * world's edge (streamed tiles, a ground or water plane's rim). Sky pixels pass through
 * untouched, and clouds get no fog — it applies only to the surface fraction beneath them.
 */
export declare function applyFog(params: FogParams): Node;
export {};
