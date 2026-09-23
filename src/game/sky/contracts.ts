/** Interfaces between the sky's parts, and the facade the game holds. Each part lives in its own
 * folder under `src/game/sky/` and depends on the others only through these types, so the
 * atmosphere, celestial bodies, clouds, weather and environment bake can change independently.
 * See `README.md` in this folder for the design and the rules every part keeps. */
import type { Camera, Color, Matrix3, Mesh, Node, Object3D, PassNode, PerspectiveCamera, Texture, TextureNode, UniformNode, Vector3, WebGPURenderer } from 'three/webgpu';
import type { OceanSky } from '../ocean/contracts';

/** Graphics → Clouds. The sky's tier: march budgets, bake sizes, particle counts. Changes live. */
export type SkyQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Which sky draws the scene: the game's own (this folder) or the vendored Sky Pro library it
 * replaced, kept to compare them. Chosen when the port loads. */
export type SkyRendererId = 'game' | 'skypro';

/** What a scene asks of the sky, independent of the renderer drawing it. `VisualEnvironment`
 * writes the whole description on every scene change and developer override; each renderer
 * interprets it. The atmosphere and cloud numbers are the authored map and weather values
 * (`assets/maps/*.json`) after the environment's own shares: they were tuned against Sky Pro, and
 * the game's sky maps them onto its own model rather than reading them as physical constants. */
export interface SkyScene {
  sun: {
    /** Degrees above the horizon; negative below it. */
    elevation: number;
    /** Compass degrees: 0 toward +Z, 90 toward +X. */
    azimuth: number;
    /** Peak daytime radiance scale the sea and scene light share (about 6 in daylight). */
    intensity: number;
  };
  moon: {
    /** 0 new, 0.5 full, 1 new again. The moon rides the sun's arc 2π·phase behind it. */
    phase: number;
  };
  atmosphere: {
    /** Molecular scattering; Sky Pro's scale, where 1 is physical Earth. */
    rayleigh: number;
    /** Aerosol load: 1 very clear, 10 heavy haze. */
    turbidity: number;
    /** Strength of the forward aureole around the sun. */
    mie: number;
    /** Henyey–Greenstein asymmetry of the aerosol, 0–0.99. */
    mieG: number;
    /** Multiple-scattering fill of the dome. */
    multiple: number;
  };
  clouds: {
    /** 0 clear … 1 overcast. A shape control, not a measured sky fraction. */
    coverage: number;
    /** Cloud base above the sea (m). */
    altitude: number;
    /** Depth of the cloud layer (m). */
    thickness: number;
    /** Extra coverage toward the horizon, where a real sky's distant clouds bank up. */
    horizonCoverage: number;
    /** Gain on the sky light filling the clouds. */
    ambient: number;
    /** Darkening of cloud bases, 0–1. */
    baseShadow: number;
    /** Drift speed of the cloud field (m/s). */
    windSpeed: number;
    /** Drift heading, compass degrees the clouds move toward. */
    windHeading: number;
  };
  weather: {
    /** Rain from 0 (none) to 1 (a downpour under storm cells). */
    precipitation: number;
    /** Lightning strikes per minute within sight. 0 for none. */
    lightning: number;
  };
  /** The harbor: sheltered daylight. Renderers may frame their look differently in port. */
  port: boolean;
}

/** The light the sun or moon casts on the scene this frame: what the sea, the scene's
 * DirectionalLight and effects share. Each renderer computes it from its own sky, so the sea and
 * ships are lit in the colour the sky shows (golden at a low sun, blue-white under the moon). */
export interface CelestialLight {
  /** Unit vector toward the active body: the sun by day, the moon once it outshines the sun. */
  readonly direction: Vector3;
  /** Linear RGB tint of that light at the sea (unit peak channel is not required). */
  readonly color: Color;
  /** Radiance scale in the sea's and scene light's units (the scene's `sun.intensity` today). */
  intensity: number;
  /** True when the moon is the active body. */
  night: boolean;
  /** Extra diffuse light from a lightning flash this frame, as a multiple of the scene's ambient (0 = none). */
  flash: number;
}

/** Read-only view of a celestial body for readings, diagnostics and cameras aimed at it. */
export interface CelestialReading {
  /** Unit vector toward the body. */
  readonly direction: Vector3;
  readonly elevationDeg: number;
  /** Compass degrees, (-180, 180]. */
  readonly azimuthDeg: number;
}

/** Lightning the weather part fires. The clouds light their interior from it and the scene flashes. */
export interface LightningStrike {
  /** World position of the channel's brightest point (inside or just below the cloud base). */
  readonly position: Vector3;
  /** Seconds since the first return stroke. */
  age: number;
  /** Straight-line distance from the camera when it fired (m), for thunder's delay. */
  readonly distance: number;
  /** Radiant intensity now, flicker included (0 between return strokes), in the sea's units at 1 km. */
  intensity: number;
}

/** The facade the game holds. Both the game's sky (`Sky.ts`) and the Sky Pro comparison
 * (`../comparison/SkyProSky.ts`) implement it; game code touches the sky only through this. */
export interface SkyApi {
  readonly renderer: SkyRendererId;
  readonly quality: SkyQuality;
  /** Apply a scene description. Everything it names is live; the moon moves with the sun. */
  apply(scene: SkyScene): void;
  /** Advance clouds, weather and bakes by `dt` (0 on a paused frame: nothing moves, passes still run).
   * Runs the sky's GPU passes that precede the scene render. */
  update(dt: number): void;
  /** The active celestial light, refreshed by `apply` and `update`. */
  readonly light: CelestialLight;
  readonly sun: CelestialReading;
  readonly moon: CelestialReading & { readonly phase: number };
  /** Cloud cover (0–1) the scene asked for, for readings. */
  readonly coverage: number;
  /** Diagnostics switch: draw volumetric clouds at all (bakes and shadows follow). */
  cloudsEnabled: boolean;
  /** Linear exposure the display multiplies radiance by (1 neutral). */
  readonly exposure: Node<'float'>;
  /** The provider the ocean reflects and fogs from. */
  readonly oceanSky: OceanSky;
  /** The sky's full-screen additions over the scene in linear radiance, before the display grade:
   * sun shafts and rain haze. Returns `color` when there is nothing to add. */
  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'>;
  /** Sun transmittance through the clouds (1 in full sun, 0 under a thick deck) at a world position.
   * Multiply into the direct celestial light only. */
  cloudShadow(position: Node<'vec3'>): Node<'float'>;
  /** Called when a lightning strike's thunder should be heard; the game's audio owns the sound. */
  onThunder?: (strike: { distance: number; delay: number; loudness: number }) => void;
  /** Backdrop meshes the sky has added to the scene (dome, cloud composite, rain, bolts). */
  meshes(): Object3D[];
  /** Drop temporal history, after a camera cut or a scene change a capture must not smear. */
  resetHistory(): void;
  /** CSS pixels, as `renderer.setSize`; the pixel ratio is applied internally. */
  resize(width: number, height: number): void;
  setQuality(quality: SkyQuality): Promise<void>;
  diagnostics(): Record<string, unknown>;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Parts. The facade (`Sky.ts`) builds one of each through the factories in each folder's
// `index.ts` and composes their nodes; `stubs/` holds a minimal implementation of every part.
// ---------------------------------------------------------------------------------------------

/** Uniforms every part reads, written once per frame by the facade (`uniforms.ts`). Parts never
 * write them. Directions are unit world vectors; radiometric values are in the sea's units. */
export interface SkyUniforms {
  /** Toward the sun. */
  readonly sunDirection: UniformNode<'vec3', Vector3>;
  /** Sun irradiance above the atmosphere: the scene's `sun.intensity` times its white tint. */
  readonly sunIrradiance: UniformNode<'vec3', Vector3>;
  /** Toward the moon. */
  readonly moonDirection: UniformNode<'vec3', Vector3>;
  /** Moonlight above the atmosphere, phase included, already lifted for night readability. */
  readonly moonIrradiance: UniformNode<'vec3', Vector3>;
  /** 0 new … 0.5 full … 1 new. */
  readonly moonPhase: UniformNode<'float', number>;
  /** World → celestial frame (the stars' and Milky Way's), from the celestial model. */
  readonly starRotation: UniformNode<'mat3', Matrix3>;
  /** Camera world position. */
  readonly cameraPosition: UniformNode<'vec3', Vector3>;
  /** Seconds of sky time: advances with `update(dt)`, frozen on paused frames. */
  readonly time: UniformNode<'float', number>;
  /** Accumulated cloud-field drift (m) in world XZ, integrated from the scene's wind. */
  readonly windOffset: UniformNode<'vec3', Vector3>;
  /** Toward the active celestial light (the sun by day, the moon once it outshines the sun), and that light's
   * colour × intensity at the sea: the scene light's own values (`CelestialLight`), for shafts and rain. */
  readonly lightDirection: UniformNode<'vec3', Vector3>;
  readonly lightColor: UniformNode<'vec3', Vector3>;
  /** Lightning lighting the clouds: world position of the channel and its current radiant intensity (0 dark). */
  readonly lightningPosition: UniformNode<'vec3', Vector3>;
  readonly lightningIntensity: UniformNode<'float', number>;
}

/** What every part factory receives (`createAtmosphere(context)` and so on in each folder's `index.ts`). */
export interface SkyPartContext {
  readonly renderer: WebGPURenderer;
  readonly uniforms: SkyUniforms;
  /** The tier at creation; later changes arrive through `setQuality`. */
  readonly quality: SkyQuality;
  /** The scene pass uses reversed depth (cleared to 0, far at 0). */
  readonly reversedDepth: boolean;
}

/** What a part needs each frame. */
export interface SkyFrame {
  readonly renderer: WebGPURenderer;
  readonly camera: PerspectiveCamera;
  /** Seconds since the previous frame; 0 when paused. */
  readonly dt: number;
  /** True when the camera jumped (a cut): temporal parts drop their history. */
  readonly cut: boolean;
}

interface SkyPart {
  /** GPU passes before the scene render (LUTs, marches, bakes). */
  update(frame: SkyFrame): void;
  setQuality(quality: SkyQuality): void | Promise<void>;
  /** Drawing-buffer pixels (CSS × pixel ratio). */
  resize?(width: number, height: number): void;
  dispose(): void;
}

/** Scattering in the air: the dome's colour, haze toward the horizon, the colour of sunlight at
 * any altitude and the light filling the clouds. `atmosphere/`. */
export interface AtmospherePart extends SkyPart {
  /** Apply the scene's authored atmosphere (live). */
  apply(scene: SkyScene): void;
  /** Sky radiance along a world direction, sun and moon discs excluded (moonlit sky included at
   * night). Linear HDR in the sea's units. Below the horizon: the horizon's colour, never black.
   * Seen from the camera, or with `fromSea` from sea level under it (the environment bake: the
   * chart's camera can stand 14 km up, where the sky it sees is not the one the sea reflects). */
  sky(direction: Node<'vec3'>, fromSea?: boolean): Node<'vec3'>;
  /** Transmittance to space along a direction, from the camera or from sea level: dims and
   * reddens what lies beyond the air (sun disc, moon, stars). */
  transmittanceToSpace(direction: Node<'vec3'>, fromSea?: boolean): Node<'vec3'>;
  /** Share of the sun's and moon's light reaching a world position (altitude and Earth's shadow
   * included), for lighting clouds and rain from within. */
  sunTransmittance(position: Node<'vec3'>): Node<'vec3'>;
  moonTransmittance(position: Node<'vec3'>): Node<'vec3'>;
  /** Aerial perspective between the camera and the point `distance` metres along `direction`:
   * what the air in between adds, and what it lets through. Works in any pass (screen or bake). */
  aerial(direction: Node<'vec3'>, distance: Node<'float'>): { inscatter: Node<'vec3'>; transmittance: Node<'vec3'> };
  /** Diffuse sky light at an altitude: arriving from above (sky) and from below (sea bounce). */
  ambient(altitude: Node<'float'>): { above: Node<'vec3'>; below: Node<'vec3'> };
  /** CPU: sunlight and moonlight at sea level for the scene light, as colour × intensity
   * (the sea's units), and the zenith sky irradiance. Refreshed by `apply` and `update`. */
  readonly seaLevel: { readonly sun: Color; readonly moon: Color; readonly sky: Color };
}

/** The bodies beyond the air: sun disc, moon with its phase, stars and the Milky Way, and the
 * light shafts they cast through gaps. `celestial/`. The CPU model that places them is `../celestialModel.ts`. */
export interface CelestialPart extends SkyPart {
  /** Radiance above the atmosphere along a world direction: sun disc, moon, stars, Milky Way.
   * The dome multiplies it by the atmosphere's transmittance to space. */
  radiance(direction: Node<'vec3'>): Node<'vec3'>;
  /** The same without the sun disc and stars: what a blurred reflection bake should hold. */
  diffuseRadiance(direction: Node<'vec3'>): Node<'vec3'>;
  /** Screen-space sun (or moon) shafts over the scene, in linear radiance. `skyVisibility` is the
   * clouds' screen transmittance (1 where no cloud), or null. */
  shafts(scenePass: PassNode, color: Node<'vec4'>, skyVisibility: TextureNode | null): Node<'vec4'>;
}

/** Volumetric cloud layer, cirrus, cloud shadows and rain shafts. `clouds/`. */
export interface CloudPart extends SkyPart {
  apply(scene: SkyScene): void;
  enabled: boolean;
  /** Full-screen composite drawn right after the sea in the transparent queue: premultiplied
   * cloud radiance over whatever is behind, depth-tested at the clouds' distance. */
  readonly composite: Mesh;
  /** High cirrus over `behind` (the dome colour) along a direction. */
  cirrus(direction: Node<'vec3'>, behind: Node<'vec3'>): Node<'vec3'>;
  /** A short march for bakes along `direction` from `origin`: premultiplied radiance in rgb,
   * transmittance in a. Aerial perspective included. */
  bake(origin: Node<'vec3'>, direction: Node<'vec3'>): Node<'vec4'>;
  /** Sun transmittance through the clouds at a world position; 1 outside the map. */
  shadow(position: Node<'vec3'>): Node<'float'>;
  /** Screen-space cloud transmittance this frame (1 = no cloud), for sun shafts. */
  readonly screenTransmittance: TextureNode | null;
}

/** Rain, lightning and thunder. `weather/`. */
export interface WeatherPart extends SkyPart {
  apply(scene: SkyScene): void;
  /** Meshes it draws in the scene: rain streaks, splashes, bolts. */
  readonly meshes: Object3D[];
  /** The latest strike, while it lights anything. */
  readonly strike: LightningStrike | null;
  /** Extra diffuse light from lightning this frame (see `CelestialLight.flash`). */
  readonly flash: number;
  /** Full-screen rain haze in linear radiance, or `color` unchanged when dry. */
  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'>;
  /** Thunder heard for a strike, set by the facade. */
  onThunder?: (strike: { distance: number; delay: number; loudness: number }) => void;
}

/** The environment the sea reflects and every material is lit by. `environment/`. */
export interface EnvironmentPart extends SkyPart {
  /** Equirectangular linear HDR radiance around a sea-level point under the camera: dome,
   * celestial bodies and clouds. The same texture object until the tier changes its size;
   * `pmremVersion` bumps after every refreshed bake. */
  readonly texture: Texture;
  readonly oceanSky: OceanSky;
  /** Re-centre on the camera's XZ. */
  followCamera(camera: Camera): void;
}

/** Everything the environment bake composes, built by the facade from the other parts. */
export interface EnvironmentSources {
  /** Dome radiance from sea level along a direction: sky, celestial bodies, cirrus. */
  dome(direction: Node<'vec3'>): Node<'vec3'>;
  /** Sky radiance seen from the camera, without discs, stars or clouds: the colour the sea's
   * distance fog turns into (`OceanSky.createFogSampler`). */
  fog(direction: Node<'vec3'>): Node<'vec3'>;
  readonly clouds: CloudPart;
  /** The sky's backdrop meshes (`OceanSky.getMeshes`): the sea turns their fog off. */
  meshes(): Object3D[];
}
