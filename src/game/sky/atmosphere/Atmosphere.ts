import { Color, MathUtils, Vector2, Vector3, Vector4, type Node } from 'three/webgpu';
import { Fn, If, dot, exp, float, luminance, max, min, mix, select, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { AtmospherePart, SkyFrame, SkyScene, SkyUniforms } from '../contracts';
import { AMBIENT_SIZE, AMBIENT_TOP, AtmosphereTables, SEA_HEIGHT, SECTIONS, SKY_VIEW_SCALE, aerosolPhase, atlasUv, direct, distanceToGround,
  lightTransmittance, opticalDepth, skyViewLatitude, skyViewLongitude, unitToTexel, viewOpticalDepth, viewPointTerms, type AirUniforms, type Float,
  type Horizon, type Vec3 } from './luts';
import { AERIAL, PLANET_RADIUS, SKY_GRADE, airCoefficients, phaseTerms, seaLevelLight, skyIrradiance, twilightLift, type AirCoefficients, type Rgb } from './model';

const RB = PLANET_RADIUS;
/** The camera's sections are rebuilt once its altitude moves by this share of itself, or 5 m near the sea. */
const REBUILD_SHARE = .02, REBUILD_MINIMUM = .005;
/** Highest camera altitude (km) the tables are built for: the air ends at 100 km. */
const HIGHEST_CAMERA = 90;
/** Width of the horizon edge (as a zenith cosine) over which bodies beyond the air sink out of sight. */
const HORIZON_EDGE = .0047;
/** The sun lights the sky until it is this far below the horizon (degrees), past the twilight lift's last pair,
 * and the moon while it is above `MOON_SETS`. By day the moon's light in the air is a few hundredths of the sky's
 * at most, so it fades out as the sun climbs from `MOON_FADE[0]` to `[1]`; elsewhere the dome skips a body's
 * tables on a uniform branch. */
const SUN_SETS = -14, MOON_SETS = -6, MOON_FADE = [2, 8] as const;

type Scatter = { scatter: Vec3; mie: Vec3 };

/** Horizon angles (zenith angle of the geometric horizon, and nadir to horizon) for an altitude in km. */
function horizonOf(altitude: number, out: Vector4): Vector4 {
  const nadir = Math.acos(MathUtils.clamp(Math.sqrt(altitude * (altitude + 2 * RB)) / (altitude + RB), 0, 1));
  return out.set(Math.PI - nadir, nadir, 1 / (Math.PI - nadir), 1 / Math.max(nadir, 1e-6));
}

/** Unit horizontal direction toward a light, for the sky view's longitude; any for a light overhead. */
function axisOf(direction: Vector3, out: Vector2): Vector2 {
  const length = Math.hypot(direction.x, direction.z);
  return length > 1e-6 ? out.set(direction.x / length, direction.z / length) : out.set(1, 0);
}

/** The atmosphere part (see `README.md` and `luts.ts`): Hillaire's scattering tables, rebuilt when the air,
 * the lights or the camera's altitude change, and the samplers every other part composes. What a pixel would
 * otherwise recompute from uniforms (each light's scale and axis, the phase's scene terms, the viewpoints'
 * table terms) the CPU computes once. */
export class Atmosphere implements AtmospherePart {
  readonly seaLevel = { sun: new Color(), moon: new Color(), sky: new Color() };
  readonly air: AirUniforms = {
    rayleigh: uniform(new Vector3()), mieScattering: uniform(new Vector3()), mieExtinction: uniform(new Vector3()), ozone: uniform(new Vector3()),
    mieG: uniform(.6), mieGain: uniform(1), multiple: uniform(1), saturation: uniform(SKY_GRADE.saturation),
    phaseLobe: uniform(new Vector3()), phaseCore: uniform(new Vector3()),
  };
  /** The sky's exposure at dusk (`model.twilightLift`): multiplies everything the sun lights. An exposure belongs
   * to the viewer, so it follows the sun's elevation above the camera's own horizon: from the chart 14 km up the
   * sun sets nearly 4° later, and the sky there is still lit while the sea below is in twilight. */
  readonly sunLift = uniform(1);
  private sunElevation = 90;
  /** Each body's light in the dome per unit of its table: irradiance, lift, share and the grade's gain; 0 while it
   * cannot show. And each body's unit horizontal direction. */
  private readonly sunScale = uniform(new Vector3());
  private readonly moonScale = uniform(new Vector3());
  private readonly sunAxis = uniform(new Vector2(1, 0));
  private readonly moonAxis = uniform(new Vector2(1, 0));
  private moonShare = 1;
  /** The scene's aerial distance scale beyond the knee (`model.AERIAL`). */
  private readonly aerialScale = uniform(1);
  /** Camera altitude (km) the camera's sections were built for, its horizon angles and horizon zenith cosine,
   * and its optical-depth terms (`viewPointTerms`). */
  readonly cameraHeight = uniform(.03);
  private readonly cameraHorizon = uniform(horizonOf(.03, new Vector4()));
  private readonly cameraHorizonCosine = uniform(0);
  private readonly cameraView = uniform(viewPointTerms(.03, new Vector4()));
  private readonly seaHorizon = horizonOf(SEA_HEIGHT, new Vector4());
  private readonly seaView = viewPointTerms(SEA_HEIGHT, new Vector4());
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
      compose: (sun, moon, direction) => this.grade(this.lit(sun, direction, uniforms.sunDirection).mul(this.sunScale)
        .add(this.lit(moon, direction, uniforms.moonDirection).mul(this.moonScale)), direction),
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
      const phase = phaseTerms(air.mieG, air.mieGain);
      u.phaseLobe.value.fromArray(phase.lobe); u.phaseCore.value.fromArray(phase.core);
      this.aerialScale.value = air.aerialScale;
      this.dirty.air = true;
    }
    const sun = scene.sun.elevation, moon = Math.asin(MathUtils.clamp(this.uniforms.moonDirection.value.y, -1, 1)) * MathUtils.RAD2DEG;
    this.sunElevation = sun;
    this.sunLift.value = this.lift();
    this.moonShare = moon > MOON_SETS ? 1 - MathUtils.smoothstep(sun, ...MOON_FADE) : 0;
    this.sunActive.value = sun > SUN_SETS ? 1 : 0;
    this.moonActive.value = this.moonShare > 0 ? 1 : 0;
    this.refresh();
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
      viewPointTerms(altitude, this.cameraView.value);
      this.sunLift.value = this.lift();
      this.dirty.camera = true;
    }
    this.refresh();
    const { dirty } = this;
    if (!dirty.air && !dirty.lights && !dirty.camera) return;
    this.tables.render(frame.renderer, dirty);
    dirty.air = dirty.lights = dirty.camera = false;
  }

  setQuality(): void {}

  /** Any stage may call it: rain lights its drops from it in the vertex stage, so it carries no screen-space
   * dither (the dome adds that, `dome.ts`). */
  sky(direction: Vec3, fromSea = false): Vec3 {
    return this.radiance(direction, fromSea, true);
  }

  transmittanceToSpace(direction: Vec3, fromSea = false): Vec3 {
    const mu = direction.y, horizon = fromSea ? float(this.horizonCosineOf(SEA_HEIGHT)) : this.cameraHorizonCosine;
    return exp(viewOpticalDepth(this.tables, this.view(fromSea), mu).negate()).mul(smoothstep(horizon.sub(HORIZON_EDGE), horizon.add(HORIZON_EDGE), mu));
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
   * space. The in-scattering is the sky's own along the direction, in each channel's share of the whole ray's
   * extinction that lies before the point: exact where the light scattered per unit optical depth is uniform
   * along the ray, and it converges on the sky itself, so distant clouds melt into the horizon in its colour.
   * Per channel, the blue the air scatters in replaces the blue it takes out: a far cloud turns pale blue, not
   * grey. Distances past `AERIAL.knee` count at the scene's art-directed scale. With `fromSea` the ray starts at
   * the sea under the camera, as the environment bake sees it. */
  aerial(direction: Vec3, distance: Float, fromSea = false): { inscatter: Vec3; transmittance: Vec3 } {
    const tables = this.tables, view = this.view(fromSea), r0 = view.x, mu0 = direction.y;
    const kilometres = distance.div(1000).max(0);
    const scaled = min(kilometres, AERIAL.knee).add(kilometres.sub(AERIAL.knee).max(0).mul(this.aerialScale));
    const ground = distanceToGround(r0, mu0), hits = ground.greaterThan(0);
    const d = select(hits, min(scaled, ground), scaled);
    const r1 = sqrt(r0.mul(r0).add(d.mul(d)).add(r0.mul(d).mul(mu0).mul(2))), mu1 = r0.mul(mu0).add(d).div(r1);
    const up = viewOpticalDepth(tables, view, mu0), down = viewOpticalDepth(tables, view, mu0.negate());
    const forward = up.sub(opticalDepth(tables, r1, mu1));
    const backward = opticalDepth(tables, r1, mu1.negate()).sub(down);
    const transmittance = exp(max(select(hits, backward, forward), vec3(0)).negate());
    // The whole ray: to space, or to the sea (whose zenith cosine there follows from the ground distance).
    const groundMu = r0.mul(mu0).add(ground.max(0)).div(RB);
    const whole = exp(max(select(hits, opticalDepth(tables, float(RB), groundMu.negate()).sub(down), up), vec3(0)).negate());
    const share = vec3(1).sub(transmittance).div(max(vec3(1).sub(whole), vec3(1e-5))).clamp(0, 1);
    return { inscatter: this.radiance(direction, fromSea, false).mul(share), transmittance };
  }

  /** The sky's mean radiance over the hemisphere above an altitude (irradiance over π), and that of the air and
   * sea below it, from the ambient table (0–16 km; held beyond). */
  ambient(altitude: Float): { above: Vec3; below: Vec3 } {
    const u = unitToTexel(altitude.div(AMBIENT_TOP * 1000).clamp(0, 1), AMBIENT_SIZE);
    return { above: direct(texture(this.tables.ambient, vec2(u, .25))).rgb, below: direct(texture(this.tables.ambient, vec2(u, .75))).rgb };
  }

  dispose(): void { this.tables.dispose(); }

  /** The CPU's share of each light's terms, every frame (a few multiplies): the sun's lift follows the camera. */
  private refresh(): void {
    const { sunIrradiance, moonIrradiance, sunDirection, moonDirection } = this.uniforms;
    this.sunScale.value.copy(sunIrradiance.value).multiplyScalar(this.sunLift.value * SKY_GRADE.gain * this.sunActive.value);
    this.moonScale.value.copy(moonIrradiance.value).multiplyScalar(SKY_GRADE.moon * SKY_GRADE.gain * this.moonShare);
    axisOf(sunDirection.value, this.sunAxis.value);
    axisOf(moonDirection.value, this.moonAxis.value);
  }

  /** A viewpoint's optical-depth terms: the camera's, as its sections were built, or the sea's. */
  private view(fromSea: boolean): Node<'vec4'> {
    const sea = this.seaView;
    return fromSea ? vec4(sea.x, sea.y, sea.z, sea.w) : this.cameraView;
  }

  /** The twilight lift for the sun's elevation above the camera's geometric horizon. */
  private lift(): number {
    return twilightLift(this.sunElevation + Math.asin(-this.horizonCosineOf(this.cameraHeight.value)) * MathUtils.RAD2DEG);
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

  /** The sky view's latitude of a direction for a viewpoint (see `luts.skyViewLatitude`). */
  private latitude(direction: Vec3, fromSea: boolean, aboveOnly: boolean): Float {
    const sea = this.seaHorizon, camera = this.cameraHorizon;
    const horizon: Horizon = fromSea ? { zenith: float(sea.x), nadir: float(sea.y), inverseZenith: float(sea.z), inverseNadir: float(sea.w) }
      : { zenith: camera.x, nadir: camera.y, inverseZenith: camera.z, inverseNadir: camera.w };
    return skyViewLatitude(direction.y, horizon, aboveOnly);
  }

  /** The sky along a direction from the atlas: each lit body's tables, its aerosol lobe per pixel. A body too
   * dim to show (the moon by day, the sun deep in the night) skips its reads on a uniform branch. `aboveOnly` holds
   * directions below the horizontal at it (the dome). */
  private radiance(direction: Vec3, fromSea: boolean, aboveOnly: boolean): Vec3 {
    const { sunDirection, moonDirection } = this.uniforms;
    return Fn(() => {
      const latitude = this.latitude(direction, fromSea, aboveOnly).toVar();
      const read = (axis: Node<'vec2'>, section: number): Scatter => {
        const uv = atlasUv(skyViewLongitude(direction, axis), latitude, section);
        return { scatter: direct(texture(this.tables.scatter, uv)).rgb, mie: direct(texture(this.tables.mie, uv)).rgb };
      };
      const scattered = vec3(0).toVar();
      If(this.sunActive.greaterThan(.5), () => {
        scattered.assign(this.lit(read(this.sunAxis, fromSea ? SECTIONS.seaSun : SECTIONS.cameraSun), direction, sunDirection).mul(this.sunScale));
      });
      If(this.moonActive.greaterThan(.5), () => {
        scattered.addAssign(this.lit(read(this.moonAxis, fromSea ? SECTIONS.seaMoon : SECTIONS.cameraMoon), direction, moonDirection).mul(this.moonScale));
      });
      // The atlas stores its values scaled up (`SKY_VIEW_SCALE`); one multiply takes both bodies back.
      return this.grade(scattered.mul(1 / SKY_VIEW_SCALE), direction);
    })();
  }

  /** One body's scattered light per unit of its table: Rayleigh and multiple scattering, and the aerosol's lobe
   * toward it. */
  private lit(scatter: Scatter, direction: Vec3, light: Node<'vec3'>): Vec3 {
    return scatter.scatter.add(scatter.mie.mul(aerosolPhase(dot(direction, light), this.air.phaseLobe, this.air.phaseCore)));
  }

  /** The dome's grade (`model.SKY_GRADE`; its gain is in each body's scale) over scattered light, and the night floor. */
  private grade(exposed: Vec3, direction: Vec3): Vec3 {
    const brightness = luminance(exposed).max(1e-6), { knee, ceiling } = SKY_GRADE.shoulder;
    const over = brightness.sub(knee).max(0), rolled = select(brightness.greaterThan(knee), over.div(over.div(ceiling - knee).add(1)).add(knee), brightness);
    const graded = mix(vec3(brightness), exposed, this.air.saturation).max(0).mul(rolled.div(brightness));
    const [r, g, b] = SKY_GRADE.floor as Rgb, below = float(1).sub(direction.y.abs()), squared = below.mul(below);
    return graded.add(vec3(r, g, b).mul(squared.mul(squared).mul(SKY_GRADE.floorHorizon).add(1)));
  }
}
