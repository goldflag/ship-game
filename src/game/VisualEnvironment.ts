import { Color, HemisphereLight, MathUtils, Vector3, type DirectionalLight, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import type { OceanApi } from './ocean/contracts';
import type { SkySystem } from '../../vendor/threejs-sky-pro/build/index.js';
import { DEFAULT_MAP, oceanMap, type OceanMapId } from '../maps/catalog';
import { battleEnvironment, type BattleConditions, type TimeOfDayId, type WeatherId } from '../maps/conditions';

const DAYLIGHT_COLOR = new Color(1, 1, 1);
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
export interface EnvironmentOverrides extends BattleConditions { windDirection?: number; visibilityKm?: number; }
/** The weather on screen now, read back from the live sky and water. */
export interface EnvironmentReading {
  timeHours?: number; sunElevation: number; cloudCover: number;
  windSpeed: number; windDirection: number; visibilityKm: number;
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
/** Sun and moon disc radius as `1 - cos(θ)`: a 1.4° disc, under three times life size.
 * Sky Pro's presets draw them at 3.2° and 3.6°. */
const CELESTIAL_DISC = 7.5e-5;
/** Streaks of residual foam the wind draws out: none up to a fresh breeze (m/s), this opacity by a storm. */
const SURFACE_FOAM_WIND = [10, 25] as const, SURFACE_FOAM_OPACITY = .15;
/** Sky Pro's sky and the ocean are tuned by eye against the raw sun.
 * Three's lit meshes turn the same intensity into about twice the light a Cycles
 * render of the same GLB shows: 0.29-albedo Kure gray reached sRGB 200 in port.
 * Only the scene's DirectionalLight is scaled; the sky, sea and smoke keep the raw sun.
 * The daylight shares below are their ACES calibration divided by the display look's
 * 0.9 exposure (`DISPLAY_LOOK`), so sunlit Kure gray still reads mid-gray, about sRGB 130. */
const MESH_SUNLIGHT = .55;
/** Share of the authored hemisphere fill, and of sky reflection, that reaches lit
 * meshes in full daylight. Neither is occluded, so at full strength shaded faces
 * read nearly as bright as sunlit ones. Without a strong sun the fill is all a
 * backlit hull has, so the shares return to 1 as the sun fades. */
const MESH_FILL = .33, MESH_SKY = .66;
/** Direct light at which the daylight shares start and complete. */
const FILL_DAYLIGHT = [1, 4] as const;
/** Moonlight on meshes, as a multiple of the moon the sea and sky see, and the night's
 * multiple of the authored fill. At the sun's shares a moonlit hull read almost black
 * against the sea; these lift decks and superstructure to a readable gray. Only meshes
 * take them: the night sky, sea and smoke keep the raw moon. */
const MESH_MOONLIGHT = 1.5, MESH_NIGHT_FILL = 1.6;

/** Applies resolved battle conditions to the ocean and the licensed sky, and owns
 * every live override of those parameters: the port's daylight and standing wind, the air map's
 * far fog, underwater attenuation and the celestial light shared with the scene's
 * lights, the sea and smoke. CPU combat reads the same resolved conditions through the
 * renderer-free conditions module; nothing here can move a hull. */
export class VisualEnvironment {
  readonly ambientLight = new HemisphereLight('#dcebf2', '#65757e', .65);
  /** The scene's authored ambient before the mesh share; smoke and diagnostics read this. */
  private ambient = .65;
  private ocean?: OceanApi;
  private sunLight?: DirectionalLight;
  private sky?: SkySystem;
  private mapId: OceanMapId = DEFAULT_MAP;
  private inPort = false;
  private battle: BattleScene = { timeOfDay: 'map', weather: 'map', conditions: {} };
  private overrides: EnvironmentOverrides = {};
  private chartFog = false;
  // Original swatches, restored exactly when the camera surfaces again.
  private surfaceAbsorption = new Color();
  private celestialColor = new Color();
  private readonly sunriseColor = new Color('#ffd1a0');
  private shadowFocus?: Vector3;

  constructor(private sinks: EnvironmentSinks) {}

  /** The ocean's absorption becomes the surface baseline the underwater easing returns to.
   * `sunLight` is the scene light meshes use; the ocean shades from its own sun uniforms. */
  attachOcean(ocean: OceanApi, sunLight: DirectionalLight): void {
    this.ocean = ocean;
    this.sunLight = sunLight;
    this.surfaceAbsorption.copy(ocean.colors.absorptionColor);
  }
  /** Sky is attached after its preset; `update` shares its light every frame. */
  attachSky(sky: SkySystem): void {
    this.sky = sky;
    // Lift the dark horizon band without retuning the authored sky palette.
    sky.atmosphere.horizonCorrection.value = .8;
    sky.sun.discSize.value = CELESTIAL_DISC;
    sky.timeOfDay.moonAngularSize.value = CELESTIAL_DISC;
  }
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
    return { timeHours, sunElevation: this.sky.sun.elevationDeg, cloudCover: this.sky.clouds.shape.coverage.value * 100,
      windSpeed: this.ocean.waves.windSpeed,
      windDirection: MathUtils.euclideanModulo(this.ocean.waves.windDirection * 180 / Math.PI, 360),
      visibilityKm: this.sceneFogEnd() / 1000 };
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
      environment: this.sky ? { sunElevation: this.sky.sun.elevationDeg, sunAzimuth: this.sky.sun.azimuthDeg,
        sunIntensity: this.sky.sun.peakIntensity, ambient: this.ambient,
        cloudCoverage: this.sky.clouds.shape.coverage.value, cloudWind: this.sky.clouds.wind.speed,
        cloudAmbient: this.sky.clouds.lighting.ambientIntensity.value, fogEnd: this.ocean?.fog.end } : undefined };
  }

  private resolved() {
    const map = oceanMap(this.mapId);
    // The port resolves its standing wind and any override through the same sea
    // and day model on the berth's map; its sheltered light stays wherever
    // nothing is overridden.
    const conditions: BattleConditions = this.inPort ? { windSpeed: PORT_WIND.speed } : { ...this.battle.conditions };
    for (const key of ['timeHours', 'cloudCover', 'windSpeed'] as const) if (this.overrides[key] !== undefined) conditions[key] = this.overrides[key];
    return { map, environment: this.inPort ? battleEnvironment(map, 'map', 'map', conditions)
      : battleEnvironment(map, this.battle.timeOfDay, this.battle.weather, conditions) };
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
    const { crest, surface, shoreline } = ocean.foam;
    surface.color.setScalar(waterFill);
    crest.color.setScalar(waterFill);
    shoreline.color.set('#edf9fd').multiplyScalar(waterFill);
    Object.assign(crest, { opacity: .8 * map.water.foam / .45, windStretch: .5, crestStrength: waves.crestFoam, windwardStrength: waves.windwardFoam, decayTime: 2.8 });
    Object.assign(surface, { opacity: SURFACE_FOAM_OPACITY * MathUtils.smoothstep(waves.windSpeed, SURFACE_FOAM_WIND[0], SURFACE_FOAM_WIND[1]), coverage: .05 });
    this.sinks.effects.setWind(ocean.waves.windSpeed, ocean.waves.windDirection);
    this.sinks.funnelSmoke.setWind(ocean.waves.windSpeed, ocean.waves.windDirection);
  }
  private applyLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { environment } = this.resolved(), authored = environment.sky, port = this.shelteredLight;
    const clouds = this.inPort && this.overrides.cloudCover === undefined;
    const elevation = port ? 36 : authored.elevation, azimuth = port ? 58 : authored.azimuth;
    // Freeze the celestial clock at an arc endpoint matching the authored angles.
    // This keeps SunDriver's moon opposite the sun without advancing battle time.
    sky.timeOfDay.applyParams({ autoAdvanceSecondsPerDay: 0, time: elevation < 0 ? 0 : .5,
      latitude: 90 - Math.abs(elevation), azimuth: elevation < 0 ? azimuth : azimuth - 180 });
    sky.sun.setFromAngles(elevation, azimuth);
    sky.sun.peakIntensity = port ? 5.8 : authored.intensity;
    sky.clouds.shape.altitude.value = this.inPort ? 1700 : authored.altitude;
    sky.clouds.shape.thickness.value = this.inPort ? 2400 : authored.thickness;
    sky.clouds.shape.coverage.value = clouds ? .38 : authored.coverage;
    sky.clouds.shape.horizonCoverageAmount.value = clouds ? .06 : environment.horizonCoverage;
    sky.clouds.wind.speed = environment.cloudWind;
    sky.clouds.lighting.ambientIntensity.value = port ? 1.1 : environment.cloudAmbient;
    sky.clouds.lighting.baseShadowStrength.value = port ? .2 : environment.cloudShadow;
    // Lift shaded hulls without raising sea/sky exposure.
    this.ambient = port ? 1.75 : authored.ambient;
    this.ambientLight.intensity = this.ambient;
    // Diffuse fill softens the dark blue dome toward the hills. Keep the port's
    // forward sun haze restrained so it cannot wash out the sky and reflections.
    sky.atmosphere.turbidity.value = port ? 3.2 : authored.turbidity;
    sky.atmosphere.rayleigh.value = port ? .42 : authored.rayleigh;
    sky.atmosphere.mieScatteringStrength.value = port ? .25 : authored.mie * SUN_HAZE;
    sky.atmosphere.mieDirectionalG.value = port ? .6 : authored.mieG;
    sky.atmosphere.skyMultipleScattering.value = port ? 1.4 : authored.multiple;
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
  /** Share the active celestial light: the low sun warms toward sunrise, the
   * moon takes over once it outshines the sun, and both reach the sea, the scene
   * light and its shadows, and smoke, including on paused frames. */
  syncLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { sun, timeOfDay: moon } = sky;
    const highSun = MathUtils.smoothstep(sun.elevationDeg, 0, 18);
    const solar = sun.intensity.value * (.12 + .88 * highSun) * MathUtils.smoothstep(sun.elevationDeg, 0, 2);
    const lunar = .65 * moon.moonIntensity.value * moon.moonPhaseIllumination.value
      * MathUtils.smoothstep(moon.moonDirection.value.y, 0, Math.sin(Math.PI / 30));
    const night = lunar > solar, intensity = night ? lunar : solar;
    const direction = night ? moon.moonDirection.value : sun.direction.value;
    if (night) this.celestialColor.copy(moon.moonColor.value);
    else this.celestialColor.copy(this.sunriseColor).lerp(DAYLIGHT_COLOR, highSun).multiply(sun.color.value);
    if (this.ocean) {
      // The sea shades with the raw celestial light; only the scene light meshes use is scaled.
      this.ocean.sun.direction.copy(direction);
      this.ocean.sun.intensity = intensity;
      this.ocean.sun.color.copy(this.celestialColor);
      const daylight = MathUtils.smoothstep(intensity, ...FILL_DAYLIGHT);
      this.ambientLight.intensity = this.ambient * (night ? MESH_NIGHT_FILL : MathUtils.lerp(1, MESH_FILL, daylight));
      this.ocean.environmentIntensity = MathUtils.lerp(1, MESH_SKY, daylight);
    }
    const light = this.sunLight;
    if (light) {
      light.intensity = intensity * (night ? MESH_MOONLIGHT : MESH_SUNLIGHT);
      light.color.copy(this.celestialColor);
      light.target.position.copy(this.inPort ? this.sinks.sunAnchor.position : this.shadowFocus ?? this.sinks.sunAnchor.position);
      light.position.copy(direction).multiplyScalar(this.inPort ? 800 : 500).add(light.target.position);
      light.target.updateMatrixWorld();
    }
    this.sinks.effects.setSun(direction, this.inPort ? 1 : Math.min(1, night
      ? .18 + this.ambient * .5 : this.ambient * .45 + intensity * .09));
    this.sinks.effects.setIllumination(this.celestialColor, intensity, this.ambient);
  }
}
