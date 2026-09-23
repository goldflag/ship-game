import { Color, Vector3, type Color as ColorType } from 'three/webgpu';
import type { CelestialLight, SkyScene, SkyUniforms } from './contracts';
import { anglesOf, CelestialModel, moonIllumination } from './celestialModel';
import { createSkyUniforms } from './uniforms';

/** Moonlight above the air at full moon, in the sea's units. Nature's is some 400,000 times dimmer
 * than the sun; this lifts it to a tenth of daylight so a night battle stays readable. */
const MOONLIGHT = .8;
/** The moon's cool tint, shared by its light on the scene and in the air. */
const MOON_TINT = new Color('#b4c9f0');

/** The scene a sky shows before `VisualEnvironment` applies one: the harbor's afternoon. */
export const DEFAULT_SKY_SCENE: SkyScene = {
  sun: { elevation: 36, azimuth: 58, intensity: 5.8 }, moon: { phase: .5 },
  atmosphere: { rayleigh: .42, turbidity: 3.2, mie: .25, mieG: .6, multiple: 1.4 },
  clouds: { coverage: .38, altitude: 1700, thickness: 2400, horizonCoverage: .06, ambient: 1.1, baseShadow: .2, windSpeed: 12, windHeading: 55 },
  weather: { precipitation: 0, lightning: 0 },
  port: true,
};

/** The sky's renderer-free state: where the sun, moon and stars stand, the CPU values of the
 * uniforms every part reads, the cloud drift and the celestial light the scene shares. The
 * facade drives it; tests use it without a GPU. */
export class SkyState {
  readonly model = new CelestialModel();
  readonly uniforms: SkyUniforms = createSkyUniforms();
  readonly light: CelestialLight = { direction: new Vector3(0, 1, 0), color: new Color(1, 1, 1), intensity: 0, night: false, flash: 0 };
  /** Cloud drift velocity (m/s) in world XZ. */
  readonly wind = new Vector3();
  scene: SkyScene = structuredClone(DEFAULT_SKY_SCENE);
  time = 0;

  get sun() {
    const direction = this.model.sun, { elevation, azimuth } = anglesOf(direction);
    return { direction, elevationDeg: elevation, azimuthDeg: azimuth };
  }
  get moon() {
    const direction = this.model.moon, { elevation, azimuth } = anglesOf(direction);
    return { direction, elevationDeg: elevation, azimuthDeg: azimuth, phase: this.model.phase };
  }

  /** Place the bodies for a scene and write the uniforms that follow from it. */
  apply(scene: SkyScene): void {
    this.scene = structuredClone(scene);
    const { uniforms, model } = this;
    model.set(scene.sun.elevation, scene.sun.azimuth, scene.moon.phase);
    uniforms.sunDirection.value.copy(model.sun);
    uniforms.moonDirection.value.copy(model.moon);
    uniforms.moonPhase.value = model.phase;
    uniforms.starRotation.value.copy(model.starRotation);
    uniforms.sunIrradiance.value.setScalar(scene.sun.intensity);
    uniforms.moonIrradiance.value.set(MOON_TINT.r, MOON_TINT.g, MOON_TINT.b).multiplyScalar(MOONLIGHT * moonIllumination(model.phase));
    const heading = scene.clouds.windHeading * Math.PI / 180;
    this.wind.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(scene.clouds.windSpeed);
  }

  /** Advance sky time and the cloud drift; a paused frame (dt 0) moves nothing. */
  advance(dt: number, camera: Vector3): void {
    if (dt > 0) {
      this.time += dt;
      this.uniforms.windOffset.value.addScaledVector(this.wind, dt);
    }
    this.uniforms.time.value = this.time;
    this.uniforms.cameraPosition.value.copy(camera);
  }

  /** The active body's light at the sea, from the atmosphere's sea-level sun and moon (colour ×
   * intensity): the moon once it outshines the sun. `intensity` is the brightest channel. */
  chooseLight(seaLevel: { readonly sun: ColorType; readonly moon: ColorType }, flash: number): void {
    const { sun, moon } = seaLevel, light = this.light;
    const solar = Math.max(sun.r, sun.g, sun.b), lunar = Math.max(moon.r, moon.g, moon.b);
    light.night = lunar > solar;
    light.intensity = light.night ? lunar : solar;
    if (light.intensity > 0) light.color.copy(light.night ? moon : sun).multiplyScalar(1 / light.intensity);
    light.direction.copy(light.night ? this.model.moon : this.model.sun);
    light.flash = flash;
    this.uniforms.flash.value = flash;
    this.uniforms.lightDirection.value.copy(light.direction);
    this.uniforms.lightColor.value.set(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity);
  }
}
