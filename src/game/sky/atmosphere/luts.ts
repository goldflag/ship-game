/** The atmosphere's precomputed tables and the shader maths that builds and reads them (Hillaire, EGSR
 * 2020). Every table is a full-screen fragment pass into a small render target:
 *
 * - optical depth to the top of the air (256 × 64, float32), Bruneton's parameterisation;
 * - multiple scattering (32 × 32), the infinite series of higher orders as a transfer to one point;
 * - the sky view (192 × 108 per section, an atlas of four): in-scattered light around a viewpoint,
 *   finest at the horizon and toward the light. Sections are sun and moon seen from the camera, then
 *   sun and moon seen from sea level under it (the environment bake's viewpoint). Each holds the
 *   Rayleigh single scattering with its phase and all multiple scattering in one texture, and the
 *   aerosol's single scattering without its phase in another: the sharp Cornette–Shanks lobe is
 *   applied per pixel, so the aureole stays crisp at any table size;
 * - the ambient light at altitude (64 texels up to 16 km): the sky's mean radiance from above and the
 *   air's and sea's from below, for the clouds.
 *
 * Lengths are kilometres, directions unit vectors in a frame whose +Y is the local vertical at the
 * camera (the planet's centre lies straight below it). See `model.ts` for the profiles. */
import { FloatType, HalfFloatType, LinearFilter, NoBlending, NodeMaterial, QuadMesh, RGBAFormat, RenderTarget, Vector2, Vector3,
  type Node, type Texture, type UniformNode } from 'three/webgpu';
import { Fn, If, Loop, abs, acos, cos, dot, exp, float, floor, int, max, min, mrt, normalize, pow, screenCoordinate, select, sin, smoothstep,
  sqrt, texture, vec2, vec3, vec4 } from 'three/tsl';
import { ATMOSPHERE_TOP, AUREOLE, MIE_HEIGHT, OZONE_HALF_WIDTH, OZONE_PEAK, PLANET_RADIUS, RAYLEIGH_HEIGHT, SEA_ALBEDO } from './model';

export type Float = Node<'float'>;
export type Vec2 = Node<'vec2'>;
export type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;
type TextureMap = ReturnType<typeof texture>;

const RB = PLANET_RADIUS, RT = ATMOSPHERE_TOP;
/** Distance from the ground to the top of the air along a horizontal ray at sea level (km). */
const H = Math.sqrt(RT * RT - RB * RB);
/** Viewpoint of the sea-level sections: just above the water, which keeps the horizon maths finite. */
export const SEA_HEIGHT = .002;
/** Half the sun's angular diameter as a cosine difference near the horizon: the width of the planet's
 * shadow edge as the disc sinks. */
const SHADOW_EDGE = .0047;

export const TRANSMITTANCE_SIZE = new Vector2(256, 64);
export const MULTIPLE_SIZE = 32;
/** One section of the sky-view atlas. */
export const SKY_VIEW_SIZE = new Vector2(192, 108);
/** Atlas sections, top to bottom. */
export const SECTIONS = { cameraSun: 0, cameraMoon: 1, seaSun: 2, seaMoon: 3 } as const;
export const AMBIENT_SIZE = 64, AMBIENT_TOP = 16;
/** The sky view stores in-scattering per unit irradiance times this, which keeps deep twilight's tiny
 * values out of half-float's denormals. */
export const SKY_VIEW_SCALE = 1024;
/** Steps along each ray of each table. */
const TRANSMITTANCE_STEPS = 40, MULTIPLE_STEPS = 20, MULTIPLE_DIRECTIONS = 8, SKY_VIEW_STEPS = 32, AMBIENT_STEPS = 12, AMBIENT_DIRECTIONS = 8;

/** The air's coefficients as uniforms (per km), shared by every pass and sampler. `model.ts` fills them. */
export interface AirUniforms {
  readonly rayleigh: UniformNode<'vec3', Vector3>;
  readonly mieScattering: UniformNode<'vec3', Vector3>;
  readonly mieExtinction: UniformNode<'vec3', Vector3>;
  readonly ozone: UniformNode<'vec3', Vector3>;
  readonly mieG: UniformNode<'float', number>;
  readonly mieGain: UniformNode<'float', number>;
  readonly multiple: UniformNode<'float', number>;
}

/** A texture read without three's uv matrix uniform. */
export function direct(node: TextureMap): TextureMap { node.updateMatrix = false; return node; }

/** Texel-centre mapping of a unit coordinate: 0 and 1 land on the first and last texel centres, so a
 * table's edge rows hold exactly the edge parameters and bilinear reads never wrap. */
export const unitToTexel = (unit: Float, size: number): Float => unit.mul(size - 1).add(.5).div(size);
const texelToUnit = (pixel: Float, size: number): Float => pixel.sub(.5).div(size - 1);

export const rayleighPhase = (nu: Float): Float => nu.mul(nu).add(1).mul(3 / (16 * Math.PI));
/** Cornette–Shanks: Henyey–Greenstein's forward lobe with Rayleigh's symmetric term, as aerosol scatters. */
export function miePhase(nu: Float, g: Float): Float {
  const g2 = g.mul(g);
  return float(3 / (8 * Math.PI)).mul(float(1).sub(g2)).mul(nu.mul(nu).add(1))
    .div(g2.add(2).mul(pow(g2.add(1).sub(g.mul(nu).mul(2)).max(1e-4), 1.5)));
}
/** `model.aureolePhase`: the authored lobe with a narrow forward core. */
export function aureolePhase(nu: Float, g: Float): Float {
  const { core, coreG } = AUREOLE;
  const peak = float((1 - coreG * coreG) / (4 * Math.PI)).div(pow(float(1 + coreG * coreG).sub(nu.mul(2 * coreG)).max(1e-4), 1.5));
  return miePhase(nu, g).mul(1 - core).add(peak.mul(core));
}

/** Scattering and extinction of the air at an altitude (km). */
function medium(air: AirUniforms, altitude: Float) {
  const h = altitude.max(0);
  const rayleigh = air.rayleigh.mul(exp(h.div(-RAYLEIGH_HEIGHT)));
  const aerosol = exp(h.div(-MIE_HEIGHT));
  const ozone = max(float(1).sub(abs(h.sub(OZONE_PEAK)).div(OZONE_HALF_WIDTH)), 0);
  return { rayleigh, mie: air.mieScattering.mul(aerosol), extinction: rayleigh.add(air.mieExtinction.mul(aerosol)).add(air.ozone.mul(ozone)) };
}

/** Distance (km) from radius `r` along zenith cosine `mu` to the top of the air. */
export function distanceToTop(r: Float, mu: Float): Float {
  return max(r.negate().mul(mu).add(sqrt(max(r.mul(r).mul(mu.mul(mu).sub(1)).add(RT * RT), 0))), 0);
}
/** Distance (km) to the sea along the ray, or a negative number where it misses it. */
export function distanceToGround(r: Float, mu: Float): Float {
  const discriminant = r.mul(r).mul(mu.mul(mu).sub(1)).add(RB * RB);
  return select(mu.lessThan(0).and(discriminant.greaterThanEqual(0)), r.negate().mul(mu).sub(sqrt(max(discriminant, 0))), float(-1));
}
/** Zenith cosine of the geometric horizon from radius `r`: −√(1 − (R/r)²), from the altitude for precision. */
export function horizonCosine(r: Float): Float {
  const h = r.sub(RB).max(0);
  return sqrt(h.mul(h.add(2 * RB))).div(r).negate();
}
/** 1 where the light at zenith cosine `mu` clears the planet from radius `r`, 0 in its shadow. */
export function planetShadow(r: Float, mu: Float): Float {
  const horizon = horizonCosine(r);
  return smoothstep(horizon.sub(SHADOW_EDGE), horizon.add(SHADOW_EDGE), mu);
}

/** Bruneton's (2017) transmittance coordinates: the distance to the top between its extremes, the
 * radius as the distance to the horizon. */
function transmittanceUv(r: Float, mu: Float): Vec2 {
  const rho = sqrt(max(r.mul(r).sub(RB * RB), 0));
  const dMin = float(RT).sub(r), dMax = rho.add(H);
  const xMu = distanceToTop(r, mu).sub(dMin).div(max(dMax.sub(dMin), 1e-4));
  return vec2(unitToTexel(xMu.clamp(0, 1), TRANSMITTANCE_SIZE.x), unitToTexel(rho.div(H).clamp(0, 1), TRANSMITTANCE_SIZE.y));
}

/** The four tables; built by `AtmosphereTables`, read by the part's samplers. */
export interface Tables {
  readonly opticalDepth: Texture;
  readonly multiple: Texture;
  readonly scatter: Texture;
  readonly mie: Texture;
  readonly above: Texture;
  readonly below: Texture;
}

/** Optical depth from radius `r` along `mu` to the top of the air (valid where the ray misses the sea). */
export function opticalDepth(tables: Tables, r: Float, mu: Float): Vec3 {
  return direct(texture(tables.opticalDepth, transmittanceUv(r.clamp(RB, RT), mu))).rgb;
}
/** Transmittance from radius `r` toward a light at zenith cosine `mu`, the planet's shadow included. */
export function lightTransmittance(tables: Tables, r: Float, mu: Float): Vec3 {
  return exp(opticalDepth(tables, r, mu).negate()).mul(planetShadow(r, mu));
}
/** Multiple scattering reaching a point at altitude `h` (km) under a light at zenith cosine `mu`, per unit of
 * scattering coefficient and of irradiance. */
function multipleScattering(tables: Tables, h: Float, mu: Float): Vec3 {
  const uv = vec2(unitToTexel(mu.mul(.5).add(.5).clamp(0, 1), MULTIPLE_SIZE), unitToTexel(h.div(RT - RB).clamp(0, 1), MULTIPLE_SIZE));
  return direct(texture(tables.multiple, uv)).rgb;
}

/** What the sky-view atlas holds for a viewpoint: the horizon's zenith angle and the angle from nadir to it. */
export interface Horizon { zenith: Float; nadir: Float }
/** Horizon angles for a viewpoint at altitude `h` (km). */
export function horizonAngles(h: Float): Horizon {
  const nadir = acos(sqrt(h.mul(h.add(2 * RB))).div(h.add(RB)).clamp(0, 1));
  return { zenith: float(Math.PI).sub(nadir), nadir };
}
/** The sky-view table's unit latitude for a view zenith cosine: squared toward the horizon on both sides,
 * so texels crowd where the sky changes fastest. `aboveOnly` holds directions under the horizontal at the
 * horizontal, and never past the last row above the geometric horizon: from altitude the sea's far fog
 * (which reads the sky at the horizontal) then meets the dome just above the sea's edge without a seam. */
export function skyViewLatitude(mu: Float, horizon: Horizon, aboveOnly: boolean): Float {
  const theta = acos(mu.clamp(aboveOnly ? 0 : -1, 1));
  const above = float(1).sub(sqrt(max(float(1).sub(theta.div(horizon.zenith)), 0))).mul(.5);
  if (aboveOnly) return min(above, (SKY_VIEW_SIZE.y / 2 - 1) / (SKY_VIEW_SIZE.y - 1));
  const below = sqrt(max(theta.sub(horizon.zenith).div(horizon.nadir), 0)).mul(.5).add(.5);
  return select(theta.lessThan(horizon.zenith), above, below);
}
/** The sky-view table's unit longitude: 0 toward the light, 1 away from it, finest toward it. */
export function skyViewLongitude(direction: Vec3, light: Vec3): Float {
  const across = direction.xz, toward = light.xz;
  const cosine = dot(across, toward).div(max(across.length().mul(toward.length()), 1e-6)).clamp(-1, 1);
  return sqrt(float(.5).sub(cosine.mul(.5)).max(0));
}
/** Atlas coordinates of a unit (longitude, latitude) in a section. */
export function atlasUv(longitude: Float, latitude: Float, section: number): Vec2 {
  const rows = SKY_VIEW_SIZE.y;
  return vec2(unitToTexel(longitude, SKY_VIEW_SIZE.x), latitude.mul(rows - 1).add(.5).add(section * rows).div(rows * 4));
}

/** Single and multiple scattering accumulated along a ray: `scatter` holds Rayleigh with its phase and
 * all multiple scattering, `mie` the aerosol's single scattering without its phase (per unit irradiance). */
interface Inscatter { scatter: Vec3; mie: Vec3; transmittance: Vec3 }

/** March a ray from `origin` (planet-centred, km) along `direction` for `length` km toward a light,
 * with samples crowding toward the start. Call inside a `Fn`. */
function march(air: AirUniforms, tables: Tables, origin: Vec3, direction: Vec3, light: Vec3, length: Float, steps: number, rayleighPhaseValue: Float): Inscatter {
  const scatter = vec3(0).toVar(), mie = vec3(0).toVar(), throughput = vec3(1).toVar();
  Loop({ start: int(0), end: int(steps), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
    const t0 = length.mul(pow(float(i).div(steps), 2)), t1 = length.mul(pow(float(i).add(1).div(steps), 2));
    const dt = t1.sub(t0), t = t0.add(dt.mul(.3));
    const position = origin.add(direction.mul(t)), r = position.length().toVar();
    const up = position.div(r), altitude = r.sub(RB);
    const lightMu = dot(up, light);
    const air_ = medium(air, altitude);
    const sunlit = lightTransmittance(tables, r, lightMu);
    const ms = multipleScattering(tables, altitude, lightMu).mul(air.multiple);
    const sourceScatter = air_.rayleigh.mul(sunlit).mul(rayleighPhaseValue).add(air_.rayleigh.add(air_.mie).mul(ms));
    const sourceMie = air_.mie.mul(sunlit);
    const extinction = air_.extinction.max(1e-7);
    const step = exp(extinction.mul(dt).negate());
    // Energy-conserving integration of each segment (Hillaire 2015): ∫ S·T over the step.
    const weight = throughput.mul(float(1).sub(step)).div(extinction);
    scatter.addAssign(sourceScatter.mul(weight));
    mie.addAssign(sourceMie.mul(weight));
    throughput.mulAssign(step);
  });
  return { scatter, mie, transmittance: throughput };
}

function passMaterial(output: Node, name: string): NodeMaterial {
  const material = new NodeMaterial();
  material.name = name;
  material.fragmentNode = output;
  material.depthTest = material.depthWrite = false;
  material.blending = NoBlending; material.toneMapped = false; material.fog = false;
  return material;
}

function target(width: number, height: number, type: typeof FloatType | typeof HalfFloatType, names: string[]): RenderTarget {
  const result = new RenderTarget(width, height, { count: names.length, type, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter,
    depthBuffer: false, generateMipmaps: false });
  result.textures.forEach((t, i) => { t.name = names[i]; });
  return result;
}

/** Uniforms the passes read beyond the air: where the camera's sections stand and the lights. */
export interface PassInputs {
  readonly air: AirUniforms;
  /** Camera altitude (km) the camera sections were built for. */
  readonly cameraHeight: UniformNode<'float', number>;
  readonly sunDirection: Node<'vec3'>;
  readonly moonDirection: Node<'vec3'>;
  /** Radiance of the sky as the ambient tables store it, along a world direction from altitude `h`: the
   * part assembles the lights, gains and night floor (see `Atmosphere.radiance`). */
  readonly compose: (sun: { scatter: Vec3; mie: Vec3 }, moon: { scatter: Vec3; mie: Vec3 }, direction: Vec3) => Vec3;
  /** Irradiance of the sun and moon at the sea for the ambient's sea bounce, each × its lift (world units). */
  readonly sunLight: Vec3;
  readonly moonLight: Vec3;
}

/** The atmosphere's render targets and the passes that fill them. */
export class AtmosphereTables implements Tables {
  private readonly opticalDepthTarget = target(TRANSMITTANCE_SIZE.x, TRANSMITTANCE_SIZE.y, FloatType, ['opticalDepth']);
  private readonly multipleTarget = target(MULTIPLE_SIZE, MULTIPLE_SIZE, HalfFloatType, ['multiple']);
  private readonly skyViewTarget = target(SKY_VIEW_SIZE.x, SKY_VIEW_SIZE.y * 4, HalfFloatType, ['scatter', 'mie']);
  private readonly aboveTarget = target(AMBIENT_SIZE, 1, HalfFloatType, ['above']);
  private readonly belowTarget = target(AMBIENT_SIZE, 1, HalfFloatType, ['below']);
  private readonly passes: { opticalDepth: QuadMesh; multiple: QuadMesh; skyView: QuadMesh; above: QuadMesh; below: QuadMesh };

  constructor(inputs: PassInputs) {
    this.passes = {
      opticalDepth: new QuadMesh(passMaterial(this.opticalDepthPass(inputs.air), 'Sky optical depth')),
      multiple: new QuadMesh(passMaterial(this.multiplePass(inputs.air), 'Sky multiple scattering')),
      skyView: new QuadMesh(passMaterial(this.skyViewPass(inputs), 'Sky view')),
      above: new QuadMesh(passMaterial(this.ambientPass(inputs, true), 'Sky ambient above')),
      below: new QuadMesh(passMaterial(this.ambientPass(inputs, false), 'Sky ambient below')),
    };
  }

  get opticalDepth(): Texture { return this.opticalDepthTarget.texture; }
  get multiple(): Texture { return this.multipleTarget.texture; }
  get scatter(): Texture { return this.skyViewTarget.textures[0]; }
  get mie(): Texture { return this.skyViewTarget.textures[1]; }
  get above(): Texture { return this.aboveTarget.texture; }
  get below(): Texture { return this.belowTarget.texture; }

  /** Rebuild what changed: the air (every table), the lights (sky views and ambient), or only the camera's altitude. */
  render(renderer: import('three/webgpu').WebGPURenderer, what: { air: boolean; lights: boolean; camera: boolean }): void {
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const mrtState = renderer.getMRT(), autoClear = renderer.autoClear;
    const draw = (target: RenderTarget, pass: QuadMesh, rows?: [number, number]) => {
      if (rows) target.viewport.set(0, rows[0], target.width, rows[1] - rows[0]);
      else target.viewport.set(0, 0, target.width, target.height);
      renderer.setRenderTarget(target);
      pass.render(renderer);
    };
    try {
      renderer.setMRT(null);
      renderer.autoClear = false;
      if (what.air) {
        draw(this.opticalDepthTarget, this.passes.opticalDepth);
        draw(this.multipleTarget, this.passes.multiple);
      }
      const rows = SKY_VIEW_SIZE.y;
      if (what.air || what.lights) draw(this.skyViewTarget, this.passes.skyView);
      else if (what.camera) draw(this.skyViewTarget, this.passes.skyView, [0, 2 * rows]);
      if (what.air || what.lights) {
        draw(this.aboveTarget, this.passes.above);
        draw(this.belowTarget, this.passes.below);
      }
    } finally {
      renderer.setRenderTarget(previous, face, level);
      renderer.setMRT(mrtState);
      renderer.autoClear = autoClear;
    }
  }

  /** Optical depth to the top of the air over Bruneton's (r, μ) parameterisation. */
  private opticalDepthPass(air: AirUniforms): Vec4 {
    return Fn(() => {
      const xMu = texelToUnit(screenCoordinate.x, TRANSMITTANCE_SIZE.x), xR = texelToUnit(screenCoordinate.y, TRANSMITTANCE_SIZE.y);
      const rho = xR.mul(H), r = sqrt(rho.mul(rho).add(RB * RB)).toVar();
      const dMin = float(RT).sub(r), dMax = rho.add(H);
      const d = dMin.add(xMu.mul(dMax.sub(dMin))).toVar();
      const mu = select(d.lessThan(1e-4), float(1), float(H * H).sub(rho.mul(rho)).sub(d.mul(d)).div(r.mul(d).mul(2).max(1e-6))).clamp(-1, 1).toVar();
      const depth = vec3(0).toVar();
      Loop({ start: int(0), end: int(TRANSMITTANCE_STEPS), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        const t0 = d.mul(pow(float(i).div(TRANSMITTANCE_STEPS), 2)), t1 = d.mul(pow(float(i).add(1).div(TRANSMITTANCE_STEPS), 2));
        const t = t0.add(t1).mul(.5);
        const radius = sqrt(r.mul(r).add(t.mul(t)).add(r.mul(t).mul(mu).mul(2)));
        depth.addAssign(medium(air, radius.sub(RB)).extinction.mul(t1.sub(t0)));
      });
      return vec4(depth, 1);
    })();
  }

  /** Hillaire's multiple scattering: second-order light arriving at a point from every direction under an
   * isotropic phase, summed as a geometric series with the share of light the surroundings return. */
  private multiplePass(air: AirUniforms): Vec4 {
    return Fn(() => {
      const mu = texelToUnit(screenCoordinate.x, MULTIPLE_SIZE).mul(2).sub(1);
      const altitude = texelToUnit(screenCoordinate.y, MULTIPLE_SIZE).mul(RT - RB).max(SEA_HEIGHT);
      const origin = vec3(0, altitude.add(RB), 0);
      const light = vec3(sqrt(float(1).sub(mu.mul(mu)).max(0)), mu, 0);
      const luminance = vec3(0).toVar(), transfer = vec3(0).toVar();
      const count = MULTIPLE_DIRECTIONS * MULTIPLE_DIRECTIONS;
      Loop({ start: int(0), end: int(count), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        // Stratified uniform directions over the sphere.
        const a = float(i.div(MULTIPLE_DIRECTIONS)).add(.5).div(MULTIPLE_DIRECTIONS), b = float(i.mod(MULTIPLE_DIRECTIONS)).add(.5).div(MULTIPLE_DIRECTIONS);
        const cosine = float(1).sub(a.mul(2)), sine = sqrt(float(1).sub(cosine.mul(cosine)).max(0)), phi = b.mul(2 * Math.PI);
        const direction = vec3(sine.mul(cos(phi)), cosine, sine.mul(sin(phi))).toVar();
        const r = origin.y, viewMu = direction.y;
        const ground = distanceToGround(r, viewMu).toVar();
        const length = select(ground.greaterThan(0), ground, distanceToTop(r, viewMu)).toVar();
        const segment = vec3(0).toVar(), gathered = vec3(0).toVar(), throughput = vec3(1).toVar();
        // Nested loops both count in `i`; WGSL lets the inner one shadow the outer.
        Loop({ start: int(0), end: int(MULTIPLE_STEPS), type: 'int', condition: '<' }, ({ i: j }: { i: Node<'int'> }) => {
          const t0 = length.mul(float(j).div(MULTIPLE_STEPS)), dt = length.div(MULTIPLE_STEPS), t = t0.add(dt.mul(.5));
          const position = origin.add(direction.mul(t)), radius = position.length();
          const lightMu = dot(position.div(radius), light), air_ = medium(air, radius.sub(RB));
          const scattering = air_.rayleigh.add(air_.mie), extinction = air_.extinction.max(1e-7);
          const step = exp(extinction.mul(dt).negate()), weight = throughput.mul(float(1).sub(step)).div(extinction);
          segment.addAssign(scattering.mul(lightTransmittance(this, radius, lightMu)).mul(1 / (4 * Math.PI)).mul(weight));
          gathered.addAssign(scattering.mul(weight));
          throughput.mulAssign(step);
        });
        // The sea returns a little of the light that reaches it.
        If(ground.greaterThan(0), () => {
          const point = origin.add(direction.mul(ground)), normal = normalize(point);
          const lightMu = dot(normal, light);
          segment.addAssign(throughput.mul(lightTransmittance(this, float(RB), lightMu)).mul(lightMu.max(0)).mul(SEA_ALBEDO / Math.PI));
        });
        luminance.addAssign(segment.div(count));
        transfer.addAssign(gathered.div(count));
      });
      // Each further order is the last one times the share the surroundings return: L₂ / (1 − f).
      return vec4(luminance.div(float(1).sub(transfer).max(1e-3)), 1);
    })();
  }

  /** In-scattering around a viewpoint for each atlas section: which light and whose viewpoint depend on the row. */
  private skyViewPass(inputs: PassInputs): Node {
    const { air, cameraHeight, sunDirection, moonDirection } = inputs;
    // A material's fragment output must be the MRT itself: the march runs in the first output, which the
    // second reads through a variable (outputs build in texture order).
    const mie = vec3(0).toVar();
    const scatter = Fn(() => {
      const rows = SKY_VIEW_SIZE.y;
      const section = floor(screenCoordinate.y.div(rows)).toVar();
      const moon = section.equal(1).or(section.equal(3)), sea = section.greaterThanEqual(2);
      const longitude = texelToUnit(screenCoordinate.x, SKY_VIEW_SIZE.x), latitude = texelToUnit(screenCoordinate.y.sub(section.mul(rows)), rows);
      const altitude = select(sea, float(SEA_HEIGHT), cameraHeight).toVar();
      const horizon = horizonAngles(altitude);
      // Latitude: squared toward the horizon from the zenith and from the nadir.
      const above = float(1).sub(pow(float(1).sub(latitude.mul(2)), 2)).mul(horizon.zenith);
      const below = horizon.zenith.add(pow(latitude.mul(2).sub(1), 2).mul(horizon.nadir));
      const theta = select(latitude.lessThan(.5), above, below);
      // Longitude: the light's azimuth at 0, the opposite one at 1.
      const lightCosine = float(1).sub(longitude.mul(longitude).mul(2)).clamp(-1, 1);
      const direction = vec3(sin(theta).mul(lightCosine), cos(theta), sin(theta).mul(sqrt(float(1).sub(lightCosine.mul(lightCosine)).max(0)))).toVar();
      const lightMu = select(moon, moonDirection.y, sunDirection.y).clamp(-1, 1);
      const light = vec3(sqrt(float(1).sub(lightMu.mul(lightMu)).max(0)), lightMu, 0);
      const r = altitude.add(RB), ground = distanceToGround(r, direction.y);
      const length = select(ground.greaterThan(0), ground, distanceToTop(r, direction.y));
      const result = march(air, this, vec3(0, r, 0), direction, light, length, SKY_VIEW_STEPS, rayleighPhase(dot(direction, light)));
      mie.assign(result.mie.mul(SKY_VIEW_SCALE));
      return vec4(result.scatter.mul(SKY_VIEW_SCALE), 1);
    })();
    return mrt({ scatter, mie: vec4(mie, 1) });
  }

  /** The sky's mean radiance over the hemisphere above (or the air's and sea's below) at each altitude:
   * cosine-weighted directions, each marched toward both lights and composed as the dome is. */
  private ambientPass(inputs: PassInputs, upward: boolean): Vec4 {
    const { air, sunDirection, moonDirection, compose } = inputs;
    return Fn(() => {
      const altitude = texelToUnit(screenCoordinate.x, AMBIENT_SIZE).mul(AMBIENT_TOP).max(SEA_HEIGHT);
      const origin = vec3(0, altitude.add(RB), 0), r = origin.y;
      const total = vec3(0).toVar();
      const count = AMBIENT_DIRECTIONS * AMBIENT_DIRECTIONS;
      // The sea's radiance as the cloud bases see it: the diffuse bounce of sun, moon and sky, and the sky it mirrors.
      const skyAtSea = upward ? vec3(0) : direct(texture(this.above, vec2(.5 / AMBIENT_SIZE, .5))).rgb;
      Loop({ start: int(0), end: int(count), type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        const a = float(i.div(AMBIENT_DIRECTIONS)).add(.5).div(AMBIENT_DIRECTIONS), b = float(i.mod(AMBIENT_DIRECTIONS)).add(.5).div(AMBIENT_DIRECTIONS);
        // Cosine-weighted: the plain mean of these samples is the irradiance over π.
        const cosine = sqrt(float(1).sub(a)), sine = sqrt(a), phi = b.mul(2 * Math.PI);
        const direction = vec3(sine.mul(cos(phi)), upward ? cosine : cosine.negate(), sine.mul(sin(phi))).toVar();
        const ground = distanceToGround(r, direction.y).toVar();
        const length = select(ground.greaterThan(0), ground, distanceToTop(r, direction.y));
        const toSun = march(air, this, origin, direction, sunDirection, length, AMBIENT_STEPS, rayleighPhase(dot(direction, sunDirection)));
        const toMoon = march(air, this, origin, direction, moonDirection, length, AMBIENT_STEPS, rayleighPhase(dot(direction, moonDirection)));
        const radiance = compose(toSun, toMoon, direction).toVar();
        if (!upward) {
          If(ground.greaterThan(0), () => {
            const normal = normalize(origin.add(direction.mul(ground)));
            const sunMu = dot(normal, sunDirection), moonMu = dot(normal, moonDirection);
            const direct_ = inputs.sunLight.mul(lightTransmittance(this, float(RB), sunMu)).mul(sunMu.max(0))
              .add(inputs.moonLight.mul(lightTransmittance(this, float(RB), moonMu)).mul(moonMu.max(0)));
            // Water's hemispherical Fresnel reflectance of a uniform sky is about 0.066.
            const sea = direct_.mul(SEA_ALBEDO / Math.PI).add(skyAtSea.mul(SEA_ALBEDO + .066));
            radiance.addAssign(sea.mul(toSun.transmittance));
          });
        }
        total.addAssign(radiance.div(count));
      });
      return vec4(total, 1);
    })();
  }

  dispose(): void {
    for (const target of [this.opticalDepthTarget, this.multipleTarget, this.skyViewTarget, this.aboveTarget, this.belowTarget]) target.dispose();
    for (const pass of Object.values(this.passes)) (pass.material as NodeMaterial).dispose();
  }
}

