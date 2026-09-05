import * as THREE from 'three/webgpu';
import { Atmosphere } from '../state/Atmosphere';
import { Sun } from '../state/Sun';
import { Clouds } from '../state/Clouds';
import { CloudQuality } from '../state/CloudQuality';
import { TimeOfDay } from '../state/TimeOfDay';
import { AmbientSkyBaker } from '../baking/AmbientSkyBaker';
/**
 * Planet radius used for horizon curvature, in meters. Same `EARTH_R_KM` as the atmosphere
 * shader; this file's world scale is meters throughout. The planet center is slid to
 * `(cam.x, -PLANET_RADIUS, cam.z)` each frame so local +Y stays "up".
 */
export declare const PLANET_RADIUS: number;
/**
 * Volumetric cloud material: raymarches the cumulus shell on a fullscreen quad and emits
 * premultiplied linear HDR radiance (`rgb` = radiance × coverage, `a` = coverage in [0,1]),
 * plus the per-pixel ray-hit distance on a second MRT attachment. Lighting and the march
 * itself live in `tsl/cloudLighting.ts` and `tsl/cumulusMarch.ts`.
 *
 * Assign the textures, then call {@link init} to build the shader.
 */
export declare class CloudMaterial extends THREE.MeshBasicNodeMaterial {
    /** Shared atmospheric scattering state, driving aerial perspective and the horizon melt. */
    readonly atmosphere: Atmosphere;
    /** Shared sun state: direction, color, intensity. */
    readonly sun: Sun;
    /** Shared cloud state: shape, lighting, wind, cirrus, haze, and fade groups. */
    readonly cloud: Clouds;
    /** Per-instance march cost knobs — step counts, dither strength, cone angles. */
    readonly quality: CloudQuality;
    /** Time-of-day state, or `null` to compile the moon-key term out. */
    readonly timeOfDay: TimeOfDay | null;
    /** Whether wind drift/evolution nodes are present in this material's graph. */
    readonly animatedClouds: boolean;
    private readonly _ambientSky;
    /** Per-fragment ray direction node. World space, normalized. */
    readonly rayDirOverride: any;
    /** Per-fragment ray origin node — the camera position. World space, meters. */
    readonly rayOriginOverride: any;
    private _sunConeOffsets;
    private _moonConeOffsets;
    /** Virtual planet center. World space, meters; keep at `(cam.x, -PLANET_RADIUS, cam.z)` per frame. */
    readonly planetCenter: THREE.UniformNode<"vec3", THREE.Vector3>;
    /**
     * Which depth along the ray each pixel stores as its hit distance — a
     * {@link HIT_DISTANCE_MODE} value. Only the stored distance follows this; aerial
     * perspective and the horizon melt always use the coverage-weighted linear mean.
     */
    readonly hitDistanceMode: THREE.UniformNode<"float", number>;
    /** Mipped base-shape noise volume. Required before {@link init}. */
    baseShapeTexture: THREE.Data3DTexture | null;
    /** Weather map; R = coverage in [0,1]. Required before {@link init}. */
    weatherTexture: THREE.DataTexture | null;
    /** Cirrus-deck mask composited behind the volumetric clouds. `null` omits the deck. */
    cirrusTexture: THREE.Texture | null;
    /** Blue-noise tile for the ray-start dither. `null` marches un-dithered. */
    blueNoiseTexture: THREE.DataTexture | null;
    /** Sky transmittance LUT. Set together with {@link multiScatterLUT} to enable aerial perspective. */
    transmittanceLUT: THREE.Texture | null;
    /** Multiple-scattering LUT. Aerial perspective needs this and {@link transmittanceLUT}. */
    multiScatterLUT: THREE.Texture | null;
    /** Shared angular sky radiance for the horizon convergence target. */
    skyViewLUT: THREE.Texture | null;
    /** Camera-aligned froxel atlas containing aerial-perspective RGB in-scatter. */
    aerialInscatterLUT: THREE.Texture | THREE.TextureNode | null;
    /** Camera-aligned froxel atlas containing aerial-perspective RGB transmittance. */
    aerialTransmittanceLUT: THREE.Texture | THREE.TextureNode | null;
    private _aerialPerspective;
    private readonly _rayHitDistProp;
    /**
     * @param atmosphere Shared atmospheric scattering state.
     * @param sun Shared sun state.
     * @param cloud Shared cloud state.
     * @param quality Per-instance march cost knobs.
     * @param rayDirOverride Per-fragment ray direction node. World space, normalized.
     * @param rayOriginOverride Per-fragment ray origin node — camera position, world space, meters.
     * @param animatedClouds Include time-animated cloud coordinates in the shader graph.
     * @param timeOfDay Time-of-day state, or `null` for no moon key.
     * @param ambientSky Baked ambient-sky source for the fill light.
     */
    constructor(atmosphere: Atmosphere, sun: Sun, cloud: Clouds, quality: CloudQuality, rayDirOverride: any, rayOriginOverride: any, animatedClouds: boolean, timeOfDay: (TimeOfDay | null) | undefined, ambientSky: AmbientSkyBaker);
    /**
     * Build the shader. Call once {@link baseShapeTexture} and {@link weatherTexture} are
     * assigned; throws otherwise.
     *
     * @param options.mrt Defaults to `true`. Pass `false` for single-attachment baking, which
     * emits color only and no ray-hit distance.
     */
    init(options?: {
        mrt?: boolean;
    }): void;
    /** Rebuild the color node against the currently assigned textures and mark the material dirty. */
    rebuildShader(): void;
    /** Refresh CPU-packed sun/moon cone taps when light direction or cone geometry changed. */
    updateLightConeOffsets(): void;
    /** Recreate the aligned uniform layout only when the compile-time tap count changes. */
    private _ensureLightConeOffsetLayout;
    /** Swap noise textures on an already-built material and recompile. Omitted entries keep their current texture. */
    setNoiseTextures(textures: {
        baseShape?: THREE.Data3DTexture;
        weather?: THREE.DataTexture;
    }): void;
    /** Set the cirrus-deck mask, or clear it with `null` to drop the deck. Recompiles the shader. */
    setCirrusTexture(cirrusTexture: THREE.Texture | null): void;
    private _buildColorNode;
}
