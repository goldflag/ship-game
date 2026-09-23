/** Interfaces between the ocean's parts. Each part lives in its own folder under
 * `src/game/ocean/` and depends on the others only through these types, so the
 * wave field, wake, surface and screen-space passes can change independently.
 * See `README.md` in this folder for the design and the rules every part keeps. */
import type { Camera, Color, Node, Object3D, Texture, Vector3, WebGPURenderer } from 'three/webgpu';

/** Graphics → Ocean. Chosen when the port loads; changing it rebuilds the ocean. */
export type OceanQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Sky Pro's provider, as the ocean consumes it. Sky Pro stays a vendored dependency; the
 * ocean only calls these members. `SkySystem.createSkyProvider()` returns a compatible object. */
export interface OceanSky {
  /** Prefiltered sky radiance (linear HDR) along a world direction. Sky Pro may ignore `roughness`;
   * the surface then does its own roughness filtering from `getEnvironmentTexture()`. */
  createReflectionSampler(): (direction: Node<'vec3'>, roughness?: Node<'float'>) => Node<'vec3'>;
  /** Sharp sky radiance (linear HDR, no sun disc) along a world direction, for distant fog. */
  createFogSampler(): (direction: Node<'vec3'>) => Node<'vec3'>;
  /** Equirectangular environment bake; the same object until the bake is rebuilt. */
  getEnvironmentTexture(): Texture;
  /** Backdrop meshes the sky draws; already in the scene. */
  getMeshes(): Object3D[];
  /** Re-centre the sky's camera-relative state. Called once per ocean update. */
  followCamera(camera: Camera): void;
}

/** Sea state. Every field is live; set `dirty = true` after changing any of them and the
 * spectrum is rebuilt on the next update. All lengths are metres. */
export interface WaveParameters {
  /** Significant wave height Hm0 = 4σ of the rendered surface, exactly, in metres. 0 is flat. */
  significantHeight: number;
  /** Wind speed at 10 m (m/s). Shapes the spectrum's high-frequency tail and foam. */
  windSpeed: number;
  /** Direction the wind blows toward, radians from +X toward +Z. */
  windDirection: number;
  /** Wavelength at the spectral peak. */
  peakWavelength: number;
  /** Horizontal (choppy) displacement scale; 0 is a pure height field. */
  choppiness: number;
  /** JONSWAP peak enhancement γ. */
  gamma: number;
  /** Directional spreading; 1 is the default spread, smaller is broader (crossing seas). */
  directionalSharpness: number;
  /** Integer seed; any integer is safe. */
  seed: number;
  dirty: boolean;
}

export interface WaveCascadeInfo {
  /** Tile edge length in metres. */
  size: number;
  /** FFT resolution (texels per edge). */
  resolution: number;
}

/** What the surface fragment reads from the waves at an undisplaced world position. */
export interface WaveSurfaceSample {
  /** World-space slope of the displaced surface, (∂y/∂x, ∂y/∂z), mip-filtered. */
  slope: Node<'vec2'>;
  /** Jacobian determinant of the horizontal displacement (1 is undistorted, < 0 folds). */
  jacobian: Node<'float'>;
  /** Whitecap foam per area of sea: 1 on a crest breaking now, e-folding over the lifetime once it has passed, and
   * denser where the surface converges (up to about 3 on a fold). */
  foam: Node<'float'>;
  /** The bubble cloud whitecaps leave in the water under and around them: their foam spread over a metre or two. */
  bubbles: Node<'float'>;
  /** Slope variance of the waves this pixel does not resolve; the surface turns it into roughness. */
  slopeVariance: Node<'float'>;
}

/** GPU wave field: a JONSWAP spectrum evolved and inverse-transformed every frame into
 * periodic tiles. Surfaces sample it at the undisplaced (grid) world position. */
export interface WaveField {
  readonly params: WaveParameters;
  readonly foamParams: WaveFoamParameters;
  readonly cascades: readonly WaveCascadeInfo[];
  /** Upper bound (m) on the wave height for the current spectrum, excluding the wake. */
  readonly maxHeight: number;
  /** Upper bound (m) on horizontal displacement for the current spectrum. */
  readonly maxHorizontalDisplacement: number;
  /** Vertex stage: world displacement (x, y, z) of the grid point `xz`. `spacing` is the local
   * vertex spacing in metres; waves it cannot represent are faded out instead of aliasing. */
  displacement(xz: Node<'vec2'>, spacing?: Node<'float'>): Node<'vec3'>;
  /** Fragment stage: slope, jacobian, foam and unresolved variance at grid point `xz`. */
  surface(xz: Node<'vec2'>): WaveSurfaceSample;
  /** Any stage: surface height at a world position, inverting the choppy displacement with a
   * few fixed-point steps. Used by overlays laid on the sea and the waterline test. */
  heightAt(xz: Node<'vec2'>): Node<'float'>;
  /** Rebuild the spectrum if dirty, then evolve and transform to `time` (seconds). `dt` advances
   * foam persistence; 0 renders without advancing it. */
  update(renderer: WebGPURenderer, time: number, dt: number): void;
  dispose(): void;
}

/** How crest foam builds and fades in the wave field. Live; the facade's `foam.crest` object is passed in. Crests
 * break where the spectrum's own statistics put the share of the sea the wind whitens (`waves/whitecaps.ts`). */
export interface WaveFoamParameters {
  /** Scale on the whitecap coverage the wind calls for (Monahan & O'Muircheartaigh's fraction): 1 is calibrated, 0 none. */
  coverageScale: number;
  /** e-folding lifetime of whitecap foam in periods of the waves that broke: a larger breaker's foam lasts longer. */
  lifetime: number;
}

/** `waves/index.ts` exports `createWaveField` and `createWaveHeightSampler` with these shapes. The field
 * reads `params` and `foam` live: the facade owns those objects and the game writes to them. */
export type CreateWaveField = (renderer: WebGPURenderer, cascades: readonly WaveCascadeInfo[], params: WaveParameters, foam: WaveFoamParameters) => WaveField;
export type CreateWaveHeightSampler = (renderer: WebGPURenderer, field: WaveField) => WaveHeightSampler;
/** `wake/index.ts` exports `createWakeField` with this shape. */
export type CreateWakeField = (renderer: WebGPURenderer, resolution: number) => WakeFieldApi;

/** Height readback at a set of world points, one frame late. Presentation only. */
export interface WaveHeightSampler {
  setPositions(points: readonly { x: number; z: number }[]): void;
  /** Start a GPU query for the current positions unless one is in flight; results arrive later. */
  request(): void;
  /** Wait for the in-flight query (if any), then run one fresh query and wait for it. */
  refresh(): Promise<void>;
  /** Latest completed height at each position (NaN until the first result). */
  readonly heights: Float32Array;
  /** Latest completed surface normal at each position (x, y, z triples). */
  readonly normals: Float32Array;
  dispose(): void;
}

/** The wake field as the surface material reads it. Outside the field every read is calm. */
export interface WakeSampler {
  /** Vertical displacement in metres at a world position. */
  height(x: Node<'float'>, z: Node<'float'>): Node<'float'>;
  /** Surface normal of the wake alone; (0, 1, 0) where calm. */
  normal(x: Node<'float'>, z: Node<'float'>): Node<'vec3'>;
  /** Foam energy ≥ 0, shaded like crest foam. */
  foam(x: Node<'float'>, z: Node<'float'>): Node<'float'>;
  /** Calm-slick strength 0–1 behind hulls, where turbulence has damped the short waves; absent reads as none. */
  slick?(x: Node<'float'>, z: Node<'float'>): Node<'float'>;
}

export interface WakeGeneratorOptions {
  /** False emits nothing but keeps tracking the object. */
  active?: boolean;
  /** Hull depth in metres; sets the disturbance amplitude. */
  depth?: number;
  /** Radius of the disturbance around the swept path, in metres. */
  radius?: number;
  /** Emission point in the object's local frame (only yaw is applied). */
  offset?: Vector3;
  /** Moves longer than this in one step are teleports: no emission, history restarts. */
  teleportThreshold?: number;
}

/** A dispersive (iWave-style) displacement field centred on a movable anchor. */
export interface WakeFieldApi {
  enabled: boolean;
  /** Cells per edge; fixed by the quality tier. */
  readonly resolution: number;
  /** Field edge length in metres. */
  worldSize: number;
  /** Velocity damping γ ≥ 0; higher gives a shorter trail. */
  friction: number;
  /** Foam injected where the wake breaks. */
  foamStrength: number;
  /** Surface steepness |∇h| at which wake foam starts. */
  foamBreakThreshold: number;
  /** e-folding lifetime of wake foam in seconds. */
  foamLifetime: number;
  /** Move the field's centre; content stays fixed in the world. */
  setCenter(x: number, z: number): void;
  addGenerator(object: Object3D, options?: WakeGeneratorOptions): number;
  updateGenerator(id: number, options: WakeGeneratorOptions): boolean;
  removeGenerator(id: number): boolean;
  /** Zero the field and restart every generator's history. */
  reset(): void;
  readonly sampler: WakeSampler;
  /** Emit from active generators and advance the field by `dt`; 0 leaves it untouched. */
  step(renderer: WebGPURenderer, dt: number): void;
  dispose(): void;
}

/** Custom water colours. The pigment is emitted radiance: the game pre-scales it for night. */
export interface WaterColors {
  /** Colour of deep water looked into (scattered light). */
  readonly waterColor: Color;
  /** Tint of light passing through thin water (wave crests, shallows). */
  readonly transmissionColor: Color;
  /** Absorption coefficients per metre, as linear RGB: transmittance is exp(-absorption × distance). */
  readonly absorptionColor: Color;
}

/** Distance fog for every material, blending into the sky's colour toward the horizon. */
export interface OceanFogParameters {
  readonly color: Color;
  /** Distance (m) where fog starts. */
  start: number;
  /** Distance (m) where fog is complete. */
  end: number;
  /** Exponent on the start→end ramp. */
  power: number;
  /** Distance (m) over which the fog colour turns into the sky colour behind it. */
  skyBlendDistance: number;
}

/** Celestial light the ocean shades with. The game owns the values and the scene light. */
export interface OceanSun {
  /** Unit vector from the surface toward the sun (or the moon at night). */
  readonly direction: Vector3;
  intensity: number;
  readonly color: Color;
}

export interface CrestFoamParameters extends WaveFoamParameters {
  /** Tint of whitecap and wake foam, which is lit by the sky and the sun or moon like any white surface. */
  readonly color: Color;
  opacity: number;
  /** 0 round patches … 1 streaks drawn out along the wind. */
  windStretch: number;
}
/** Windrows: old foam the wind draws out in lines along itself. */
export interface SurfaceFoamParameters { readonly color: Color; opacity: number; /** Share of the sea covered, 0–1. */ coverage: number }
export interface ShorelineFoamParameters { readonly color: Color; opacity: number }

/** Realism features, each live and on by default. The developer console turns one off to compare it with the
 * look first tuned to match the library this ocean replaced. */
export interface OceanRealism {
  /** Wavelengths follow a real wind sea's steepness; heights and combat keep the calibration table. */
  seaState: boolean;
  /** Reflections blur by every unresolved facet, with the rough-sea mean Fresnel and sub-pixel sun glitter. */
  reflections: boolean;
  /** The water body's colour comes from absorption and scattering lit by the sun and sky, not a fixed pigment. */
  waterColor: boolean;
  /** Hulls leave a continuous turbulent wake that fades into a calm slick. */
  wake: boolean;
}

/** The facade the game holds (`Ocean.ts`). Game code touches the ocean only through this. */
export interface OceanApi {
  readonly quality: OceanQuality;
  readonly realism: OceanRealism;
  readonly waves: WaveParameters;
  readonly colors: WaterColors;
  readonly foam: { readonly crest: CrestFoamParameters; readonly surface: SurfaceFoamParameters; readonly shoreline: ShorelineFoamParameters };
  readonly fog: OceanFogParameters;
  readonly sun: OceanSun;
  /** Screen-space ship reflections. `screenSpace` is live; `steps` is fixed by the tier (0 when unavailable). */
  readonly reflections: { screenSpace: boolean; maxDistance: number; readonly steps: number };
  readonly wake: WakeFieldApi;
  readonly waveField: WaveField;
  readonly heights: WaveHeightSampler;
  /** Scale on the sky's environment lighting for every material. */
  environmentIntensity: number;
  /** Wave time in seconds. Settable for fixed captures; `update(0)` never advances it. */
  time: number;
  /** True when the camera's near plane may be below the surface this frame. */
  readonly cameraNearSurface: boolean;
  /** Finest vertex spacing of the surface mesh in metres (the clipmap's innermost cells). */
  readonly meshSpacing: number;
  update(dt: number): void;
  setSky(sky: OceanSky | null): void;
  /** Replace the wake the surface reads (the game composes its own foam on top of `wake.sampler`). */
  setWakeSampler(sampler: WakeSampler | null): void;
  /** Sun visibility 0–1 evaluated at the fragment's world position, or null for none. */
  setShadowNode(node: Node<'float'> | null): void;
  /** The underwater view composed over the scene pass output. */
  postProcess(scenePass: import('three/webgpu').PassNode, color: Node<'vec4'>): Node<'vec4'>;
  /** Grow the horizon ring to cover a camera far plane; never shrinks. */
  ensureHorizon(far: number): void;
  /** Let an object ride the surface: y follows the height readback, eased over `smoothing` seconds. */
  addFloater(object: Object3D, options?: { smoothing?: number }): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
