import { Color, MathUtils, Vector2, Vector3, type Node } from 'three/webgpu';
import { Fn, If, dot, exp, float, fract, inverseSqrt, luminance, max, min, mix, screenCoordinate, select, smoothstep, sqrt, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyFrame, SkyScene, SkyUniforms } from '../contracts';
import { AMBIENT_SIZE, AMBIENT_TOP, AtmosphereTables, SEA_HEIGHT, SECTIONS, SKY_VIEW_SCALE, atlasUv, aureolePhase, direct, distanceToGround,
  lightTransmittance, opticalDepth, skyViewLatitude, skyViewLongitude, unitToTexel, type AirUniforms, type Float, type Horizon, type Vec3 } from './luts';
import { PLANET_RADIUS, SKY_GRADE, airCoefficients, seaLevelLight, skyIrradiance, twilightLift, type AirCoefficients, type Rgb } from './model';

const RB = PLANET_RADIUS;
/** The camera's sections are rebuilt once its altitude moves by this share of itself, or 5 m near the sea. */
const REBUILD_SHARE = .02, REBUILD_MINIMUM = .005;
/** Highest camera altitude (km) the tables are built for: the air ends at 100 km. */
const HIGHEST_CAMERA = 90;
/** Width of the horizon edge (as a zenith cosine) over which bodies beyond the air sink out of sight. */
const HORIZON_EDGE = .0047;
/** Dome dither: ±half an 8-bit level of a gamma-2.2 display is a relative ±(1.1/255)·radiance^(−1/2.2); the inverse
 * square root stands in for that power. */
const DITHER = 2.2 / 255;
/** The sun lights the sky until it is this far below the horizon (degrees), past the twilight lift's last pair;
 * the moon while above this elevation and the sun below the second: elsewhere each is under a thousandth of
 * the sky and the dome skips its tables. */
const SUN_SETS = -14, MOON_SETS = -6, MOON_OUTSHONE = 15;

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
    mieG: uniform(.6), mieGain: uniform(1), multiple: uniform(1), saturation: uniform(SKY_GRADE.saturation),
  };
  /** The sky's exposure at dusk (`model.twilightLift`): multiplies everything the sun lights. */
  readonly sunLift = uniform(1);
  /** Camera altitude (km) the camera's sections were built for, its horizon angles and horizon zenith cosine. */
  readonly cameraHeight = uniform(.03);
  private readonly cameraHorizon = uniform(horizonOf(.03, new Vector2()));
  private readonly cameraHorizonCosine = uniform(0);
  private readonly seaHorizon = horizonOf(SEA_HEIGHT, new Vector2());
  /** 1 while the sun (or moon) lights the sky enough to read its tables. */
  private readonly sunActive = uniform(1);
  private readonly moonActive = uniform(1);
  readonly tables: AtmosphereTables;
  private coefficients?: AirCoefficients;
  private readonly dirty = { air: true, lights: true, camera: true };

  constructor(private readonly uniforms: SkyUniforms) {
    const sunLight = uniforms.sunIrradiance.mul(this.sunLift), moonLight = uniforms.moonIrradiance;
    this.tables = new AtmosphereTables({
      air: this.air, cameraHeight: this.cameraHeight, sunDirection: uniforms.sunDirection, moonDirection: uniforms.moonDirection,
      compose: (sun, moon, direction) => this.grade(this.lit(sun, direction, uniforms.sunDirection).mul(uniforms.sunIrradiance).mul(this.sunLift)
        .add(this.lit(moon, direction, uniforms.moonDirection).mul(uniforms.moonIrradiance).mul(SKY_GRADE.moon)), direction),
      sunLight, moonLight,
    });
    this.cameraHorizonCosine.value = this.horizonCosineOf(.03);
  }

  apply(scene: SkyScene): void {
    const air = airCoefficients(scene.atmosphere), u = this.air;
    if (JSON.stringify(air) !== JSON.stringify(this.coefficients)) {
      this.coefficients = air;
      u.rayleigh.value.fromArray(air.rayleigh); u.mieScattering.value.fromArray(air.mieScattering);
      u.mieExtinction.value.fromArray(air.mieExtinction); u.ozone.value.fromArray(air.ozone);
      u.mieG.value = air.mieG; u.mieGain.value = air.mieGain; u.multiple.value = air.multiple; u.saturation.value = SKY_GRADE.saturation * air.chroma;
      this.dirty.air = true;
    }
    const sun = scene.sun.elevation, moon = Math.asin(MathUtils.clamp(this.uniforms.moonDirection.value.y, -1, 1)) * MathUtils.RAD2DEG;
    this.sunLift.value = twilightLift(sun);
    this.sunActive.value = sun > SUN_SETS ? 1 : 0;
    this.moonActive.value = moon > MOON_SETS && sun < MOON_OUTSHONE ? 1 : 0;
    this.dirty.lights = true;
    const irradiance = this.uniforms.moonIrradiance.value;
    seaLevelLight(scene, air, { irradiance: [irradiance.x, irradiance.y, irradiance.z], elevationDeg: moon }, this.seaLevel);
    skyIrradiance(air, this.uniforms.sunDirection.value, scene.sun.intensity, this.sunLift.value, this.seaLevel.sky);
  }

  update(frame: SkyFrame): void {
    const altitude = MathUtils.clamp(this.uniforms.cameraPosition.value.y / 1000, SEA_HEIGHT, HIGHEST_CAMERA);
    if (Math.abs(altitude - this.cameraHeight.value) > Math.max(REBUILD_MINIMUM, REBUILD_SHARE * altitude)) {
      this.cameraHeight.value = altitude;
      horizonOf(altitude, this.cameraHorizon.value);
      this.cameraHorizonCosine.value = this.horizonCosineOf(altitude);
      this.dirty.camera = true;
    }
    const { dirty } = this;
    if (!dirty.air && !dirty.lights && !dirty.camera) return;
    this.tables.render(frame.renderer, dirty);
    dirty.air = dirty.lights = dirty.camera = false;
  }

  setQuality(): void {}

  sky(direction: Vec3, fromSea = false): Vec3 {
    // Half a display level of static noise: the night's dark, smooth gradients band in 8 bits without it.
    const radiance = this.radiance(direction, fromSea, true), level = luminance(radiance).max(1e-6);
    const noise = fract(fract(screenCoordinate.x.mul(.06711056).add(screenCoordinate.y.mul(.00583715))).mul(52.9829189)).sub(.5);
    return radiance.mul(noise.mul(inverseSqrt(level).mul(DITHER).min(.16)).add(1));
  }

  transmittanceToSpace(direction: Vec3, fromSea = false): Vec3 {
    const mu = direction.y, horizon = fromSea ? float(this.horizonCosineOf(SEA_HEIGHT)) : this.cameraHorizonCosine;
    return exp(opticalDepth(this.tables, this.radius(fromSea), mu).negate()).mul(smoothstep(horizon.sub(HORIZON_EDGE), horizon.add(HORIZON_EDGE), mu));
  }

  sunTransmittance(position: Vec3): Vec3 {
    return this.lightAt(position, this.uniforms.sunDirection).mul(this.sunLift);
  }

  moonTransmittance(position: Vec3): Vec3 {
    return this.lightAt(position, this.uniforms.moonDirection);
  }

  /** Aerial perspective in closed form rather than a third table. Transmittance comes from optical depths in
   * the table (Bruneton's two-lookup form: the ray from the far end on, subtracted from the ray from the near
   * end; reversed for rays that meet the sea, whose reverse rises), so any distance works up to the sea or
   * space. The in-scattering is the sky's own along the direction, in the share of the whole ray's extinction
   * (green, the eye's channel) that lies before the point: exact when the light scattered per unit optical
   * depth is uniform along the ray, and it converges on the sky itself, so distant clouds melt into the
   * horizon in its colour. One share for all channels keeps near haze the sky's hue: per channel, the red
   * channel's aerosol-heavy depth ends low and tinted the first kilometres orange. With `fromSea` the ray
   * starts at the sea under the camera, as the environment bake sees it. */
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
    const share = float(1).sub(transmittance.g).div(max(float(1).sub(whole.g), 1e-5)).clamp(0, 1);
    return { inscatter: this.radiance(direction, fromSea, false).mul(share), transmittance };
  }

  /** The sky's mean radiance over the hemisphere above an altitude (irradiance over π), and that of the air and
   * sea below it, from the ambient table (0–16 km; held beyond). */
  ambient(altitude: Float): { above: Vec3; below: Vec3 } {
    const u = unitToTexel(altitude.div(AMBIENT_TOP * 1000).clamp(0, 1), AMBIENT_SIZE);
    return { above: direct(texture(this.tables.ambient, vec2(u, .25))).rgb, below: direct(texture(this.tables.ambient, vec2(u, .75))).rgb };
  }

  dispose(): void { this.tables.dispose(); }

  /** Radius (km) of the viewpoint: the camera's, as its sections were built, or the sea's. */
  private radius(fromSea: boolean): Float {
    return fromSea ? float(RB + SEA_HEIGHT) : this.cameraHeight.add(RB);
  }

  /** Zenith cosine of the geometric horizon from an altitude (km). */
  private horizonCosineOf(altitude: number): number {
    return -Math.sqrt(altitude * (altitude + 2 * RB)) / (altitude + RB);
  }

  /** Share of a light reaching a world position, with the planet centred under the camera. */
  private lightAt(position: Vec3, light: Node<'vec3'>): Vec3 {
    const camera = this.uniforms.cameraPosition;
    const point = vec3(position.x.sub(camera.x).div(1000), position.y.div(1000).add(RB), position.z.sub(camera.z).div(1000));
    const r = point.length().max(RB);
    return lightTransmittance(this.tables, r, dot(point, light).div(r));
  }

  /** The sky along a direction from the atlas: each lit body's tables, its aerosol lobe per pixel. A body too
   * dim to show (the moon by day, the sun deep in the night) skips its reads on a uniform branch. */
  private radiance(direction: Vec3, fromSea: boolean, aboveOnly: boolean): Vec3 {
    const { sunDirection, moonDirection, sunIrradiance, moonIrradiance } = this.uniforms;
    const horizon: Horizon = fromSea ? { zenith: float(this.seaHorizon.x), nadir: float(this.seaHorizon.y) }
      : { zenith: this.cameraHorizon.x, nadir: this.cameraHorizon.y };
    return Fn(() => {
      const latitude = skyViewLatitude(direction.y, horizon, aboveOnly).toVar();
      const read = (light: Node<'vec3'>, section: number): Scatter => {
        const uv = atlasUv(skyViewLongitude(direction, light), latitude, section);
        return { scatter: direct(texture(this.tables.scatter, uv)).rgb.mul(1 / SKY_VIEW_SCALE), mie: direct(texture(this.tables.mie, uv)).rgb.mul(1 / SKY_VIEW_SCALE) };
      };
      const scattered = vec3(0).toVar();
      If(this.sunActive.greaterThan(.5), () => {
        scattered.assign(this.lit(read(sunDirection, fromSea ? SECTIONS.seaSun : SECTIONS.cameraSun), direction, sunDirection).mul(sunIrradiance).mul(this.sunLift));
      });
      If(this.moonActive.greaterThan(.5), () => {
        scattered.addAssign(this.lit(read(moonDirection, fromSea ? SECTIONS.seaMoon : SECTIONS.cameraMoon), direction, moonDirection).mul(moonIrradiance).mul(SKY_GRADE.moon));
      });
      return this.grade(scattered, direction);
    })();
  }

  /** One body's scattered light per unit irradiance: the table's Rayleigh and multiple scattering, and the
   * aerosol's lobe toward it. */
  private lit(scatter: Scatter, direction: Vec3, light: Node<'vec3'>): Vec3 {
    return scatter.scatter.add(scatter.mie.mul(aureolePhase(dot(direction, light), this.air.mieG).mul(this.air.mieGain)));
  }

  /** The dome's grade (`model.SKY_GRADE`) over scattered light, and the night floor. */
  private grade(scattered: Vec3, direction: Vec3): Vec3 {
    const exposed = scattered.mul(SKY_GRADE.gain), brightness = luminance(exposed).max(1e-6), { knee, ceiling } = SKY_GRADE.shoulder;
    const over = brightness.sub(knee).max(0), rolled = select(brightness.greaterThan(knee), over.div(over.div(ceiling - knee).add(1)).add(knee), brightness);
    const graded = mix(vec3(brightness), exposed, this.air.saturation).max(0).mul(rolled.div(brightness));
    const [r, g, b] = SKY_GRADE.floor as Rgb, below = float(1).sub(direction.y.abs()), squared = below.mul(below);
    return graded.add(vec3(r, g, b).mul(squared.mul(squared).mul(SKY_GRADE.floorHorizon).add(1)));
  }
}
