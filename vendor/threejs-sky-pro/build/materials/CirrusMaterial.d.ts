import * as THREE from "three/webgpu";
import { Atmosphere } from "../state/Atmosphere";
import { Sun } from "../state/Sun";
import { Clouds } from "../state/Clouds";
import { TimeOfDay } from "../state/TimeOfDay";
import { AmbientSkyBaker } from "../baking/AmbientSkyBaker";
/**
 * Full-resolution 2D cirrus deck: a fullscreen quad forced to the far plane, depth-tested so
 * scene geometry occludes it, and drawn before the volumetric cloud composite. Outputs
 * premultiplied linear HDR radiance — `rgb` = radiance × coverage, `a` = coverage in [0,1].
 */
export declare class CirrusMaterial extends THREE.MeshBasicNodeMaterial {
    /** Shared atmospheric scattering state. */
    readonly atmosphere: Atmosphere;
    /** Shared sun state: direction, color, intensity. */
    readonly sun: Sun;
    /** Shared cloud state. This material reads the `cirrus`, `haze`, `fade`, and `wind` groups. */
    readonly cloud: Clouds;
    /** Time-of-day state, or `null` to compile the moon-lit terms out. */
    readonly timeOfDay: TimeOfDay | null;
    /** Whether wind drift nodes are present in this material's graph. */
    readonly animatedClouds: boolean;
    private readonly _ambientSky;
    /** Per-fragment ray direction node. World space, normalized. */
    readonly rayDirOverride: any;
    /** Per-fragment ray origin node — the camera position. World space, meters. */
    readonly rayOriginOverride: any;
    /** Grayscale cirrus mask. `null` draws nothing. Set it through {@link setCirrusTexture}. */
    cirrusTexture: THREE.Texture | null;
    /** Procedural weather map; R = coverage in [0,1], driving the storm haze on this deck. */
    weatherTexture: THREE.DataTexture;
    /**
     * @param atmosphere Shared atmospheric scattering state.
     * @param sun Shared sun state.
     * @param cloud Shared cloud state.
     * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
     * @param rayOriginOverride Per-fragment ray origin node — camera position, world space, meters.
     * @param weatherTexture Procedural weather map; R = coverage in [0,1].
     * @param timeOfDay Time-of-day state, or `null` for no moon-lit terms.
     * @param ambientSky Baked ambient-sky source for the fill light.
     */
    constructor(atmosphere: Atmosphere, sun: Sun, cloud: Clouds, rayDirOverride: any, rayOriginOverride: any, weatherTexture: THREE.DataTexture, animatedClouds: boolean, timeOfDay: (TimeOfDay | null) | undefined, ambientSky: AmbientSkyBaker);
    /**
     * Set the cirrus mask, or clear it with `null` so the deck draws nothing. Recompiles the
     * shader.
     */
    setCirrusTexture(cirrusTexture: THREE.Texture | null): void;
    /** Swap the procedural weather map and recompile the sampler binding. */
    setWeatherTexture(weatherTexture: THREE.DataTexture): void;
    private _buildColorNode;
}
