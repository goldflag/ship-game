import { Vector3, type Node, type UniformNode } from 'three/webgpu';
import { Break, Fn, If, Loop, dot, exp, exp2, float, fract, int, max, min, mix, normalize, pow, select, smoothstep, sqrt, uniform, vec2, vec3 } from 'three/tsl';
import type { AtmospherePart, SkyUniforms } from '../contracts';
import type { CloudField, CloudSample } from './field';
import { FARTHEST, shellSegment } from './field';
import { marchRain, type RainOptions } from './rain';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;
type Int = Node<'int'>;

const asFloat = (x: Float | Int | number): Float => typeof x === 'number' ? float(x) : float(x);
const asInt = (x: Int | number): Int => typeof x === 'number' ? int(x) : x;

/** Multiple-scattering octaves (Wrenninge et al. 2013). */
const OCTAVES = 4;

/** The cloud lighting's grade: uniforms, so the look can be tuned live (the diagnostics page does). */
export const look = {
  /** Henyey–Greenstein lobes of cloud droplets: a strong forward lobe (the silver lining around a backlit
   * cloud) and a weak backward one (the glory side), mixed by `backShare`. */
  forward: uniform(.8), backward: uniform(-.3), backShare: uniform(.2),
  /** Each octave carries `energy` of the previous one's light, sees `reach` of its optical depth toward the
   * light and `flatten` of its phase asymmetry. */
  energy: uniform(.68), reach: uniform(.3), flatten: uniform(.5),
  /** How much the sky light filling a cloud (the atmosphere's ambient) is worth against direct light. */
  ambient: uniform(.2),
  /** Beer–powder: how dark the thin rims of a cloud seen away from the light go (0 none). */
  powder: uniform(.5),
  /** Overall gain on the sunlit (direct) term. */
  direct: uniform(1.4),
};
/** A ray this far below the horizon (its upward component) from under the layer meets the sea first. */
export const HORIZON_SKIP = -.002;
/** Rays march at most this far (m); a cloud farther than that is lost in the horizon haze anyway. */
export const MAX_DISTANCE = FARTHEST;
/** Shortest fine step (m); fine steps grow by this share of the distance (a pixel spans more cloud farther
 * out); empty air is crossed in strides this many fine steps long; this many empty fine steps end a stretch
 * of cloud. */
const MIN_STEP = 30, STEP_PER_DISTANCE = .008, EMPTY_STRIDE = 3, MISSES_BEFORE_STRIDE = 3;
/** Light-march samples toward the light: the first `LIGHT_FIRST` metres out, each further one 2^`LIGHT_GROWTH`
 * times farther, standing for `LIGHT_SPAN` of its distance. Four reach about 460 m, five 1.2 km. */
const LIGHT_FIRST = 25, LIGHT_GROWTH = 1.4, LIGHT_SPAN = .8;
/** Mean density of covered cloud, for the far light samples that read only the cover, and where they lie (m). */
const COVER_DENSITY = .45, FAR_LIGHT = [600, 1500] as const;
/** Metres short of the nearest cloud column a leap across clear air stops (the map is filtered). */
const CLEAR_MARGIN = 250;
/** Metres of layer beyond the farthest cloud marched over which the horizon bank reaches its full cover. */
const HORIZON_BANK = 60_000;
/** A ray whose transmittance falls below this stops: the rest is renormalised rather than marched. */
const OPAQUE = .03;

/** Henyey–Greenstein phase for the angle between the view ray and the light (`cosine`). */
export function henyeyGreenstein(cosine: Float, g: Float | number): Float {
  const eccentricity = asFloat(g), gg = eccentricity.mul(eccentricity);
  return gg.oneMinus().div(pow(gg.add(1).sub(eccentricity.mul(cosine).mul(2)).max(1e-4), 1.5).mul(4 * Math.PI));
}
function cloudPhase(cosine: Float, flatten: Float): Float {
  return mix(henyeyGreenstein(cosine, look.forward.mul(flatten)), henyeyGreenstein(cosine, look.backward.mul(flatten)), look.backShare);
}

/** Interleaved gradient noise (Jimenez 2014) in [0, 1), animated per frame: a well spread jitter for the
 * primary march's first step, which temporal reconstruction averages away. */
export function gradientJitter(pixel: Node<'vec2'>, frame: Float): Float {
  const p = pixel.add(vec2(frame.mul(5.588238), frame.mul(5.588238)));
  return fract(fract(dot(p, vec2(.06711056, .00583715))).mul(52.9829189));
}

/** The light the clouds are lit by: the sun, or the moon once the sun is too low to reach even their tops. */
export interface CloudLight {
  readonly direction: UniformNode<'vec3', Vector3>;
  /** 1 while the moon lights them. */
  readonly night: UniformNode<'float', number>;
}
export function createCloudLight(): CloudLight {
  return { direction: uniform(new Vector3(0, 1, 0)), night: uniform(0) };
}

/** Everything a march needs. */
export interface MarchContext {
  readonly sky: SkyUniforms;
  readonly atmosphere: AtmospherePart;
  readonly field: CloudField;
  readonly light: CloudLight;
  /** Gain on the sky light filling the clouds, and darkening of their bases (the scene's, mapped). */
  readonly ambient: UniformNode<'float', number>;
  readonly baseShadow: UniformNode<'float', number>;
}

/** What a march returns: in-scattered radiance (premultiplied), transmittance, and the transmittance-weighted
 * mean distance of what it met (`MAX_DISTANCE` where it met nothing). */
export interface MarchResult { radiance: Vec3; transmittance: Float; depth: Float }

/** Light colour (irradiance) at a world point: the sun's or the moon's through the air above it. */
export function cloudLightAt(sky: SkyUniforms, atmosphere: AtmospherePart, light: CloudLight, p: Vec3): Vec3 {
  return mix(atmosphere.sunTransmittance(p).mul(sky.sunIrradiance), atmosphere.moonTransmittance(p).mul(sky.moonIrradiance), light.night);
}
const lightAt = (context: MarchContext, p: Vec3) => cloudLightAt(context.sky, context.atmosphere, context.light, p);

/** The octaves' phase weights for one view ray (the angle to the light is the same all along it). */
function octavePhases(cosine: Float): Float[] {
  return Array.from({ length: OCTAVES }, (_, i) => cloudPhase(cosine, pow(look.flatten, i)).mul(pow(look.energy, i)).mul(look.direct).toVar());
}

/** Radiance a unit of cloud scatters toward the viewer, given its optical depth toward the light. */
function scatter(context: MarchContext, lightColour: Vec3, phases: Float[], cosine: Float, lightDepth: Float, height: Float, density: Float,
  ambient: { above: Vec3; below: Vec3 }): Vec3 {
  let direct: Float = phases[0].mul(exp(lightDepth.negate()));
  for (let i = 1; i < OCTAVES; i++) direct = direct.add(phases[i].mul(exp(lightDepth.mul(pow(look.reach, i)).negate())));
  // Beer–powder (Schneider & Vos 2015): the lit rim of a cloud seen side-on scatters less than its depths,
  // which draws the dark creases between cauliflower lobes. It fades out toward the backlit silver lining.
  const powder = mix(exp(density.mul(-6)).oneMinus().mul(look.powder).add(look.powder.oneMinus()), float(1), smoothstep(.2, .9, cosine));
  // Sky from above, the sea's bounce from below; bases darken where the whole cloud stands over them.
  const fill = mix(ambient.below, ambient.above, sqrt(height.clamp(0, 1))).mul(context.ambient)
    .mul(mix(context.baseShadow.oneMinus(), float(1), smoothstep(0, .6, height)));
  return lightColour.mul(direct.mul(powder)).add(fill.mul(look.ambient));
}

/** Optical depth toward the light from `p` (whose cloud sample is `near`) over `steps` samples, cone-spread so
 * shadows soften with distance. Unrolled: the samples are independent, so the GPU issues all their texture
 * reads at once instead of waiting out each in turn (15–20 % faster than a loop, measured). With no steps, an
 * estimate from the height in the layer: the blurred environment bake needs only the bulk of the light. */
function lightDepth(context: MarchContext, p: Vec3, near: CloudSample, steps: number, footprint?: Float): Float {
  const { field, light } = context;
  if (steps === 0) return near.height.oneMinus().mul(field.layer.thickness).mul(COVER_DENSITY * .5).mul(field.layer.extinction);
  let depth: Float = float(0);
  for (let i = 0; i < steps; i++) {
    const along = 2 ** (i * LIGHT_GROWTH) * LIGHT_FIRST;
    const spread = vec3(Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 3.1)).mul(.12 * i);
    const q = p.add(normalize(light.direction.add(spread)).mul(along));
    const s = field.sample(q, field.altitude(q), footprint, false);
    // The nearest sample reads the detail too: lobes shadowing each other draw the creases of a cauliflower top.
    const density = i === 0 && footprint && !experiment.noLightDetail ? field.erode(s, q, footprint, false) : s.coarse;
    depth = depth.add(density.mul(along * LIGHT_SPAN));
  }
  // Beyond the near samples only the cloud's bulk matters: two reads of the weather map's cover, out to 1.6 km,
  // shade the far side of a big cumulus and the underside of a deck.
  for (const along of experiment.noFarLight ? [] : FAR_LIGHT) {
    const q = p.add(light.direction.mul(along));
    depth = depth.add(field.cover(q, field.altitude(q), near).clamp(0, 1).mul(COVER_DENSITY * along * .5));
  }
  return depth.mul(field.layer.extinction);
}

export interface MarchOptions {
  /** Most steps: a uniform, so a tier change recompiles nothing. */
  readonly steps: Int | number;
  /** Light samples per lit step, fixed when the shader is built (see `lightDepth`); 0 estimates them. */
  readonly lightSteps: number;
  /** Jitter of the first step, 0–1. */
  readonly jitter: Float | number;
  /** Width (radians) of a pixel, for the detail erosion's footprint fade; bakes and shadows go without detail. */
  readonly pixelAngle?: Float;
  /** Rain shafts below the base (the screen march). */
  readonly rain?: RainOptions;
}

/** March a ray from `origin` (height `altitude` above the sea) along `direction` through the shell.
 * Emission-free, single-albedo medium integrated per step as Hillaire (2016): each step adds its in-scattering
 * weighted by what the step itself absorbs, which keeps coarse steps energy-conserving. Empty air is crossed
 * in long strides of the cheap density; the first hit steps back a stride and continues finely. */
export function marchClouds(context: MarchContext, origin: Vec3, altitude: Float, direction: Vec3, options: MarchOptions): MarchResult {
  const { field, sky, light } = context, layer = field.layer;
  const radiance = vec3(0).toVar(), transmittance = float(1).toVar(), depth = float(MAX_DISTANCE).toVar();
  const weighted = float(0).toVar(), weight = float(0).toVar();
  if (options.rain && !experiment.noRain) marchRain(context, options.rain, origin, altitude, direction, asFloat(options.jitter), { radiance, transmittance, weighted, weight });
  const top = layer.base.add(layer.thickness);
  const { start, end } = shellSegment(altitude, direction.y, layer.base, top);
  const from = start.toVar(), to = min(end, MAX_DISTANCE).toVar();
  // From under the layer, a ray below the horizon meets the sea (or the planet) before any cloud.
  const seaward = altitude.lessThan(layer.base).and(direction.y.lessThan(HORIZON_SKIP));
  If(to.greaterThan(from).and(layer.enabled.greaterThan(0)).and(seaward.not()), () => {
    const span = to.sub(from);
    const cosine = dot(direction, light.direction).toVar();
    const phases = octavePhases(cosine);
    // The light's colour at both ends of the stretch; between them it varies smoothly enough to interpolate.
    const lightNear = lightAt(context, origin.add(direction.mul(from))).toVar(), lightFar = lightAt(context, origin.add(direction.mul(to))).toVar();
    const ambient = context.atmosphere.ambient(layer.base.add(layer.thickness.mul(.5)));
    const above = ambient.above.toVar(), below = ambient.below.toVar();
    // Never so fine that the budget could not cross the whole stretch at the empty stride.
    const shortest = max(span.div(asFloat(options.steps).mul(EMPTY_STRIDE)), MIN_STEP).toVar();
    const t = from.add(shortest.mul(EMPTY_STRIDE).mul(asFloat(options.jitter))).toVar();
    const inside = float(0).toVar(), misses = float(0).toVar();
    // Clear air is crossed by the weather map's distance to the nearest cloud column, turned into distance
    // along this ray by how fast it moves across the ground.
    const across = max(direction.xz.length(), .05);
    Loop({ start: int(0), end: asInt(options.steps), type: 'int' }, () => {
      If(t.greaterThanEqual(to).or(transmittance.lessThan(OPAQUE)), () => { Break(); });
      const p = origin.add(direction.mul(t)).toVar();
      const fine = max(shortest, t.mul(STEP_PER_DISTANCE)).toVar();
      const footprint = options.pixelAngle ? t.mul(options.pixelAngle).toVar() : undefined;
      const s = field.sample(p, field.altitude(p), footprint);
      const coarse = s.coarse.toVar();
      If(coarse.greaterThan(0).and(inside.equal(0)), () => {
        // Found cloud from a stride: back up so its edge is met at the fine step.
        inside.assign(1); misses.assign(0);
        t.assign(max(t.sub(fine.mul(EMPTY_STRIDE - 1)), from));
      }).ElseIf(coarse.greaterThan(0), () => {
        misses.assign(0);
        const density = (footprint ? field.erode(s, p, footprint) : coarse).toVar();
        If(density.greaterThan(0), () => {
          const extinction = density.mul(layer.extinction);
          const toward = lightDepth(context, p, s, options.lightSteps, footprint);
          const colour = mix(lightNear, lightFar, t.sub(from).div(span).clamp(0, 1));
          const source = scatter(context, colour, phases, cosine, toward, s.height, density, { above, below });
          const absorbed = exp(extinction.mul(fine).negate()).oneMinus();
          const share = transmittance.mul(absorbed);
          radiance.addAssign(source.mul(share));
          weighted.addAssign(t.mul(share)); weight.addAssign(share);
          transmittance.mulAssign(absorbed.oneMinus());
        });
        t.addAssign(fine);
      }).Else(() => {
        // Out of cloud: a few more fine steps (lobes are ragged), then back to striding.
        misses.addAssign(inside);
        If(misses.greaterThan(MISSES_BEFORE_STRIDE), () => { inside.assign(0); });
        const leap = max(fine.mul(EMPTY_STRIDE), s.clear.sub(CLEAR_MARGIN).div(across));
        t.addAssign(select(inside.greaterThan(0), fine, leap));
      });
    });
    // Past the farthest cloud marched the layer still runs on to the horizon: a ray that reached that limit
    // meets more of it there, as a bank of cloud the haze swallows, in proportion to the sky's cover.
    if (!experiment.noBank) If(end.greaterThan(MAX_DISTANCE).and(t.greaterThanEqual(to)).and(transmittance.greaterThan(OPAQUE)), () => {
      const bank = field.bank(origin.add(direction.mul(to))).mul(smoothstep(0, HORIZON_BANK, end.sub(MAX_DISTANCE)));
      const colour = lightFar.mul(phases[OCTAVES - 1].mul(.5)).add(mix(below, above, .5).mul(context.ambient).mul(look.ambient));
      const share = transmittance.mul(bank);
      radiance.addAssign(colour.mul(share));
      weighted.addAssign(to.mul(share)); weight.addAssign(share);
      transmittance.mulAssign(bank.oneMinus());
    });
  });
  // A ray stopped as nearly opaque: what lay behind the last step would have looked like what it met.
  If(transmittance.lessThan(OPAQUE), () => {
    radiance.divAssign(transmittance.oneMinus());
    transmittance.assign(0);
  });
  If(weight.greaterThan(1e-4), () => {
    depth.assign(weighted.div(weight));
    // Aerial perspective once, at the mean depth: the air between dims the cloud and adds its own glow.
    const air = context.atmosphere.aerial(direction, depth);
    radiance.assign(radiance.mul(air.transmittance).add(air.inscatter.mul(transmittance.oneMinus())));
  });
  return { radiance, transmittance, depth };
}

/** Sun transmittance through the shell from a point at sea level, for the shadow map: a short march of the
 * coarse density along the sun, `steps` evenly spread over the stretch inside the shell. */
export function shadowTransmittance(context: MarchContext, point: Vec3, sun: Vec3, steps: number): Float {
  const { field } = context, layer = field.layer;
  return Fn(() => {
    const top = layer.base.add(layer.thickness);
    const altitude = field.altitude(point);
    const { start, end } = shellSegment(altitude, sun.y, layer.base, top);
    const depth = float(0).toVar();
    const length = min(end, MAX_DISTANCE).sub(start).max(0), step = length.div(steps);
    If(length.greaterThan(0), () => {
      for (let i = 0; i < steps; i++) {
        const p = point.add(sun.mul(start.add(step.mul(i + .5))));
        depth.addAssign(field.sample(p, field.altitude(p)).coarse);
      }
    });
    return exp(depth.mul(step).mul(layer.extinction).negate());
  })();
}

/** Build-time switches for cost experiments (diagnostics; kernels built after a change pick it up). */
export const experiment = { noLightDetail: false, noFarLight: false, noRain: false, noBank: false };
