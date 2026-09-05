import * as THREE from "three/webgpu";
import { Atmosphere } from "./state/Atmosphere";
import { Sun } from "./state/Sun";
import { Clouds } from "./state/Clouds";
import { GodRays } from "./state/GodRays";
import { TimeOfDay, type TimeOfDayParams } from "./state/TimeOfDay";
import { NightSkyPanorama, type NightSkyPanoramaOptions } from "./env/NightSkyPanorama";
import { SkyRenderPipeline } from "./rendering/SkyRenderPipeline";
import { WeatherMap, type CloudNoiseTextures } from "./noise";
import { SkyProvider } from "./providers/SkyProvider";
import { SkyEnvironment, type SkyEnvironmentOptions } from "./env/SkyEnvironment";
import { type QualityLevel, type QualityLevelConfig } from "./config/QualityLevels";
import { type SkyParams } from "./config/presets";
/**
 * Construction-time cloud strategy. `'static'` fixes the field and uses 4×4 temporal
 * sampling; `'dynamic'` animates it at 4×4; `'ultra-dynamic'` animates it at 2×2.
 */
export type CloudRenderingMode = "static" | "dynamic" | "ultra-dynamic";
/** Options for `SkySystem.create()`. */
export interface SkySystemConfig {
    /** The renderer the sky draws with. */
    renderer: THREE.WebGPURenderer;
    /** The camera the sky is rendered from. */
    camera: THREE.PerspectiveCamera;
    /** Scene the backdrops are added to at construction and removed from on `dispose()`. */
    scene: THREE.Scene;
    /** Initial quality tier. Default `'high'`. Change it later with `setQualityLevel()`. */
    quality?: QualityLevel;
    /**
     * Cloud behavior and sampling mode. Default `'dynamic'`. Use `'ultra-dynamic'`
     * for high-speed camera motion. Recreate the sky to change modes.
     */
    cloudRenderingMode?: CloudRenderingMode;
    /** Enable god rays. Defaults to the chosen `quality` tier's setting. */
    godRays?: boolean;
    /** Initial time-of-day state. Default noon (`time = 0.5`). */
    timeOfDay?: TimeOfDayParams;
    /**
     * Star-panorama background and textured moon. Provide a panorama through `texture`;
     * omit to disable stars and render the moon as a flat tinted disc. The panorama is
     * not bundled — see the docs for ready-to-use starmaps.
     */
    nightSky?: NightSkyPanoramaOptions;
}
/**
 * The sky: atmosphere, sun, clouds, god rays, and night sky.
 *
 * Build one with {@link SkySystem.create}, call {@link update} each frame, and splice
 * {@link applyTo} into your post-processing graph.
 */
export declare class SkySystem {
    /** Atmospheric scattering, haze, and fog. */
    readonly atmosphere: Atmosphere;
    /** Sun disc, color, and direction. */
    readonly sun: Sun;
    /** Cloud shape, lighting, wind, and coverage. */
    readonly clouds: Clouds;
    /** Sun shafts. */
    readonly godRays: GodRays;
    /** Day/night clock and moon. */
    readonly timeOfDay: TimeOfDay;
    /** Night-sky panorama. `null` when `config.nightSky` is omitted. */
    readonly nightSky: NightSkyPanorama | null;
    /** Weather map driving cloud placement. Resolution follows the quality tier. @internal */
    readonly weatherMap: WeatherMap;
    /** The render passes backing the sky. @internal */
    readonly pipeline: SkyRenderPipeline;
    /** The cloud base-shape and weather textures currently bound. @internal */
    readonly noiseTextures: CloudNoiseTextures;
    private readonly _renderer;
    /** Camera planes, for decoding scene depth back to a linear one. */
    private readonly _cameraNear;
    private readonly _cameraFar;
    private readonly _camera;
    private readonly _scene;
    private readonly _sunDriver;
    private readonly _cloudQuality;
    private _qualityLevel;
    private readonly _cloudRenderingMode;
    private _cloudShadowTexNode;
    private readonly _baseShape;
    /** Env map owned by the last `createSkyProvider({ envMap: true })` call. Ticked in `update()`. */
    private _providerEnvMap;
    /**
     * Build a sky. Await the result before rendering — the noise volumes and night-sky
     * textures load first.
     */
    static create(config: SkySystemConfig): Promise<SkySystem>;
    private constructor();
    /**
     * The backdrop meshes: dome, star panorama, cirrus deck, cloud layer. Added to the scene
     * by the constructor and removed by {@link dispose}. Each is placed in a `RenderLayer`, so
     * they sort behind your content on their own — this array's order is not the draw order.
     * The cloud layer depth-tests its ray-hit distance, so it hides behind opaque geometry
     * while transparent objects blend over it.
     * @internal
     */
    backdropMeshes(): THREE.Mesh[];
    /** Per-frame update: runs the cloud passes and refreshes all uniforms. Call once before rendering. */
    update(dt: number): void;
    /**
     * Composites the sky over your rendered scene: aerial-perspective fog, then god-ray shafts.
     * Returns a TSL node — splice it into your post graph in linear pre-exposure space (after
     * the scene, before exposure and bloom) so the result gets exposed and can bloom. Clouds
     * are not part of this chain — they render in your scene as one of the backdrop meshes.
     *
     * Depth comes from `scenePass`, and each stage is depth-correct: fog leaves open sky alone
     * and shafts stop at the nearest surface. Turn stages down with `atmosphere.fogDensity` and
     * `godRays.enabled`.
     *
     * @param sceneColor the color node you're chaining. Need not be `scenePass`'s own output —
     *   pass whatever earlier post stages produced (e.g. Water Pro's node).
     * @param scenePass the `pass(scene, camera)` node whose depth covers your scene geometry.
     */
    applyTo(sceneColor: any, scenePass: any): any;
    /**
     * TSL scalar (0..1): cloud sun-transmittance at a world position (1 = full sun, 0 = shadowed).
     * Multiply into the direct sun term only. Positions outside the shadow-map footprint return 1.0.
     */
    cloudShadow(worldPos: any): any;
    /**
     * Resize the cloud pass targets and drop stale history. `width`/`height` are
     * CSS (logical) pixels — the same units as `renderer.setSize()`; the
     * renderer's current pixel ratio is applied internally. Call this after
     * `renderer.setPixelRatio()` too, so the cloud targets re-clone at the new
     * physical size.
     */
    resize(width: number, height: number): void;
    /**
     * Set (or clear with `null`) the cirrus-deck mask. Drives the full-res `cirrusMesh`
     * (direct view) and the provider env map's live thin-cloud pass. `scale` / `strength`
     * are live uniforms on `clouds.cirrus`.
     */
    setCirrusTexture(texture: THREE.Texture | null): void;
    /** The currently active quality tier name. */
    get qualityLevel(): QualityLevel;
    /** Construction-time cloud behavior and sampling mode. Recreate the sky to change it. */
    get cloudRenderingMode(): CloudRenderingMode;
    /**
     * Switch the runtime quality tier. `overrides` replaces individual tier fields on top
     * of `level`. Returns a promise that resolves once the new noise is bound; safe to
     * ignore if you don't need to sequence work after it.
     */
    setQualityLevel(level: QualityLevel, overrides?: Partial<QualityLevelConfig>): Promise<void>;
    /** Point every base-shape consumer at `baseShape`. Does not dispose the previous texture. */
    private _bindBaseShapeTexture;
    /**
     * Apply a look preset, replacing the atmosphere, sun, time, cloud, god-ray, and
     * night-sky state wholesale. Every field is applied; omitting one does not leave the
     * current value in place.
     *
     * The cloud rendering mode, quality tier, march budgets, and env-map bake config are untouched.
     * Set the quality-owned values with {@link setQualityLevel}; cloud rendering mode is fixed at construction.
     */
    applyPreset(preset: SkyParams): Promise<void>;
    /**
     * Read the current sky state back as a `SkyParams`. Inverse of {@link applyPreset}:
     * feeding the result back in reproduces the state it was taken from. Colors and the
     * weather profile are copied, so later changes to the sky don't reach the result.
     *
     * The cloud rendering mode, quality tier, march budgets, and env-map bake config are not included —
     * they are not preset content. Read the first two from {@link cloudRenderingMode} and
     * {@link qualityLevel}.
     */
    toParams(): SkyParams;
    /**
     * Build a `SkyProvider` to drive `threejs-water-pro` reflections. The default bake omits
     * clouds but retains the atmosphere, celestial discs, and configured stars;
     * `{ envMap: true }` adds clouds. A new call disposes the previous system-owned cloud
     * environment map; cloud-free providers own and dispose their own bakes.
     */
    createSkyProvider(options?: {
        envMap?: boolean | SkyEnvironmentOptions;
    }): SkyProvider;
    /**
     * Build a `SkyEnvironment` — an equirectangular env map sharing this system's atmosphere, sun,
     * cloud state, and noise textures, with its own cloud-quality knobs. `envMap.texture` drops into
     * `scene.environment`, a `pmremTexture` reflection sampler, or a raw
     * `texture(envMap.texture, equirectUVFromDir(dir))` read unmodified.
     */
    createEnvironmentMap(options?: SkyEnvironmentOptions): SkyEnvironment;
    /** Releases all GPU resources and takes the backdrops back out of the scene. */
    dispose(): void;
}
