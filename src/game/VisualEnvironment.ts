import { Color, HemisphereLight, MathUtils, Vector3, type Object3D, type PerspectiveCamera } from 'three/webgpu';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import type { SkySystem } from '../../vendor/threejs-sky-pro/build/index.js';
import { DEFAULT_MAP, oceanMap, type OceanMapId } from '../maps/catalog';
import { battleEnvironment, type BattleConditions, type TimeOfDayId, type WeatherId } from '../maps/conditions';

const DAYLIGHT_COLOR = new Color(1, 1, 1);

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

/** Applies resolved battle conditions to the licensed water and sky, and owns
 * every live override of those uniforms: sheltered port defaults, the air map's
 * far fog, underwater attenuation and the celestial light shared with scene
 * lights and smoke. CPU combat reads the same resolved conditions through the
 * renderer-free conditions module; nothing here can move a hull. */
export class VisualEnvironment {
  readonly ambientLight = new HemisphereLight('#dcebf2', '#65757e', .65);
  private water?: WaterSystem;
  private sky?: SkySystem;
  private mapId: OceanMapId = DEFAULT_MAP;
  private inPort = false;
  private battle: BattleScene = { timeOfDay: 'map', weather: 'map', conditions: {} };
  private overrides: EnvironmentOverrides = {};
  private chartFog = false;
  // Original swatches, restored exactly when the camera surfaces again.
  private surfaceAbsorption = new Color();
  private surfaceDistortion = 0;
  private celestialColor = new Color();
  private readonly sunriseColor = new Color('#ffd1a0');
  private shadowFocus?: Vector3;

  constructor(private sinks: EnvironmentSinks) {}

  /** Water is attached once its preset is loaded; the preset's swatches become the surface baseline. */
  attachWater(water: WaterSystem): void {
    this.water = water;
    this.surfaceAbsorption.copy(water.color.absorptionColor);
    this.surfaceDistortion = water.underwaterDistortion.intensity;
  }
  /** Sky is attached after its preset. Water resynchronizes its provider light
   * every simulation step, so the host reapplies `syncLighting` from that sync. */
  attachSky(sky: SkySystem): void { this.sky = sky; }
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
    if (!this.sky || !this.water) return undefined;
    const timeHours = this.overrides.timeHours ?? (this.inPort ? undefined : this.battle.conditions.timeHours);
    return { timeHours, sunElevation: this.sky.sun.elevationDeg, cloudCover: this.sky.clouds.shape.coverage.value * 100,
      windSpeed: this.water.waves.windSpeed.value,
      windDirection: MathUtils.euclideanModulo(this.water.waves.windDirection.value * 180 / Math.PI, 360),
      visibilityKm: this.sceneFogEnd() / 1000 };
  }
  /** The air map raises the camera far above the authored fog; closing it restores the scene's fog. */
  setChartFog(enabled: boolean): void { this.chartFog = enabled; this.applyFog(); }
  /** Retained across the water provider's repeated light-sync callbacks. */
  setShadowFocus(position?: Vector3): void {
    if (position) (this.shadowFocus ??= new Vector3()).copy(position);
    else this.shadowFocus = undefined;
  }
  /** Per frame, before the water steps: advance the sky, share its light, and attenuate for a submerged camera. */
  update(camera: PerspectiveCamera, dt: number): void {
    this.sky?.update(dt);
    this.syncLighting();
    if (!this.water) return;
    // Black Flag's absorption loses >99% of green/blue light over 50 m,
    // hiding even our own submarine. Ease to a 20× longer visibility range
    // over the first 2 m of camera submersion; keep distant water hazy and
    // restore the exact surface preset when the camera comes back up.
    const submerged = MathUtils.smoothstep(-camera.position.y, 0, 2);
    this.water.color.absorptionColor.copy(this.surfaceAbsorption).multiplyScalar(MathUtils.lerp(1, .05, submerged));
    // If distortion is enabled for a diagnostic, soften it on submersion.
    // The game disables this optional effect during ocean initialization.
    this.water.underwaterDistortion.intensity = this.surfaceDistortion * MathUtils.lerp(1, .15, submerged);
  }
  diagnostics() {
    return { waves: this.water ? { amplitude: this.water.waves.amplitude.value, windSpeed: this.water.waves.windSpeed.value,
        peakWavelength: this.water.waves.peakWavelength.value } : undefined,
      ...this.battle.conditions, timeOfDay: this.battle.timeOfDay, weather: this.battle.weather,
      environment: this.sky ? { sunElevation: this.sky.sun.elevationDeg, sunAzimuth: this.sky.sun.azimuthDeg,
        sunIntensity: this.sky.sun.peakIntensity, ambient: this.ambientLight.intensity,
        cloudCoverage: this.sky.clouds.shape.coverage.value, cloudWind: this.sky.clouds.wind.speed,
        cloudAmbient: this.sky.clouds.lighting.ambientIntensity.value, fogEnd: this.water?.fog.fadeEnd } : undefined };
  }

  private resolved() {
    const map = oceanMap(this.mapId);
    // Port overrides resolve through the same day model on the berth's map; the
    // sheltered literals below stay wherever nothing is overridden.
    const conditions: BattleConditions = { ...(this.inPort ? {} : this.battle.conditions) };
    for (const key of ['timeHours', 'cloudCover', 'windSpeed'] as const) if (this.overrides[key] !== undefined) conditions[key] = this.overrides[key];
    return { map, environment: this.inPort ? battleEnvironment(map, 'map', 'map', conditions)
      : battleEnvironment(map, this.battle.timeOfDay, this.battle.weather, conditions) };
  }
  private get shelteredSea() { return this.inPort && this.overrides.windSpeed === undefined; }
  private get shelteredLight() { return this.inPort && this.overrides.timeHours === undefined; }
  private applySea(): void {
    const water = this.water;
    if (!water) return;
    const { map, environment: { waves, waterLightScale } } = this.resolved(), sheltered = this.shelteredSea;
    // Metric wave heights are calibrated separately from the FFT gain. Port stays sheltered.
    water.waves.amplitude.value = sheltered ? .12 : waves.amplitude;
    water.waves.windSpeed.value = sheltered ? 9 : waves.windSpeed;
    water.waves.peakWavelength.value = sheltered ? 14 : waves.peakWavelength;
    water.waves.choppiness.value = sheltered ? .65 : waves.choppiness;
    water.waves.jonswapGamma.value = sheltered ? 2.2 : 2.6;
    water.waves.windDirection.value = (this.overrides.windDirection ?? (this.inPort ? 35 : map.water.windDirection)) * Math.PI / 180;
    water.waves.dirty = true;
    const colors = this.inPort ? oceanMap(DEFAULT_MAP).water : map.water;
    water.color.update({ waterColor: colors.waterColor, transmissionColor: colors.transmissionColor, absorptionColor: colors.absorptionColor });
    // The custom water pigment and foam bypass scene lighting. Derive their
    // radiance from the original swatches so night seas do not glow blue/white.
    const waterFill = this.shelteredLight ? 1 : waterLightScale;
    water.color.waterColor.multiplyScalar(waterFill);
    water.color.transmissionColor.multiplyScalar(waterFill);
    water.foam.surface.color.setScalar(waterFill);
    water.foam.waves.color.setScalar(waterFill);
    water.foam.shoreline.color.set('#edf9fd').multiplyScalar(waterFill);
    this.surfaceAbsorption.copy(water.color.absorptionColor);
    water.foam.waves.opacity = sheltered ? .45 : .8 * map.water.foam / .45;
    water.foam.waves.windStretch = sheltered ? .47 : .5;
    water.foam.waves.persistence.update({
      crestStrength: sheltered ? .99 : waves.crestFoam,
      windwardStrength: sheltered ? 1.1 : waves.windwardFoam,
      decayTime: sheltered ? 1.48 : 2.8,
    });
    water.foam.surface.opacity = sheltered ? .13 : .08 * Math.max(0, Math.min(1, (waves.windSpeed - 3) / 12));
    water.foam.surface.coverage = sheltered ? .21 : .18;
    this.sinks.effects.setWind(water.waves.windSpeed.value, water.waves.windDirection.value);
    this.sinks.funnelSmoke.setWind(water.waves.windSpeed.value, water.waves.windDirection.value);
  }
  private applyLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { environment } = this.resolved(), authored = environment.sky, port = this.shelteredLight;
    const clouds = this.inPort && this.overrides.cloudCover === undefined, cloudWind = this.inPort && this.overrides.windSpeed === undefined;
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
    sky.clouds.wind.speed = cloudWind ? 12 : environment.cloudWind;
    sky.clouds.lighting.ambientIntensity.value = port ? 1.1 : environment.cloudAmbient;
    sky.clouds.lighting.baseShadowStrength.value = port ? .2 : environment.cloudShadow;
    // Lift shaded hulls and harbor buildings without raising sea/sky exposure.
    this.ambientLight.intensity = port ? 1.75 : authored.ambient;
    // Diffuse fill softens the dark blue dome toward the hills. Keep the port's
    // forward sun haze restrained so it cannot wash out the sky and reflections.
    sky.atmosphere.turbidity.value = port ? 3.2 : authored.turbidity;
    sky.atmosphere.rayleigh.value = port ? .42 : authored.rayleigh;
    sky.atmosphere.mieScatteringStrength.value = port ? .25 : authored.mie;
    sky.atmosphere.mieDirectionalG.value = port ? .6 : authored.mieG;
    sky.atmosphere.skyMultipleScattering.value = port ? 1.4 : authored.multiple;
    this.applyFog();
  }
  private applyFog(): void {
    const water = this.water;
    if (!water) return;
    // Water Pro owns scene.fogNode, including the water/sky horizon blend.
    // Its live uniforms must change with the scene; THREE.Fog is overridden.
    const { environment: { fog } } = this.resolved();
    const scene = this.inPort ? { start: 650, end: 5600, skyBlend: 2600 } : fog;
    // A visibility override moves the whole fog ramp, keeping the scene's proportions.
    const scale = this.overrides.visibilityKm === undefined ? 1 : this.overrides.visibilityKm * 1000 / scene.end;
    water.fog.color = this.shelteredLight ? '#819aa5' : fog.color;
    water.fog.fadeStart = this.chartFog ? 400000 : scene.start * scale;
    water.fog.fadeEnd = this.chartFog ? 900000 : scene.end * scale;
    water.fog.fadePower = this.inPort ? .85 : 1.4;
    water.fog.skyBlendDistance = scene.skyBlend * scale;
  }
  /** The scene's fog end, ignoring the air map's temporary far fog. */
  private sceneFogEnd(): number {
    const end = this.inPort ? 5600 : this.resolved().environment.fog.end;
    return this.overrides.visibilityKm === undefined ? end : this.overrides.visibilityKm * 1000;
  }
  /** Share the active celestial light: the low sun warms toward sunrise, the
   * moon takes over once it outshines the sun, and both reach water, scene
   * shadows and smoke, including on paused frames without a water step. */
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
    const lighting = this.water?.lighting;
    if (lighting) {
      lighting.sun.direction.value.copy(direction);
      lighting.sun.intensity.value = intensity;
      lighting.sun.color.copy(this.celestialColor);
      const light = lighting.sunLight;
      light.intensity = intensity;
      light.color.copy(this.celestialColor);
      light.target.position.copy(this.inPort ? this.sinks.sunAnchor.position : this.shadowFocus ?? this.sinks.sunAnchor.position);
      if (this.inPort) light.target.position.x -= 160;
      light.position.copy(direction).multiplyScalar(this.inPort ? 800 : 500).add(light.target.position);
      light.target.updateMatrixWorld();
    }
    this.sinks.effects.setSun(direction, this.inPort ? 1 : Math.min(1, night
      ? .18 + this.ambientLight.intensity * .5 : this.ambientLight.intensity * .45 + intensity * .09));
    this.sinks.effects.setIllumination(this.celestialColor, intensity, this.ambientLight.intensity);
  }
}
