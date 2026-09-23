import { Vector3, type Node, type UniformNode } from 'three/webgpu';
import { Break, Fn, If, Loop, dot, exp, exp2, float, fract, int, max, min, mix, normalize, pow, select, smoothstep, sqrt, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { AtmospherePart, SkyUniforms } from '../contracts';
import type { CloudField } from './field';
import { shellSegment } from './field';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;
type Int = Node<'int'>;

const asFloat = (x: Float | Int | number): Float => typeof x === 'number' ? float(x) : float(x);
const asInt = (x: Int | number): Int => typeof x === 'number' ? int(x) : x;

/** Henyey–Greenstein lobes of cloud droplets: a strong forward lobe (the silver lining around a backlit
 * cloud) and a weak backward one (the glory side), mixed. Each multiple-scattering octave flattens both. */
const FORWARD = .8, BACKWARD = -.3, BACKWARD_SHARE = .2;
/** Multiple-scattering octaves (Wrenninge et al. 2013): each carries `ENERGY` of the previous one's light,
 * sees `REACH` of its optical depth toward the light and `FLATTEN` of its phase asymmetry. */
const OCTAVES = 4, ENERGY = .75, REACH = .25, FLATTEN = .5;
/** First light-march segment (m); each further one doubles, so five reach 1.2 km toward the light. */
const LIGHT_STEP = 40;
/** How much the sky light filling a cloud (the atmosphere's ambient) is worth against direct light. */
const AMBIENT = .28;
/** A ray this far below the horizon (its upward component) from under the layer meets the sea first. */
export const HORIZON_SKIP = -.002;
/** Rays march at most this far (m); a cloud farther than that is lost in the horizon haze anyway. */
export const MAX_DISTANCE = 160_000;
/** Shortest primary step (m), and the share of a step an empty stretch is crossed in multiples of. */
const MIN_STEP = 32, EMPTY_STRIDE = 2.2;
/** Lightning: its uniform is the irradiance (the sea's units) the channel casts 1 km away, falling off with
 * the square of distance. Light spreads through cloud by multiple scattering rather than straight lines, so
 * it is dimmed by `LIGHTNING_REACH` of the local extinction along the way instead of the full optical depth. */
const LIGHTNING_REACH = .015;

/** Henyey–Greenstein phase for the angle between the view ray and the light (`cosine`). */
export function henyeyGreenstein(cosine: Float, g: Float | number): Float {
  const eccentricity = asFloat(g), gg = eccentricity.mul(eccentricity);
  return gg.oneMinus().div(pow(gg.add(1).sub(eccentricity.mul(cosine).mul(2)).max(1e-4), 1.5).mul(4 * Math.PI));
}
function cloudPhase(cosine: Float, flatten: number): Float {
  return mix(henyeyGreenstein(cosine, FORWARD * flatten), henyeyGreenstein(cosine, BACKWARD * flatten), BACKWARD_SHARE);
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
 * mean distance of what it met (the `far` default where it met nothing). */
export interface MarchResult { radiance: Vec3; transmittance: Float; depth: Float }

/** Light colour (irradiance) at a world point: the sun's or the moon's through the air above it. */
export function cloudLightAt(sky: SkyUniforms, atmosphere: AtmospherePart, light: CloudLight, p: Vec3): Vec3 {
  return mix(atmosphere.sunTransmittance(p).mul(sky.sunIrradiance), atmosphere.moonTransmittance(p).mul(sky.moonIrradiance), light.night);
}
const lightAt = (context: MarchContext, p: Vec3) => cloudLightAt(context.sky, context.atmosphere, context.light, p);

/** Radiance a unit of cloud scatters toward the viewer at `p`, given its optical depth toward the light. */
function scatter(context: MarchContext, lightColour: Vec3, cosine: Float, lightDepth: Float, height: Float, density: Float, ambient: { above: Vec3; below: Vec3 }): Vec3 {
  let direct: Float = float(0);
  for (let i = 0; i < OCTAVES; i++) direct = direct.add(exp(lightDepth.mul(-(REACH ** i))).mul(cloudPhase(cosine, FLATTEN ** i)).mul(ENERGY ** i));
  // Beer–powder (Schneider & Vos 2015): the lit rim of a cloud seen side-on scatters less than its depths,
  // which draws the dark creases between cauliflower lobes. It fades out toward the backlit silver lining.
  const powder = mix(exp(density.mul(-6)).oneMinus().mul(.5).add(.5), float(1), smoothstep(.2, .9, cosine));
  // Sky from above, the sea's bounce from below; bases darken where the whole cloud stands over them.
  const fill = mix(ambient.below, ambient.above, sqrt(height.clamp(0, 1))).mul(context.ambient)
    .mul(mix(context.baseShadow.oneMinus(), float(1), smoothstep(0, .6, height)));
  return lightColour.mul(direct.mul(powder)).add(fill.mul(AMBIENT));
}

/** Optical depth toward the light from `p`, over `steps` doubling segments; cone-spread so shadows soften
 * with distance. The first segment reads the eroded density (it draws the lobes' self-shadowing), the rest
 * the cheaper coarse one. */
function lightDepth(context: MarchContext, p: Vec3, steps: Node<'int'> | number, footprint: Float | undefined): Float {
  const { field, light } = context;
  const at = (i: Float) => {
    const segment = exp2(i).mul(LIGHT_STEP), along = segment.mul(1.5).sub(LIGHT_STEP * .5);
    const spread = vec3(i.mul(2.4).sin(), i.mul(1.7).cos(), i.mul(3.1).sin()).mul(.18);
    const q = p.add(normalize(light.direction.add(spread)).mul(along));
    return { segment, q, sample: field.sample(q, field.altitude(q)) };
  };
  const first = at(float(0));
  const depth = (footprint ? field.erode(first.sample, first.q, footprint) : first.sample.coarse).mul(first.segment).toVar();
  Loop({ start: int(1), end: asInt(steps), type: 'int' }, ({ i }) => {
    const { segment, sample } = at(float(i));
    depth.addAssign(sample.coarse.mul(segment));
  });
  return depth.mul(field.layer.extinction);
}

export interface MarchOptions {
  /** Most steps (a uniform, so a tier change recompiles nothing), and light steps per lit sample. */
  readonly steps: Node<'int'> | number;
  readonly lightSteps: Node<'int'> | number;
  /** Jitter of the first step, 0–1. */
  readonly jitter: Float | number;
  /** Width (radians) of a pixel, for the detail erosion's footprint fade; bakes and shadows go without detail. */
  readonly pixelAngle?: Float;
  /** Add the lightning's light (a uniform-gated branch: nothing when there is no strike). */
  readonly lightning?: boolean;
}

/** March a ray from `origin` (height `altitude` above the sea) along `direction` through the shell.
 * Emission-free, single-albedo medium integrated per step as Hillaire (2016): each step adds its in-scattering
 * weighted by what the step itself absorbs, which keeps coarse steps energy-conserving. */
export function marchClouds(context: MarchContext, origin: Vec3, altitude: Float, direction: Vec3, options: MarchOptions): MarchResult {
  const { field, sky, light } = context, layer = field.layer;
  const radiance = vec3(0).toVar(), transmittance = float(1).toVar(), depth = float(MAX_DISTANCE).toVar();
  const top = layer.base.add(layer.thickness);
  const { start, end } = shellSegment(altitude, direction.y, layer.base, top);
  const from = start.toVar(), to = min(end, MAX_DISTANCE).toVar();
  // From under the layer, a ray below the horizon meets the sea (or the planet) before any cloud.
  const seaward = altitude.lessThan(layer.base).and(direction.y.lessThan(HORIZON_SKIP));
  If(to.greaterThan(from).and(layer.enabled.greaterThan(0)).and(seaward.not()), () => {
    const span = to.sub(from), budget = asFloat(options.steps);
    const step = max(span.div(budget.mul(.75)), MIN_STEP).toVar();
    const cosine = dot(direction, light.direction);
    // The light's colour at both ends of the stretch; between them it varies smoothly enough to interpolate.
    const lightNear = lightAt(context, origin.add(direction.mul(from))), lightFar = lightAt(context, origin.add(direction.mul(to)));
    const ambient = context.atmosphere.ambient(layer.base.add(layer.thickness.mul(.5)));
    const t = from.add(step.mul(asFloat(options.jitter))).toVar();
    const weighted = float(0).toVar(), weight = float(0).toVar();
    Loop({ start: int(0), end: asInt(options.steps), type: 'int' }, () => {
      If(t.greaterThanEqual(to).or(transmittance.lessThan(.01)), () => { Break(); });
      const p = origin.add(direction.mul(t)).toVar();
      const footprint = options.pixelAngle ? t.mul(options.pixelAngle) : undefined;
      const s = field.sample(p, field.altitude(p), footprint);
      const stride = step.mul(EMPTY_STRIDE).toVar();
      If(s.coarse.greaterThan(0), () => {
        stride.assign(step);
        const density = footprint ? field.erode(s, p, footprint) : s.coarse;
        If(density.greaterThan(0), () => {
          const extinction = density.mul(layer.extinction);
          const toward = lightDepth(context, p, options.lightSteps, footprint);
          const colour = mix(lightNear, lightFar, t.sub(from).div(span).clamp(0, 1));
          const source = scatter(context, colour, cosine, toward, s.height, density, ambient).toVar();
          if (options.lightning) {
            If(sky.lightningIntensity.greaterThan(0), () => {
              const offset = sky.lightningPosition.sub(p), distance = sqrt(dot(offset, offset)).max(50);
              const reach = exp(extinction.mul(distance).mul(-LIGHTNING_REACH));
              source.addAssign(vec3(.75, .8, 1).mul(sky.lightningIntensity.mul(1e6).div(distance.mul(distance)).mul(reach).div(4 * Math.PI)));
            });
          }
          const absorbed = exp(extinction.mul(step).negate()).oneMinus();
          const share = transmittance.mul(absorbed);
          radiance.addAssign(source.mul(share));
          weighted.addAssign(t.mul(share)); weight.addAssign(share);
          transmittance.mulAssign(absorbed.oneMinus());
        });
      });
      t.addAssign(stride);
    });
    If(weight.greaterThan(1e-4), () => {
      depth.assign(weighted.div(weight));
      // Aerial perspective once, at the mean depth: the air between dims the cloud and adds its own glow.
      const air = context.atmosphere.aerial(direction, depth);
      radiance.assign(radiance.mul(air.transmittance).add(air.inscatter.mul(transmittance.oneMinus())));
    });
  });
  return { radiance, transmittance, depth };
}

/** The screen march's output for the reconstruction: (radiance, transmittance) and (depth km, 0, 0, 1). */
export function packMarch(result: MarchResult): { color: Vec4; depth: Vec4 } {
  return { color: vec4(result.radiance, result.transmittance), depth: vec4(result.depth.div(1000), 0, 0, 1) };
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
