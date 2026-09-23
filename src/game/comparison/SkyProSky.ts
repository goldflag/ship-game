import { Color, MathUtils, Vector3, type Node, type Object3D, type PassNode, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { Fn, float, max } from 'three/tsl';
import { SkySystem, PRESETS } from '../../../vendor/threejs-sky-pro/build/index.js';
import type { OceanSky } from '../ocean/contracts';
import type { CelestialLight, SkyApi, SkyQuality, SkyScene } from '../sky/contracts';
import { anglesOf } from '../sky/celestialModel';

/** Sun and moon disc radius as `1 - cos(θ)`: a 1.4° disc, under three times life size.
 * Sky Pro's presets draw them at 3.2° and 3.6°. */
const CELESTIAL_DISC = 7.5e-5;
/** Sky Pro's environment bake per Graphics → Clouds tier: width and cloud march steps. */
const BAKE: Record<SkyQuality, [number, number]> = { low: [256, 12], medium: [384, 16], high: [512, 24], ultra: [768, 32] };
const SUNRISE = new Color('#ffd1a0'), DAYLIGHT = new Color(1, 1, 1);

/** The vendored Sky Pro library the game's sky replaced, behind the same facade, kept to compare
 * the two (Graphics `skyRenderer`, switched from the developer console). Only this comparison
 * downloads the library. It reproduces exactly how the game drove Sky Pro before the replacement:
 * the partly cloudy preset, the game's cloud lighting, disc sizes and horizon correction, the
 * provider's moonlit fog, and the scene light's sunrise warmth. Sky Pro has no rain, lightning,
 * shafts or cloud shadows here, as before. */
export class SkyProSky implements SkyApi {
  readonly renderer = 'skypro' as const;
  readonly light: CelestialLight = { direction: new Vector3(0, 1, 0), color: new Color(1, 1, 1), intensity: 0, night: false, flash: 0 };
  readonly oceanSky: OceanSky;
  private qualityLevel: SkyQuality;
  private qualityTask: Promise<void> = Promise.resolve();

  static async create(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, options: { quality: SkyQuality }): Promise<SkyProSky> {
    const system = await SkySystem.create({ renderer, camera, scene, quality: options.quality, cloudRenderingMode: 'dynamic', godRays: false });
    // Sky Pro's background shaders hard-code far depth as 1. Match the active
    // backend's depth convention so cirrus cannot paint over opaque ships.
    // Volumetric clouds already project their hit distance through the camera.
    const skyDepth = float(renderer.reversedDepthBuffer ? 0 : 1);
    system.pipeline.sky.material.depthNode = skyDepth;
    system.pipeline.cirrus.material.depthNode = skyDepth;
    await system.applyPreset(PRESETS.partlyCloudy);
    return new SkyProSky(system, options.quality);
  }

  /** The library itself, for Sky Pro diagnostics (`scripts/browser/sky-horizon-check.ts`, the night-lighting page). */
  private constructor(readonly system: SkySystem, quality: SkyQuality) {
    this.qualityLevel = quality;
    // Shared cloud shape; the visual environment supplies each scene's daylight.
    // Keep exposure neutral so the hull retains its daylight contrast.
    system.godRays.enabled = false;
    system.clouds.shape.altitude.value = 1700;
    system.clouds.shape.thickness.value = 2400;
    system.clouds.shape.horizonCoverageAmount.value = 0.06;
    // Cloud volumes use their own ambient fill, independently of scene lights.
    // Soften the extra base darkening and lift the preset's near-black bounce.
    system.clouds.lighting.baseShadowStrength.value = 0.2;
    system.clouds.lighting.ambientIntensity.value = 1.1;
    system.clouds.lighting.groundBounceAlbedo.value.setRGB(0.09, 0.105, 0.12);
    system.clouds.wind.speed = 12;
    system.timeOfDay.moonPhase.value = .5;
    system.timeOfDay.moonAmbient.value = .07;
    system.timeOfDay.moonColor.value.set('#b4c9f0');
    // Lift the dark horizon band without retuning the authored sky palette.
    system.atmosphere.horizonCorrection.value = .8;
    system.sun.discSize.value = CELESTIAL_DISC;
    system.timeOfDay.moonAngularSize.value = CELESTIAL_DISC;
    const [width, steps] = BAKE[quality];
    const provider = system.createSkyProvider({ envMap: { width, cloudMarchSteps: steps, skipFrames: 8 } });
    const daylightFog = provider.createFogSampler(), moon = system.timeOfDay;
    // Sky Pro's provider fog is sun-only. Preserve its moon ambient in the sea's
    // far-distance blend so the night backdrop is not fogged to black.
    provider.createFogSampler = () => Fn(([direction]: [Node<'vec3'>]) => daylightFog(direction).add(
      moon.moonColor.mul(moon.moonIntensity).mul(moon.moonAmbient).mul(moon.moonPhaseIllumination)
        .mul(max(0, moon.moonDirection.y)))) as unknown as (direction: Node<'vec3'>) => Node<'vec3'>;
    this.oceanSky = provider as unknown as OceanSky;
  }

  get quality(): SkyQuality { return this.qualityLevel; }
  get sun() { return { direction: this.system.sun.direction.value, elevationDeg: this.system.sun.elevationDeg, azimuthDeg: this.system.sun.azimuthDeg }; }
  get moon() {
    const direction = this.system.timeOfDay.moonDirection.value, { elevation, azimuth } = anglesOf(direction);
    return { direction, elevationDeg: elevation, azimuthDeg: azimuth, phase: this.system.timeOfDay.moonPhase.value };
  }
  get coverage(): number { return this.system.clouds.shape.coverage.value; }
  get cloudsEnabled(): boolean { return this.system.clouds.enabled; }
  set cloudsEnabled(enabled: boolean) { this.system.clouds.enabled = enabled; }
  get exposure(): Node<'float'> { return this.system.atmosphere.exposure; }

  apply(scene: SkyScene): void {
    const sky = this.system, { elevation, azimuth } = scene.sun;
    // Freeze the celestial clock at an arc endpoint matching the authored angles.
    // This keeps SunDriver's moon opposite the sun without advancing battle time.
    sky.timeOfDay.applyParams({ autoAdvanceSecondsPerDay: 0, time: elevation < 0 ? 0 : .5,
      latitude: 90 - Math.abs(elevation), azimuth: elevation < 0 ? azimuth : azimuth - 180 });
    sky.timeOfDay.moonPhase.value = scene.moon.phase;
    sky.sun.setFromAngles(elevation, azimuth);
    sky.sun.peakIntensity = scene.sun.intensity;
    sky.clouds.shape.altitude.value = scene.clouds.altitude;
    sky.clouds.shape.thickness.value = scene.clouds.thickness;
    sky.clouds.shape.coverage.value = scene.clouds.coverage;
    sky.clouds.shape.horizonCoverageAmount.value = scene.clouds.horizonCoverage;
    // Sky Pro's clouds always drifted toward its default heading; only their speed followed the weather.
    sky.clouds.wind.speed = scene.clouds.windSpeed;
    sky.clouds.lighting.ambientIntensity.value = scene.clouds.ambient;
    sky.clouds.lighting.baseShadowStrength.value = scene.clouds.baseShadow;
    sky.atmosphere.turbidity.value = scene.atmosphere.turbidity;
    sky.atmosphere.rayleigh.value = scene.atmosphere.rayleigh;
    sky.atmosphere.mieScatteringStrength.value = scene.atmosphere.mie;
    sky.atmosphere.mieDirectionalG.value = scene.atmosphere.mieG;
    sky.atmosphere.skyMultipleScattering.value = scene.atmosphere.multiple;
    this.updateLight();
  }

  update(dt: number): void {
    this.system.update(dt);
    this.updateLight();
  }

  postProcess(_scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> { return color; }
  cloudShadow(): Node<'float'> { return float(1); }
  meshes(): Object3D[] { return this.system.backdropMeshes(); }
  resetHistory(): void { this.system.pipeline.cloudTemporal.invalidateHistory(); }
  resize(width: number, height: number): void { this.system.resize(width, height); }

  /** Cloud tiers change march budgets live; a coarser noise volume refills on the CPU once. */
  setQuality(quality: SkyQuality): Promise<void> {
    this.qualityLevel = quality;
    const [width, steps] = BAKE[quality];
    this.qualityTask = this.qualityTask.then(() => this.system.setQualityLevel(quality, {
      godRaysEnabled: false, envMapWidth: width, envMapHeight: width / 2, envMapMarchSteps: steps }));
    return this.qualityTask;
  }

  diagnostics(): Record<string, unknown> {
    return { renderer: this.renderer, quality: this.qualityLevel, sunIntensity: this.system.sun.intensity.value,
      cloudFill: (this.system.pipeline as unknown as { _ambientSky: { zenithRadiance: { value: { toArray(): number[] } } } })._ambientSky.zenithRadiance.value.toArray() };
  }

  dispose(): void { this.system.dispose(); }

  /** The low sun warms toward sunrise and the moon takes over once it outshines the sun: the scene
   * light the game derived from Sky Pro's sun and clock. */
  private updateLight(): void {
    const { sun, timeOfDay: moon } = this.system, light = this.light;
    const highSun = MathUtils.smoothstep(sun.elevationDeg, 0, 18);
    const solar = sun.intensity.value * (.12 + .88 * highSun) * MathUtils.smoothstep(sun.elevationDeg, 0, 2);
    const lunar = .65 * moon.moonIntensity.value * moon.moonPhaseIllumination.value
      * MathUtils.smoothstep(moon.moonDirection.value.y, 0, Math.sin(Math.PI / 30));
    light.night = lunar > solar;
    light.intensity = light.night ? lunar : solar;
    light.direction.copy(light.night ? moon.moonDirection.value : sun.direction.value);
    if (light.night) light.color.copy(moon.moonColor.value);
    else light.color.copy(SUNRISE).lerp(DAYLIGHT, highSun).multiply(sun.color.value);
  }
}
