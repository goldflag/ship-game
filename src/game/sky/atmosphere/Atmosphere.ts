import { Color, MathUtils, Vector2, Vector3, type Node, type WebGPURenderer } from 'three/webgpu';
import { dot, exp, float, fract, luminance, max, min, mix, pow, screenCoordinate, select, smoothstep, sqrt, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyFrame, SkyScene, SkyUniforms } from '../contracts';
import { AMBIENT_SIZE, AMBIENT_TOP, AtmosphereTables, SEA_HEIGHT, SECTIONS, SKY_VIEW_SCALE, atlasUv, direct, distanceToGround, horizonCosine,
  aureolePhase, lightTransmittance, opticalDepth, skyViewLatitude, skyViewLongitude, unitToTexel, type AirUniforms, type Float, type Horizon, type Vec3 } from './luts';
import { PLANET_RADIUS, SKY_GRADE, airCoefficients, seaLevelLight, skyIrradiance, twilightLift, type AirCoefficients, type Rgb } from './model';

const RB = PLANET_RADIUS;
/** The camera's sections are rebuilt once its altitude moves by this share of itself, or 5 m near the sea. */
const REBUILD_SHARE = .02, REBUILD_MINIMUM = .005;
/** Highest camera altitude (km) the tables are built for: the air ends at 100 km. */
const HIGHEST_CAMERA = 90;
/** Width of the horizon edge (as a zenith cosine) over which bodies beyond the air sink out of sight. */
const HORIZON_EDGE = .0047;
/** Relative dither of the dome per unit of radiance^(−1/2.2): ±half an 8-bit level of a gamma-2.2 display. */
const DITHER = 2 * .5 / 255 * 2.2;

type Scatter = { scatter: Vec3; mie: Vec3 };

/** Horizon angles (zenith angle of the geometric horizon, and nadir to horizon) for an altitude in km. */
function horizonOf(altitude: number, out: Vector2): Vector2 {
  const nadir = Math.acos(MathUtils.clamp(Math.sqrt(altitude * (altitude + 2 * RB)) / (altitude + RB), 0, 1));
  return out.set(Math.PI - nadir, nadir);
}

/** The atmosphere part (see `README.md` and `luts.ts`): Hillaire's scattering tables, rebuilt when the air,
 * the lights or the camera's altitude change, and the samplers every other part composes. */
export class Atmosphere implements AtmospherePart {
  readonly seaLevel = { sun: new Color(), moon: new Color(), sky: new Color() };
  readonly air: AirUniforms = {
    rayleigh: uniform(new Vector3()), mieScattering: uniform(new Vector3()), mieExtinction: uniform(new Vector3()), ozone: uniform(new Vector3()),
    mieG: uniform(.6), mieGain: uniform(1), multiple: uniform(1),
  };
  /** The sky's exposure at dusk (`model.twilightLift`): multiplies everything the sun lights. */
  readonly sunLift = uniform(1);
  /** Camera altitude (km) the camera's sections were built for, and its horizon angles. */
  readonly cameraHeight = uniform(.03);
  private readonly cameraHorizon = uniform(horizonOf(.03, new Vector2()));
  private readonly seaHorizon = horizonOf(SEA_HEIGHT, new Vector2());
  readonly tables: AtmosphereTables;
  private coefficients?: AirCoefficients;
  private readonly dirty = { air: true, lights: true, camera: true };

  constructor(private readonly uniforms: SkyUniforms) {
    const sunLight = uniforms.sunIrradiance.mul(this.sunLift), moonLight = uniforms.moonIrradiance;
    this.tables = new AtmosphereTables({
      air: this.air, cameraHeight: this.cameraHeight, sunDirection: uniforms.sunDirection, moonDirection: uniforms.moonDirection,
      compose: (sun, moon, direction) => this.compose(sun, moon, direction), sunLight, moonLight,
    });
  }

  apply(scene: SkyScene): void {
    const air = airCoefficients(scene.atmosphere), u = this.air;
    if (JSON.stringify(air) !== JSON.stringify(this.coefficients)) {
      this.coefficients = air;
      u.rayleigh.value.fromArray(air.rayleigh); u.mieScattering.value.fromArray(air.mieScattering);
      u.mieExtinction.value.fromArray(air.mieExtinction); u.ozone.value.fromArray(air.ozone);
      u.mieG.value = air.mieG; u.mieGain.value = air.mieGain; u.multiple.value = air.multiple;
      this.dirty.air = true;
    }
    this.sunLift.value = twilightLift(scene.sun.elevation);
    this.dirty.lights = true;
    const moon = this.uniforms.moonIrradiance.value, moonUp = this.uniforms.moonDirection.value.y;
    seaLevelLight(scene, air, { irradiance: [moon.x, moon.y, moon.z], elevationDeg: Math.asin(MathUtils.clamp(moonUp, -1, 1)) * MathUtils.RAD2DEG }, this.seaLevel);
    skyIrradiance(air, this.uniforms.sunDirection.value, scene.sun.intensity, this.sunLift.value, this.seaLevel.sky);
  }

  update(frame: SkyFrame): void {
    const altitude = MathUtils.clamp(this.uniforms.cameraPosition.value.y / 1000, SEA_HEIGHT, HIGHEST_CAMERA);
    if (Math.abs(altitude - this.cameraHeight.value) > Math.max(REBUILD_MINIMUM, REBUILD_SHARE * altitude)) {
      this.cameraHeight.value = altitude;
      horizonOf(altitude, this.cameraHorizon.value);
      this.dirty.camera = true;
    }
    const { dirty } = this;
    if (!dirty.air && !dirty.lights && !dirty.camera) return;
    this.tables.render(frame.renderer, dirty);
    dirty.air = dirty.lights = dirty.camera = false;
  }

  /** Build every table now (startup), so the first frame and the first compile see finished ones. */
  prepare(renderer: WebGPURenderer): void {
    this.tables.render(renderer, { air: true, lights: true, camera: true });
  }

  setQuality(): void {}

  sky(direction: Vec3, fromSea = false): Vec3 {
    // Half a display level of static noise: the night's dark, smooth gradients band in 8 bits without it.
    const radiance = this.radiance(direction, fromSea, true), level = luminance(radiance).max(1e-6);
    const noise = fract(fract(screenCoordinate.x.mul(.06711056).add(screenCoordinate.y.mul(.00583715))).mul(52.9829189)).sub(.5);
    return radiance.mul(noise.mul(pow(level, -1 / 2.2).mul(DITHER).min(.08)).add(1));
  }

  transmittanceToSpace(direction: Vec3, fromSea = false): Vec3 {
    const r = this.radius(fromSea), mu = direction.y;
    const horizon = horizonCosine(r);
    return exp(opticalDepth(this.tables, r, mu).negate()).mul(smoothstep(horizon.sub(HORIZON_EDGE), horizon.add(HORIZON_EDGE), mu));
  }

  sunTransmittance(position: Vec3): Vec3 {
    return this.lightAt(position, this.uniforms.sunDirection).mul(this.sunLift);
  }

  moonTransmittance(position: Vec3): Vec3 {
    return this.lightAt(position, this.uniforms.moonDirection);
  }

  /** Transmittance by optical depths from the table (Bruneton's two-lookup form: the ray from the far end on,
   * subtracted from the ray from the near end; reversed for rays that meet the sea, whose reverse rises). The
   * in-scattering is the sky's own along the direction, in the share of the whole ray's extinction that lies
   * before the point: exact when the light scattered per unit optical depth is uniform along the ray, and it
   * converges on the sky itself, so distant clouds melt into the horizon in its colour. */
  aerial(direction: Vec3, distance: Float, fromSea = false): { inscatter: Vec3; transmittance: Vec3 } {
    const tables = this.tables, r0 = this.radius(fromSea), mu0 = direction.y;
    const ground = distanceToGround(r0, mu0), hits = ground.greaterThan(0);
    const d = select(hits, min(distance.div(1000), ground), distance.div(1000)).max(0);
    const r1 = sqrt(r0.mul(r0).add(d.mul(d)).add(r0.mul(d).mul(mu0).mul(2))), mu1 = r0.mul(mu0).add(d).div(r1);
    const forward = opticalDepth(tables, r0, mu0).sub(opticalDepth(tables, r1, mu1));
    const backward = opticalDepth(tables, r1, mu1.negate()).sub(opticalDepth(tables, r0, mu0.negate()));
    const transmittance = exp(max(select(hits, backward, forward), vec3(0)).negate());
    // The whole ray: to space, or to the sea (whose zenith cosine there follows from the ground distance).
    const groundMu = r0.mul(mu0).add(ground.max(0)).div(RB);
    const whole = exp(max(select(hits, opticalDepth(tables, float(RB), groundMu.negate()).sub(opticalDepth(tables, r0, mu0.negate())),
      opticalDepth(tables, r0, mu0)), vec3(0)).negate());
    const share = float(1).sub(transmittance).div(max(float(1).sub(whole), vec3(1e-5))).clamp(0, 1);
    return { inscatter: this.radiance(direction, fromSea, false).mul(share), transmittance };
  }

  ambient(altitude: Float): { above: Vec3; below: Vec3 } {
    const uv = vec2(unitToTexel(altitude.div(AMBIENT_TOP * 1000).clamp(0, 1), AMBIENT_SIZE), .5);
    return { above: direct(texture(this.tables.above, uv)).rgb, below: direct(texture(this.tables.below, uv)).rgb };
  }

  dispose(): void { this.tables.dispose(); }

  /** Radius (km) of the viewpoint: the camera's, as its sections were built, or the sea's. */
  private radius(fromSea: boolean): Float {
    return fromSea ? float(RB + SEA_HEIGHT) : this.cameraHeight.add(RB);
  }

  /** Share of a light reaching a world position, with the planet centred under the camera. */
  private lightAt(position: Vec3, light: Node<'vec3'>): Vec3 {
    const camera = this.uniforms.cameraPosition;
    const point = vec3(position.x.sub(camera.x).div(1000), position.y.div(1000).add(RB), position.z.sub(camera.z).div(1000));
    const r = point.length().max(RB);
    return lightTransmittance(this.tables, r, dot(point, light).div(r));
  }

  /** The sky along a direction from the atlas: both lights' tables, the aerosol lobe per pixel. */
  private radiance(direction: Vec3, fromSea: boolean, aboveOnly: boolean): Vec3 {
    const { sunDirection, moonDirection } = this.uniforms;
    const horizon: Horizon = fromSea ? { zenith: float(this.seaHorizon.x), nadir: float(this.seaHorizon.y) }
      : { zenith: this.cameraHorizon.x, nadir: this.cameraHorizon.y };
    const latitude = skyViewLatitude(direction.y, horizon, aboveOnly);
    const read = (light: Node<'vec3'>, section: number): Scatter => {
      const uv = atlasUv(skyViewLongitude(direction, light), latitude, section);
      return { scatter: direct(texture(this.tables.scatter, uv)).rgb.mul(1 / SKY_VIEW_SCALE), mie: direct(texture(this.tables.mie, uv)).rgb.mul(1 / SKY_VIEW_SCALE) };
    };
    return this.compose(read(sunDirection, fromSea ? SECTIONS.seaSun : SECTIONS.cameraSun), read(moonDirection, fromSea ? SECTIONS.seaMoon : SECTIONS.cameraMoon), direction);
  }

  /** Scattered light of both bodies (per unit irradiance) as the dome shows it: each light's irradiance and lift,
   * the aerosol's lobe, the grade and the night floor. */
  private compose(sun: Scatter, moon: Scatter, direction: Vec3): Vec3 {
    const { sunDirection, moonDirection, sunIrradiance, moonIrradiance } = this.uniforms, { mieG, mieGain } = this.air;
    const sunlit = sun.scatter.add(sun.mie.mul(aureolePhase(dot(direction, sunDirection), mieG).mul(mieGain))).mul(sunIrradiance).mul(this.sunLift);
    const moonlit = moon.scatter.add(moon.mie.mul(aureolePhase(dot(direction, moonDirection), mieG).mul(mieGain))).mul(moonIrradiance).mul(SKY_GRADE.moon);
    const scattered = sunlit.add(moonlit).mul(SKY_GRADE.gain);
    const brightness = luminance(scattered).max(1e-6), { knee, ceiling } = SKY_GRADE.shoulder;
    const over = brightness.sub(knee).max(0), rolled = select(brightness.greaterThan(knee), over.div(over.div(ceiling - knee).add(1)).add(knee), brightness);
    const graded = mix(vec3(brightness), scattered, SKY_GRADE.saturation).max(0).mul(rolled.div(brightness));
    const [r, g, b] = SKY_GRADE.floor as Rgb;
    const floor = vec3(r, g, b).mul(pow(float(1).sub(direction.y.abs()), 4).mul(SKY_GRADE.floorHorizon).add(1));
    return graded.add(floor);
  }
}

