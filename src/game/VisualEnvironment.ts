import { Color, HemisphereLight, MathUtils, type Object3D, type PerspectiveCamera, type Vector3 } from 'three/webgpu';
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
  private chartFog = false;
  // Original swatches, restored exactly when the camera surfaces again.
  private surfaceAbsorption = new Color();
  private surfaceDistortion = 0;
  private celestialColor = new Color();
  private readonly sunriseColor = new Color('#ffd1a0');

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
  /** Apply the sea, sky, fog and wind for a map in port or at sea. */
  setScene(mapId: OceanMapId, inPort: boolean): void {
    this.mapId = mapId; this.inPort = inPort; this.chartFog = false;
    this.applySea(); this.applyLighting();
  }
  /** The air map raises the camera far above the authored fog; closing it restores the scene's fog. */
  setChartFog(enabled: boolean): void { this.chartFog = enabled; this.applyFog(); }
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
    // Keep surface-looking-in refraction; soften the full-screen underwater wobble.
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
    return { map, environment: battleEnvironment(map, this.battle.timeOfDay, this.battle.weather, this.battle.conditions) };
  }
  private applySea(): void {
    const water = this.water;
    if (!water) return;
    const { map, environment: { waves, waterLightScale } } = this.resolved();
    // Retain the smaller wave scale across all oceans; port stays sheltered.
    water.waves.amplitude.value = this.inPort ? .12 : waves.amplitude;
    water.waves.windSpeed.value = this.inPort ? 4 : waves.windSpeed;
    water.waves.peakWavelength.value = this.inPort ? 14 : waves.peakWavelength;
    water.waves.choppiness.value = .65;
    water.waves.windDirection.value = (this.inPort ? 35 : map.water.windDirection) * Math.PI / 180;
    water.waves.dirty = true;
    const colors = this.inPort ? oceanMap(DEFAULT_MAP).water : map.water;
    water.color.update({ waterColor: colors.waterColor, transmissionColor: colors.transmissionColor, absorptionColor: colors.absorptionColor });
    // The custom water pigment and foam bypass scene lighting. Derive their
    // radiance from the original swatches so night seas do not glow blue/white.
    const waterFill = this.inPort ? 1 : waterLightScale;
    water.color.waterColor.multiplyScalar(waterFill);
    water.color.transmissionColor.multiplyScalar(waterFill);
    water.foam.surface.color.setScalar(waterFill);
    water.foam.waves.color.setScalar(waterFill);
    water.foam.shoreline.color.set('#edf9fd').multiplyScalar(waterFill);
    this.surfaceAbsorption.copy(water.color.absorptionColor);
    water.foam.waves.opacity = this.inPort ? .45 : map.water.foam;
    this.sinks.effects.setWind(water.waves.windSpeed.value, water.waves.windDirection.value);
    this.sinks.funnelSmoke.setWind(water.waves.windSpeed.value, water.waves.windDirection.value);
  }
  private applyLighting(): void {
    const sky = this.sky;
    if (!sky) return;
    const { environment } = this.resolved(), authored = environment.sky;
    const elevation = this.inPort ? 36 : authored.elevation, azimuth = this.inPort ? 58 : authored.azimuth;
    // Freeze the celestial clock at an arc endpoint matching the authored angles.
    // This keeps SunDriver's moon opposite the sun without advancing battle time.
    sky.timeOfDay.applyParams({ autoAdvanceSecondsPerDay: 0, time: elevation < 0 ? 0 : .5,
      latitude: 90 - Math.abs(elevation), azimuth: elevation < 0 ? azimuth : azimuth - 180 });
    sky.sun.setFromAngles(elevation, azimuth);
    sky.sun.peakIntensity = this.inPort ? 5.8 : authored.intensity;
    sky.clouds.shape.altitude.value = this.inPort ? 1700 : authored.altitude;
    sky.clouds.shape.thickness.value = this.inPort ? 2400 : authored.thickness;
    sky.clouds.shape.coverage.value = this.inPort ? .38 : authored.coverage;
    sky.clouds.shape.horizonCoverageAmount.value = this.inPort ? .06 : environment.horizonCoverage;
    sky.clouds.wind.speed = this.inPort ? 12 : environment.cloudWind;
    sky.clouds.lighting.ambientIntensity.value = this.inPort ? 1.1 : environment.cloudAmbient;
    sky.clouds.lighting.baseShadowStrength.value = this.inPort ? .2 : environment.cloudShadow;
    // Lift shaded hulls and harbor buildings without raising sea/sky exposure.
    this.ambientLight.intensity = this.inPort ? 1.75 : authored.ambient;
    // Diffuse fill softens the dark blue dome toward the hills. Keep the port's
    // forward sun haze restrained so it cannot wash out the sky and reflections.
    sky.atmosphere.turbidity.value = this.inPort ? 3.2 : authored.turbidity;
    sky.atmosphere.rayleigh.value = this.inPort ? .42 : authored.rayleigh;
    sky.atmosphere.mieScatteringStrength.value = this.inPort ? .25 : authored.mie;
    sky.atmosphere.mieDirectionalG.value = this.inPort ? .6 : authored.mieG;
    sky.atmosphere.skyMultipleScattering.value = this.inPort ? 1.4 : authored.multiple;
    this.applyFog();
  }
  private applyFog(): void {
    const water = this.water;
    if (!water) return;
    // Water Pro owns scene.fogNode, including the water/sky horizon blend.
    // Its live uniforms must change with the scene; THREE.Fog is overridden.
    const { environment: { fog } } = this.resolved();
    water.fog.color = this.inPort ? '#819aa5' : fog.color;
    water.fog.fadeStart = this.chartFog ? 400000 : this.inPort ? 650 : fog.start;
    water.fog.fadeEnd = this.chartFog ? 900000 : this.inPort ? 5600 : fog.end;
    water.fog.fadePower = this.inPort ? .85 : 1.4;
    water.fog.skyBlendDistance = this.inPort ? 2600 : fog.skyBlend;
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
      light.target.position.copy(this.sinks.sunAnchor.position);
      if (this.inPort) light.target.position.x -= 160;
      light.position.copy(direction).multiplyScalar(this.inPort ? 800 : 500).add(light.target.position);
      light.target.updateMatrixWorld();
    }
    this.sinks.effects.setSun(direction, this.inPort ? 1 : Math.min(1, night
      ? .18 + this.ambientLight.intensity * .5 : this.ambientLight.intensity * .45 + intensity * .09));
    this.sinks.effects.setIllumination(this.celestialColor, intensity, this.ambientLight.intensity);
  }
}
