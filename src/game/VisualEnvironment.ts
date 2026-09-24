import { Color, HemisphereLight, MathUtils, PointLight, Vector2, Vector3, type DirectionalLight, type Node, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import { float, mix, smoothstep, uniform } from 'three/tsl';
import type { OceanApi } from './ocean/contracts';
import type { CelestialLight, SkyApi, SkyScene } from './sky/contracts';
import { windrowCoverage } from './ocean/waves/whitecaps';
import { DEFAULT_MAP, oceanMap, type OceanMapId } from '../maps/catalog';
import { battleEnvironment, type BattleConditions, type TimeOfDayId, type WeatherId } from '../maps/conditions';
import { battlePrecipitation } from '../maps/precipitation';

/** The harbor's standing wind. Its sea resolves through the same calibrated
 * curve as a battle's, so the console's reading is the sea on screen. */
export const PORT_WIND = { speed: 9, direction: 35 };

/** Effects that follow the scene's wind and celestial light without owning any of it. */
export interface EnvironmentSinks {
  effects: { setWind(speed: number, direction: number): void; setSun(direction: Vector3, intensity: number): void; setIllumination(color: Color, intensity: number, ambient: number): void };
  funnelSmoke: { setWind(speed: number, direction: number): void };
  /** Stable motion anchor the sun shadow follows, independent of the loaded hull. */
  sunAnchor: Pick<Object3D, 'position'>;
}
export interface BattleScene { timeOfDay: TimeOfDayId; weather: WeatherId; conditions: BattleConditions; }
/** Developer console overrides on top of the current scene. Each field replaces
 * only what it names; a new scene clears them all. */
/** `precipitation` is a percentage, like `cloudCover`; `lightning` strikes per minute; `moonPhase` 0 new … 0.5 full. */
export interface EnvironmentOverrides extends BattleConditions { windDirection?: number; visibilityKm?: number; moonPhase?: number; precipitation?: number; lightning?: number; }
/** The weather on screen now, read back from the live sky and water. */
export interface EnvironmentReading {
  timeHours?: number; sunElevation: number; cloudCover: number;
  windSpeed: number; windDirection: number; visibilityKm: number;
  /** 0 new … 0.5 full. */
  moonPhase: number;
  /** Percent. */
  precipitation: number;
  /** Strikes per minute. */
  lightning: number;
}
/** The developer console's view of a scene's weather. */
export interface DeveloperWeather {
  scene: 'port' | 'battle'; reading: EnvironmentReading; overrides: EnvironmentOverrides;
  /** Online battles keep the server's conditions. */
  locked: boolean;
  /** The wind the local sea physics ride, in a local battle. */
  seaWind?: number;
}

/** Share of each scene's authored forward sun haze that reaches the sky. At full
 * strength the aureole bleached a third of the sun-facing sky and its reflections. */
const SUN_HAZE = .45;
/** A full moon unless the developer console picks another phase: the brightest night. */
const MOON_PHASE = .5;
/** Opacity of a windrow's old foam: a thin film the sea shows through. */
const WINDROW_OPACITY = .5;
/** Windrows at `windSpeed` (m/s), with the map's whitecap `scale`: lines of old foam covering their share of the wind's
 * whitecap coverage. */
export function windrowFoam(windSpeed: number, scale = 1): { coverage: number; opacity: number } {
  return { opacity: WINDROW_OPACITY, coverage: windrowCoverage(windSpeed, scale) };
}
/** e-folding lifetime of whitecap foam in periods of the breaking waves: 2.6 s for a 9 m/s sea's breakers, 5 s for a
 * storm's big ones, within the few to ten seconds real stage-B foam takes to clear (Callaghan et al. 2012). */
export const WHITECAP_LIFETIME = 1;
/** The map foam value whose whitecaps cover what the wind calls for (the Atlantic's); other maps scale their coverage
 * by their value over this one, so a calmer-looking sea has fewer whitecaps, not greyer ones. */
const REFERENCE_FOAM = .45;
/** Moonlight on meshes, as a multiple of the moon the sea and sky see, and the night's
 * multiple of the authored fill. At the sun's shares a moonlit hull read almost black
 * against the sea; these lift decks and superstructure to a readable gray. Only meshes
 * take them: the night sky, sea and smoke keep the raw moon. */
const MESH_MOONLIGHT = 1.5, MESH_NIGHT_FILL = 1.6;

/** Lightning's colour on lit meshes: the blue-white of a return stroke, as the rain veil glows toward it. */
const BOLT_TINT = new Color(.8, .87, 1);
/** Most irradiance lightning may lay on the meshes around the camera: about a sixth of the noon sun's on them. A stroke within a
 * couple of kilometres is brighter for its instant, but the sea and the air around the ships do not flash with them, and a
 * hull lit like day on a dark sea reads as a searchlight. */
export const BOLT_CEILING = 1;

/** Direct light at which the day's shares start and complete. */
const FILL_DAYLIGHT = [1, 4] as const;

/** Shares of the active celestial light that reach lit meshes: the scene DirectionalLight's multiple of the light's
 * intensity, the hemisphere fill's multiple of the scene's authored ambient, and the sky reflection's intensity.
 *
 * By day meshes take the whole sun and the whole sky light, and no hemisphere fill. The sky's image-based light is the
 * graded dome and the sea below it, so it already holds everything a hull sees besides the sun: at a 70° noon sun it gives
 * 6:1 direct to diffuse light on a deck, inside a clear sky's 5-8:1, and a shaded deck three stops under a sunlit one, as a
 * photographer's open shade is. The hemisphere fill is light no sky casts, and it flattened shade toward sunlight. Meshes
 * once took 0.55 of the sun, 0.66 of the sky and 0.33 of the fill, an ACES-era calibration that left a sunlit 18 % gray
 * card at 0.8 of the average sky's radiance where a real one is 1 to 1.5. As the sun fades the fill returns, as it always
 * has: with no strong sun a backlit hull has little else. By night meshes take more than the moon (`MESH_MOONLIGHT`,
 * `MESH_NIGHT_FILL`). */
export function meshLightShares(light: Pick<CelestialLight, 'intensity' | 'night'>): { sun: number; fill: number; sky: number } {
  if (light.night) return { sun: MESH_MOONLIGHT, fill: MESH_NIGHT_FILL, sky: 1 };
  return { sun: 1, fill: 1 - MathUtils.smoothstep(light.intensity, ...FILL_DAYLIGHT), sky: 1 };
}

/** The harbor's sheltered daylight, wherever the developer console overrides nothing: the sun, air and
 * cloud deck the port shows, and its ambient fill. The model viewer lights its models with the same. */
export const PORT_LIGHT = {
  sun: { elevation: 36, azimuth: 58, intensity: 5.8 },
  atmosphere: { rayleigh: .42, turbidity: 3.2, mie: .25, mieG: .6, multiple: 1.4 },
  clouds: { coverage: .38, altitude: 1700, thickness: 2400, horizonCoverage: .06, ambient: 1.1, baseShadow: .2 },
  ambient: 1.75,
} as const;
/** The berth's clearing: in port no cloud shades the ship or the water within `reach` metres of her, and the clouds' shadow
 * returns by `fade`, as through a gap in the deck over the harbor. The port is where a ship is looked at, and a passing
 * cumulus left her in shade for minutes at a time. The clouds themselves still cross the sky. */
export const PORT_CLEARING = { reach: 350, fade: 900 } as const;
/** Sky and ground colours of the hemisphere fill every lit mesh takes. */
export const MESH_FILL_COLORS = { sky: '#dcebf2', ground: '#65757e' } as const;

/** Applies resolved battle conditions to the ocean and the sky, and owns
 * every live override of those parameters: the port's daylight and standing wind, the air map's
 * far fog, underwater attenuation and the celestial light shared with the scene's
 * lights, the sea and smoke. CPU combat reads the same resolved conditions through the
 * renderer-free conditions module; nothing here can move a hull. */
export class VisualEnvironment {
  readonly ambientLight = new HemisphereLight(MESH_FILL_COLORS.sky, MESH_FILL_COLORS.ground, .65);
  /** Lightning's direct light on lit meshes (`CelestialLight.bolt`): a point at the stroke, falling off with the square of the
   * distance, without shadows. Always in the scene, dark between flashes, so nothing recompiles as a storm begins. */
  readonly boltLight = new PointLight(BOLT_TINT, 0, 0, 2);
  /** The scene's authored ambient before the mesh share; smoke and diagnostics read this. */
  private ambient = .65;
  private ocean?: OceanApi;
  private sunLight?: DirectionalLight;
  private sky?: SkyApi;
  /** The description last handed to the sky, for diagnostics. */
  private skyScene?: SkyScene;
  private mapId: OceanMapId = DEFAULT_MAP;
  private inPort = false;
  /** The berth's position on the sea (x, z) and whether its clearing applies (`PORT_CLEARING`). */
  private readonly berth = uniform(new Vector2());
  private readonly clearing = uniform(0);
  private battle: BattleScene = { timeOfDay: 'map', weather: 'map', conditions: {} };
  private overrides: EnvironmentOverrides = {};
  private chartFog = false;
  // Original swatches, restored exactly when the camera surfaces again.
  private surfaceAbsorption = new Color();
  private shadowFocus?: Vector3;
  /** Where lightning's light is measured against its ceiling: the camera, as of the last update. */
  private readonly viewpoint = new Vector3();

  constructor(private sinks: EnvironmentSinks) { this.boltLight.name = 'Lightning'; }

  /** Rain on the scene now, 0 dry … 1 a downpour: the sky's, developer overrides included. */
  get precipitation(): number { return this.skyScene?.weather.precipitation ?? 0; }

  /** The ocean's absorption becomes the surface baseline the underwater easing returns to.
   * `sunLight` is the scene light meshes use; the ocean shades from its own sun uniforms. */
  attachOcean(ocean: OceanApi, sunLight: DirectionalLight): void {
    this.ocean = ocean;
    this.sunLight = sunLight;
    this.surfaceAbsorption.copy(ocean.colors.absorptionColor);
  }
  /** `update` advances the sky and shares its light every frame. */
  attachSky(sky: SkyApi): void { this.sky = sky; }
  /** Conditions for the next launch; the port keeps its own daylight until the scene changes. */
  setBattle(battle: BattleScene): void { this.battle = { ...battle, conditions: { ...battle.conditions } }; }
  /** Apply the sea, sky, fog and wind for a map in port or at sea. A new scene drops developer overrides. */
  setScene(mapId: OceanMapId, inPort: boolean): void {
    this.mapId = mapId; this.inPort = inPort; this.chartFog = false; this.overrides = {};
    this.applySea(); this.applyLighting();
  }
  /** Replace the developer overrides and reapply the scene live. */
  setOverrides(overrides: EnvironmentOverrides): void {
    this.overrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
    this.applySea(); this.applyLighting();
  }
  getOverrides(): EnvironmentOverrides { return { ...this.overrides }; }
  /** What the scene shows now, overrides included. The port's sheltered light has no clock time. */
  reading(): EnvironmentReading | undefined {
    if (!this.sky || !this.ocean) return undefined;
    const timeHours = this.overrides.timeHours ?? (this.inPort ? undefined : this.battle.conditions.timeHours);
    return { timeHours, sunElevation: this.sky.sun.elevationDeg, cloudCover: this.sky.coverage * 100,
      windSpeed: this.ocean.waves.windSpeed,
      windDirection: MathUtils.euclideanModulo(this.ocean.waves.windDirection * 180 / Math.PI, 360),
      visibilityKm: this.sceneFogEnd() / 1000, moonPhase: this.sky.moon.phase,
      precipitation: (this.skyScene?.weather.precipitation ?? 0) * 100, lightning: this.skyScene?.weather.lightning ?? 0 };
  }
  /** The air map raises the camera far above the authored fog; closing it restores the scene's fog. */
  setChartFog(enabled: boolean): void { this.chartFog = enabled; this.applyFog(); }
  /** Where the sun's shadow map centres until cleared: a hull seen through the lens. */
  setShadowFocus(position?: Vector3): void {
    if (position) (this.shadowFocus ??= new Vector3()).copy(position);
    else this.shadowFocus = undefined;
  }
  /** Per frame, before the ocean updates: advance the sky, share its light, and attenuate for a submerged camera. */
  update(camera: PerspectiveCamera, dt: number): void {
    this.viewpoint.copy(camera.position);
    this.sky?.update(dt);
    this.syncLighting();
    if (!this.ocean) return;
    // The maps' absorption loses >99% of green/blue light over 50 m,
    // hiding even our own submarine. Ease to a 20× longer visibility range
    // over the first 2 m of camera submersion; keep distant water hazy and
    // restore the exact surface swatch when the camera comes back up.
    const submerged = MathUtils.smoothstep(-camera.position.y, 0, 2);
    this.ocean.colors.absorptionColor.copy(this.surfaceAbsorption).multiplyScalar(MathUtils.lerp(1, .05, submerged));
  }
  diagnostics() {
    return { waves: this.ocean ? { significantHeight: this.ocean.waves.significantHeight, windSpeed: this.ocean.waves.windSpeed,
        peakWavelength: this.ocean.waves.peakWavelength } : undefined,
      ...this.battle.conditions, timeOfDay: this.battle.timeOfDay, weather: this.battle.weather,
      environment: this.sky && this.skyScene ? { sunElevation: this.sky.sun.elevationDeg, sunAzimuth: this.sky.sun.azimuthDeg,
        sunIntensity: this.skyScene.sun.intensity, ambient: this.ambient,
        cloudCoverage: this.sky.coverage, cloudWind: this.skyScene.clouds.windSpeed,
        cloudAmbient: this.skyScene.clouds.ambient, precipitation: this.skyScene.weather.precipitation,
        lightning: this.skyScene.weather.lightning, moonPhase: this.skyScene.moon.phase, fogEnd: this.ocean?.fog.end,
        sky: this.sky.diagnostics() } : undefined };
  }

  private resolved() {
    const map = oceanMap(this.mapId);
    // The port resolves its standing wind and any override through the same sea
    // and day model on the berth's map; its sheltered light stays wherever
    // nothing is overridden.
    const conditions: BattleConditions = this.inPort ? { windSpeed: PORT_WIND.speed } : { ...this.battle.conditions };
    for (const key of ['timeHours', 'cloudCover', 'windSpeed'] as const) if (this.overrides[key] !== undefined) conditions[key] = this.overrides[key];
    return { map, environment: this.inPort ? battleEnvironment(map, 'map', 'map', conditions)
      : battleEnvironment(map, this.battle.timeOfDay, this.battle.weather, conditions),
      rain: this.inPort ? { precipitation: 0, lightning: 0 } : battlePrecipitation(this.battle.weather, conditions) };
  }
  private get shelteredLight() { return this.inPort && this.overrides.timeHours === undefined; }
  private applySea(): void {
    const ocean = this.ocean;
    if (!ocean) return;
    const { map, environment: { waves, waterLightScale } } = this.resolved();
    // The calibrated metric sea: the ocean normalises its spectrum to this significant height.
    Object.assign(ocean.waves, { significantHeight: waves.significantHeightM, windSpeed: waves.windSpeed, peakWavelength: waves.peakWavelength,
      choppiness: waves.choppiness, gamma: 2.6, dirty: true,
      windDirection: (this.overrides.windDirection ?? (this.inPort ? PORT_WIND.direction : map.water.windDirection)) * Math.PI / 180 });
    const colors = this.inPort ? oceanMap(DEFAULT_MAP).water : map.water;
    // The water pigment and foam are emitted radiance that bypasses scene lighting. Derive it
    // from the original swatches so night seas do not glow blue/white.
    const waterFill = this.shelteredLight ? 1 : waterLightScale;
    ocean.colors.waterColor.set(colors.waterColor).multiplyScalar(waterFill);
    ocean.colors.transmissionColor.set(colors.transmissionColor).multiplyScalar(waterFill);
    ocean.colors.absorptionColor.set(colors.absorptionColor);
    this.surfaceAbsorption.copy(ocean.colors.absorptionColor);
    // Foam is lit by the sky and the sun or moon like any white surface, so night needs no scaling of its tint.
    const { crest, surface, shoreline } = ocean.foam;
    surface.color.setScalar(1);
    crest.color.setScalar(1);
    shoreline.color.set('#edf9fd');
    // Whitecaps cover the share of the sea the wind calls for; the ocean places them from its own spectrum.
    Object.assign(crest, { opacity: 1, windStretch: .5, coverageScale: map.water.foam / REFERENCE_FOAM, lifetime: WHITECAP_LIFETIME });
    Object.assign(surface, windrowFoam(waves.windSpeed, crest.coverageScale));
    this.sinks.effects.setWind(ocean.waves.windSpeed, ocean.waves.windDirection);
    this.sinks.funnelSmoke.setWind(ocean.waves.windSpeed, ocean.waves.windDirection);
  }
  private applyLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { map, environment, rain } = this.resolved(), authored = environment.sky, port = this.shelteredLight;
    const clouds = this.inPort && this.overrides.cloudCover === undefined;
    const overrides = this.overrides;
    // Clouds drift with the sea's wind: the ocean's direction runs from +X toward +Z, the sky's heading is a compass bearing.
    const windDirection = overrides.windDirection ?? (this.inPort ? PORT_WIND.direction : map.water.windDirection);
    // Diffuse fill softens the dark blue dome toward the hills. Keep the port's
    // forward sun haze restrained so it cannot wash out the sky and reflections.
    this.skyScene = {
      sun: port ? { ...PORT_LIGHT.sun } : { elevation: authored.elevation, azimuth: authored.azimuth, intensity: authored.intensity },
      moon: { phase: overrides.moonPhase ?? MOON_PHASE },
      atmosphere: port ? { ...PORT_LIGHT.atmosphere } : { rayleigh: authored.rayleigh, turbidity: authored.turbidity,
        mie: authored.mie * SUN_HAZE, mieG: authored.mieG, multiple: authored.multiple },
      clouds: { coverage: clouds ? PORT_LIGHT.clouds.coverage : authored.coverage, altitude: this.inPort ? PORT_LIGHT.clouds.altitude : authored.altitude,
        thickness: this.inPort ? PORT_LIGHT.clouds.thickness : authored.thickness, horizonCoverage: clouds ? PORT_LIGHT.clouds.horizonCoverage : environment.horizonCoverage,
        ambient: port ? PORT_LIGHT.clouds.ambient : environment.cloudAmbient, baseShadow: port ? PORT_LIGHT.clouds.baseShadow : environment.cloudShadow,
        windSpeed: environment.cloudWind, windHeading: MathUtils.euclideanModulo(90 - windDirection, 360) },
      weather: { precipitation: overrides.precipitation !== undefined ? overrides.precipitation / 100 : rain.precipitation,
        lightning: overrides.lightning ?? rain.lightning },
      port: this.inPort,
    };
    sky.apply(this.skyScene);
    // Lift shaded hulls without raising sea/sky exposure.
    this.ambient = port ? PORT_LIGHT.ambient : authored.ambient;
    this.ambientLight.intensity = this.ambient;
    this.applyFog();
  }
  private applyFog(): void {
    const ocean = this.ocean;
    if (!ocean) return;
    // The ocean owns scene.fogNode, including the sea/sky horizon blend; its parameters are live.
    const { environment: { fog } } = this.resolved();
    const scene = this.inPort ? { start: 650, end: 5600, skyBlend: 2600 } : fog;
    // A visibility override moves the whole fog ramp, keeping the scene's proportions.
    const scale = this.overrides.visibilityKm === undefined ? 1 : this.overrides.visibilityKm * 1000 / scene.end;
    ocean.fog.color.set(this.shelteredLight ? '#819aa5' : fog.color);
    ocean.fog.start = this.chartFog ? 400000 : scene.start * scale;
    ocean.fog.end = this.chartFog ? 900000 : scene.end * scale;
    ocean.fog.power = this.inPort ? .85 : 1.4;
    ocean.fog.skyBlendDistance = scene.skyBlend * scale;
    // The port's short, sheltered ramp is a showroom choice, not a visual range; battles may take real haze.
    ocean.fog.aerial = !this.inPort;
  }
  /** The scene's fog end, ignoring the air map's temporary far fog. */
  private sceneFogEnd(): number {
    const end = this.inPort ? 5600 : this.resolved().environment.fog.end;
    return this.overrides.visibilityKm === undefined ? end : this.overrides.visibilityKm * 1000;
  }
  /** `shadow`, the clouds' transmittance of the sun at a world position, with the port's clearing over the berth
   * (`PORT_CLEARING`). The sun's shadow maps and the sea both take it, so ship and water agree. */
  clearBerth(shadow: (position: Node<'vec3'>) => Node<'float'>): (position: Node<'vec3'>) => Node<'float'> {
    const { reach, fade } = PORT_CLEARING;
    return position => {
      const clear = float(1).sub(smoothstep(reach, fade, position.xz.sub(this.berth).length())).mul(this.clearing);
      return mix(shadow(position), float(1), clear);
    };
  }
  /** Share the sky's active celestial light: the sun, warmed by the air when low, or the moon
   * once it outshines the sun. It reaches the sea, the scene light and its shadows, and smoke,
   * including on paused frames. A lightning flash lifts the diffuse fill for its instant and lights meshes from the stroke. */
  syncLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { direction, color, intensity, night, flash, bolt } = sky.light, shares = meshLightShares(sky.light);
    const anchor = this.sinks.sunAnchor.position;
    this.berth.value.set(anchor.x, anchor.z);
    this.clearing.value = this.shelteredLight ? 1 : 0;
    // Irradiance `intensity × (1 km / r)²`: a point of that many candela.
    const candela = bolt.intensity * 1e6, near = bolt.position.distanceToSquared(this.viewpoint);
    this.boltLight.position.copy(bolt.position);
    this.boltLight.intensity = Math.min(candela, BOLT_CEILING * Math.max(near, 1));
    if (this.ocean) {
      // The sea shades with the raw celestial light; only the scene light meshes use is scaled.
      this.ocean.sun.direction.copy(direction);
      this.ocean.sun.intensity = intensity;
      this.ocean.sun.color.copy(color);
      this.ambientLight.intensity = this.ambient * shares.fill * (1 + flash);
      this.ocean.environmentIntensity = shares.sky;
    }
    const light = this.sunLight;
    if (light) {
      light.intensity = intensity * shares.sun;
      light.color.copy(color);
      light.target.position.copy(this.inPort ? this.sinks.sunAnchor.position : this.shadowFocus ?? this.sinks.sunAnchor.position);
      light.position.copy(direction).multiplyScalar(this.inPort ? 800 : 500).add(light.target.position);
      light.target.updateMatrixWorld();
    }
    this.sinks.effects.setSun(direction, this.inPort ? 1 : Math.min(1, night
      ? .18 + this.ambient * .5 : this.ambient * .45 + intensity * .09));
    this.sinks.effects.setIllumination(color, intensity, this.ambient * (1 + flash));
  }
}
