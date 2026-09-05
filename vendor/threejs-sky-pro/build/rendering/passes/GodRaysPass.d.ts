import * as THREE from "three/webgpu";
import { GodRays } from "../../state/GodRays";
import { Sun } from "../../state/Sun";
import { Atmosphere } from "../../state/Atmosphere";
import { TimeOfDay } from "../../state/TimeOfDay";
import { type CloudShadowProjection } from "../../tsl/cloudShadow";
/**
 * Volumetric light-shaft (god-ray) pass. Marches the per-pixel view ray, accumulating Mie
 * in-scatter weighted by sun visibility from the baked cloud shadow map (one fetch per step,
 * no second raymarch). Exposed via `overlayNode()` / `applyTo()`; `updateUniforms()` picks the
 * active light (sun by day, moon at night).
 */
export declare class GodRaysPass {
    /** 1 = on, 0 = off; multiplied into the shafts so it fades cleanly. */
    readonly enabledUniform: THREE.UniformNode<"float", number>;
    /** 1 when the active source is above the horizon, else 0. */
    readonly sourceAboveHorizon: THREE.UniformNode<"float", number>;
    /** Shaft tint — active light's color (sun, or desaturated moon at night). */
    readonly activeColor: THREE.UniformNode<"color", THREE.Color>;
    /** Per-source brightness: sun = 1, moon = `moonGodRayScale`, times the grazing-elevation
     *  fade (see GRAZING_FADE_START/END) so shafts ease out approaching the horizon. */
    readonly sourceScale: THREE.UniformNode<"float", number>;
    /** World-space active-light direction; drives the HG phase peaking shafts toward it. */
    readonly activeDir: THREE.UniformNode<"vec3", THREE.Vector3>;
    /** 1 / max(activeDir.y, MIN_SUN_ELEVATION_SIN), precomputed each frame so the per-step
     *  shadow-plane projection is a multiply instead of a max()+division. */
    readonly activeInvSunY: THREE.UniformNode<"float", number>;
    /** Sun elevation (radians) below which the active light switches to the moon. -6° matches the night gate. */
    nightThreshold: number;
    private readonly _sun;
    private readonly _godRays;
    private readonly _atmosphere;
    private readonly _timeOfDay;
    private readonly _shadowTexNode;
    private readonly _shadowProjection;
    private readonly _cameraPos;
    private readonly _cloudColor;
    private readonly _cloudHitDist;
    /** Half-resolution shaft target created when the post graph calls {@link applyTo}. */
    private _shaftTarget;
    private _shaftTargetActive;
    private readonly _moonColorScratch;
    constructor(sun: Sun, godRays: GodRays, atmosphere: Atmosphere, shadowTexture: THREE.Texture, shadowProjection: CloudShadowProjection, cameraPos: any, cloudColor: any, cloudHitDist: any, timeOfDay?: TimeOfDay | null);
    updateUniforms(): void;
    /**
     * TSL node: additive in-scattered shaft radiance (linear), marching camera→`sceneDist`
     * (clamped to `maxDistance`).
     */
    overlayNode(viewDir: any, sceneDist: any): any;
    /**
     * March end (world meters): camera→scene hit, pulled in to the cloud's hit distance where
     * cloud covers the pixel. Blending by cloud alpha rather than masking the finished shaft
     * keeps haze between camera and cloud glowing while occluding only the path behind it, and
     * lets a thin edge pass the shaft through. Cloud-ray misses carry the far miss sentinel
     * (rendering/hitDistance.ts), gated off by the `step`.
     */
    private shaftEnd;
    /**
     * Post-chain convenience: `sceneColor + shaftInScatter`; splice into the outputNode graph in linear space.
     * @param viewDir per-pixel world-space view ray, from the caller's own depth reconstruction.
     * @param sceneDist camera-to-scene-hit distance (world meters); sky pixels naturally clamp
     *   the march to `maxDistance` since their reconstructed distance is at/near the far plane.
     */
    applyTo(sceneColor: any, viewDir: any, sceneDist: any): any;
    dispose(): void;
}
