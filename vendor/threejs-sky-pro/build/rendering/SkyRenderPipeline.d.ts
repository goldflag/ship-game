import * as THREE from 'three/webgpu';
import { Atmosphere } from '../state/Atmosphere';
import { Sun } from '../state/Sun';
import { Clouds } from '../state/Clouds';
import { CloudQuality } from '../state/CloudQuality';
import { GodRays } from '../state/GodRays';
import { TimeOfDay } from '../state/TimeOfDay';
import { SkyPass } from './passes/SkyPass';
import { CirrusPass } from './passes/CirrusPass';
import { CloudPass, CloudPassOptions } from './passes/CloudPass';
import { CloudTemporalPass } from './passes/CloudTemporalPass';
import { CloudCompositePass } from './passes/CloudCompositePass';
import { CloudSamplingLayout, type CloudSamplingLattice } from './cloudSampling';
import { GodRaysPass } from './passes/GodRaysPass';
import { CloudShadowPass } from './passes/CloudShadowPass';
import { AmbientSkyBaker } from '../baking/AmbientSkyBaker';
import { SkyEnvironment, SkyEnvironmentConfig } from '../env/SkyEnvironment';
/** Construction inputs for {@link SkyRenderPipeline}. */
export interface SkyRenderPipelineConfig {
    /** Renderer the pipeline bakes and draws with. Must be a WebGPU renderer. */
    renderer: THREE.WebGPURenderer;
    /** Viewport width in CSS (logical) px. */
    width: number;
    /** Viewport height in CSS (logical) px. */
    height: number;
    /** Atmosphere state shared by the sky, cloud, fog, and LUT bakes. */
    atmosphere: Atmosphere;
    /** Sun state — direction, color, intensity. */
    sun: Sun;
    /** Cloud shape, lighting, wind, and cirrus state. */
    clouds: Clouds;
    /** Compile animated wind/evolution coordinates into cloud sampling graphs. */
    animatedClouds: boolean;
    /** Tier-driven cloud march budgets. */
    cloudQuality: CloudQuality;
    /** God-ray look knobs. */
    godRays: GodRays;
    /** When supplied, adds moon disc + ambient lift to the sky and a moon-key term to clouds; omitted → sun-only. */
    timeOfDay?: TimeOfDay | null;
    /** Moon texture for the sky dome's moon disc. */
    moonTexture?: THREE.Texture | null;
    /** Cloud pass inputs. The pipeline supplies `sourceDiv` and both LUTs itself. */
    cloudOptions: Omit<CloudPassOptions, 'sourceDiv' | 'transmittanceLUT' | 'multiScatterLUT' | 'skyViewLUT' | 'aerialInscatterLUT' | 'aerialTransmittanceLUT'>;
    /** Reconstruction (history) divisor vs screen — the single cloud-resolution knob (1/2/4/8). Source divisor is derived. Default 2. */
    cloudHistoryDiv?: number;
    /** Construction-time sampling lattice selected by cloud rendering mode. */
    cloudSamplingLattice: CloudSamplingLattice;
    /** Starting state of `godRays.enabled`. Default true. */
    godRaysEnabled?: boolean;
}
/**
 * Full sky rendering pipeline: sky dome, cirrus deck, volumetric clouds, cloud shadows, and
 * god rays, plus the atmosphere LUT and ambient-sky bakes they share. The cloud raymarch and
 * reconstruction are PassNodes that fire lazily as graph deps of the cloud composite mesh
 * and the god-ray overlay.
 */
export declare class SkyRenderPipeline {
    /** Atmospheric-scattering sky dome. Add `sky.mesh` to your scene. */
    readonly sky: SkyPass;
    /** Full-resolution 2D cirrus deck, drawn as a scene-background mesh behind the volumetric clouds. */
    readonly cirrus: CirrusPass;
    /** Volumetric cloud raymarch, rendered at `1 / sourceDiv` of screen resolution. */
    readonly cloud: CloudPass;
    /** Amortized reconstruction of the cloud march; its output is what the composite reads. */
    readonly cloudTemporal: CloudTemporalPass;
    /** Depth-tested fullscreen cloud layer. Add `cloudComposite.mesh` to your scene. */
    readonly cloudComposite: CloudCompositePass;
    /** Volumetric light shafts. Applied via `godRays.applyTo()`. */
    readonly godRays: GodRaysPass;
    /** Top-down cloud shadow baker: light transmittance through the shell → low-res texture; scene receives via `cloudShadowFactor`. */
    readonly cloudShadow: CloudShadowPass;
    /** Shared resolution and Bayer-phase state for the march and temporal reconstruction. */
    readonly cloudSampling: CloudSamplingLayout;
    private readonly _atmosphereLUT;
    private readonly _skyViewLUT;
    private readonly _aerialPerspectiveFroxel;
    private readonly _ambientSky;
    private readonly _renderer;
    private readonly _atmosphere;
    private readonly _sun;
    private readonly _clouds;
    private readonly _animatedClouds;
    private readonly _cloudInputs;
    /** Screen-march quality inputs whose changes make reconstruction incompatible. */
    private readonly _cloudHistoryQualityUniforms;
    private readonly _cloudHistoryQualityValues;
    private _cloudHistoryRevision;
    private _cloudHistoryLightMarchTaps;
    private _cloudHistoryEarlyExit;
    private _cloudHistoryBaseTexture;
    private _cloudHistoryBaseTextureVersion;
    private _cloudHistoryWeatherTexture;
    private _cloudHistoryWeatherTextureVersion;
    private _cloudHistoryCirrusTexture;
    private _cloudHistoryCirrusTextureVersion;
    private _cloudHistoryStateInitialized;
    private readonly _skyViewProjection;
    private readonly _drawingBufferSize;
    private _viewportWidth;
    private _viewportHeight;
    private _frameIndex;
    /** Last-applied `clouds.enabled`, for edge detection in `_syncCloudsEnabled`. */
    private _cloudsEnabled;
    /** Set by `updateFrame`; armed camera snapshot fires on the first backdrop mesh drawn. */
    private _capturePending;
    constructor(config: SkyRenderPipelineConfig);
    /** The baked transmittance LUT texture, shared across sky and cloud materials. */
    get transmittanceLUTTexture(): THREE.Texture;
    /** The baked multiple-scattering LUT texture. */
    get multiScatterLUTTexture(): THREE.Texture;
    /** Shared angular sky radiance used by the sky, fog, and cloud horizon fade. */
    get skyViewLUTTexture(): THREE.Texture;
    /** Baked sky-ambient terms (sun transmittance, zenith/horizon/ground radiance), refreshed each frame. */
    get ambientSky(): AmbientSkyBaker;
    /** Applies `clouds.enabled` on the frame it changes: stops the passes and blanks the output. */
    private _syncCloudsEnabled;
    /**
     * Per-frame update; call once before rendering. Refreshes the bakes and sun/state
     * uniforms and arms the camera snapshot, which fires at render time via
     * `_captureCamera` — so camera motion after this call still lands in the frame.
     */
    updateFrame(camera: THREE.PerspectiveCamera): void;
    /**
     * Camera snapshot for the frame: view-ray + reprojection uniforms and the temporal
     * history copy. Runs from the first backdrop mesh's `onBeforeRender` after each
     * `updateFrame` — before the cloud passes render — reading the camera exactly as this
     * render draws it.
     */
    private _captureCamera;
    /** Update the allocation-free cloud-input snapshot and report any incompatible change. */
    private _cloudHistoryInputsChanged;
    /** Resize the cloud pass targets. `width`/`height` are CSS (logical) px — the renderer's current pixel ratio is applied internally. */
    resize(width: number, height: number): void;
    /** Refresh the atmosphere resources shared by screen and environment rendering. */
    private _refreshSharedBakes;
    /** `SkyEnvironment` sharing this pipeline's transmittance LUT + bakers; caller supplies scene-level config. */
    createSkyEnvironment(config: Omit<SkyEnvironmentConfig, 'transmittanceLUT' | 'multiScatterLUT' | 'skyViewLUT' | 'prepareBake' | 'animatedClouds' | 'cloudInputTracker'>): SkyEnvironment;
    /** Runtime cloud resolution knob. `v` = reconstruction divisor (1/2/4/8); source divisor is derived. Clears history. */
    setHistoryDiv(v: number): void;
    /** Apply the shared layout atomically after a viewport or quality-setting change. */
    private _applyCloudSamplingLayout;
    dispose(): void;
}
