/** Physical reflection off a sea whose finest waves the pixel resolves only as statistics (`OceanRealism.reflections`).
 *
 * The pixel's normal is the mean of the waves it resolves; every finer facet is a Gaussian slope distribution around
 * it (Cox & Munk 1954): the wave field's unresolved variance with all of Cox–Munk's tail, the slopes the pixel's own
 * footprint spans, split along and across the wind in Cox–Munk's proportions. From that distribution, after Bruneton,
 * Neyret & Holzschuch, "Real-time Realistic Ocean Lighting using Seamless Transitions from Geometry to BRDF" (2010):
 * the sky is mirrored through the facets the viewer actually sees (tilted toward a grazing viewer) and blurred by
 * their spread, with the Fresnel reflectance averaged over them; the sun is reflected by the same distribution as a
 * glitter BRDF with Smith masking; and screen-space rays follow the whole resolved slope, their image smeared along
 * the plane of incidence by the same spread. */
import type { Node, Texture } from 'three/webgpu';
import { Fn, Loop, cos, cross, dFdx, dFdy, dot, exp, float, int, max, min, mix, normalize, pmremTexture, reflect, select, sin, smoothstep, vec2, vec3 } from 'three/tsl';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** Reflectance of water at normal incidence. */
const WATER_F0 = .02;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
/** Cox & Munk (1954), clean sea surface: mean square slope along the wind 3.16e-3·U and across it 0.003 + 1.92e-3·U. */
const COX_MUNK_ALONG = 3.16e-3, COX_MUNK_ACROSS = 1.92e-3, COX_MUNK_ACROSS_CALM = 3e-3;
/** Share of the squared change of slope between neighbouring pixels that counts as slope variance inside a pixel
 * (a footprint of about half a pixel's standard deviation, as Kaplanyan et al. 2016 filter specular highlights). */
const FOOTPRINT = .25;
/** No pixel's footprint spans more slope variance than the roughest sea's whole surface does; silhouettes of folded
 * crests, whose normals jump between neighbouring pixels, stop there. */
const FOOTPRINT_LIMIT = .1;
/** Per-axis slope variance of the facets that mirror some part of the sun's disc: the game draws it 1.4° across
 * (radius R = 0.0122 rad); a facet tilts half as far as the ray it turns, and a uniform disc has variance R²/4 per axis. */
const SUN_DISC_VARIANCE = (.01225 / 2) ** 2 / 4;
/** Angular standard deviation (radians) of three's PMREM blur at lookup roughness 0.1, 0.15, 0.2, 0.3 … 1, measured
 * by filtering a thin line through the game's 384 px sky bake (the 512 and 768 px bakes blur within 15% of it above
 * 0.15). Three builds its PMREM from a chain of GGX importance-sampled passes, so its roughness does not name a lobe;
 * below 0.1 the lookup reads the sharpest level. */
const PMREM_BLUR: readonly (readonly [angle: number, roughness: number])[] = [
  [.0185, .1], [.0412, .15], [.0827, .2], [.1175, .3], [.1775, .4], [.2583, .5], [.356, .6], [.466, .7], [.579, .8], [.7208, 1],
];
/** Each of the three sky taps keeps at least this share of the lobe's long axis as its own blur, so that taps about
 * 1.2 long-axis deviations apart merge into one smear instead of three images. */
const TAP_BLUR = .5;
/** Below this spread of the taps (relative to their blur) one tap already has the lobe's shape. */
const TAP_SPREAD = .3;
/** In-plane deviations below the lobe's centre at which the screen-space ray is traced. Hulls stand above the water
 * that mirrors them, so the lobe's lower part meets a hull that its centre, turned up by the visible facets, would pass
 * over; the image is then read over the whole lobe around its centre (`ReflectionLobe.traced`). */
export const TRACE_BELOW = 1;

/** Schlick's approximation with the surface's tiny grazing guard. */
export function schlick(cosine: Float): Float {
  return float(WATER_F0).add(float(1 - WATER_F0).mul(float(1).sub(cosine.clamp(1e-4, 1)).pow(5)));
}

/** The share of the sea's slope variance that lies along the wind, from Cox & Munk's (1954) two measured components.
 * The unresolved facets are mostly waves far above the spectral peak, whose broad spreading leaves them about as
 * anisotropic as the measured total. */
export function alongWindShare(windSpeed: Float): Float {
  const u = windSpeed.max(0), along = u.mul(COX_MUNK_ALONG), across = u.mul(COX_MUNK_ACROSS).add(COX_MUNK_ACROSS_CALM);
  return along.div(along.add(across));
}

/** Slope variance the pixel spans that the wave field's filtering cannot see: its mip-filtered normal is one sample per
 * pixel, so the slope's change across the footprint (from screen-space derivatives) is the variance the pixel averages.
 * Counting it as sub-pixel roughness spreads a glint or a mirrored edge narrower than a pixel over the pixel, as its own
 * area would, instead of letting it flicker (Kaplanyan, Hill, Patney & Lefohn 2016). Needs uniform control flow. */
export function footprintVariance(normal: Vec3): Float {
  const slope = normal.xz.div(normal.y.max(.05));
  const across = dFdx(slope), down = dFdy(slope);
  return min(dot(across, across).add(dot(down, down)).mul(FOOTPRINT), FOOTPRINT_LIMIT);
}

/** Per-axis unresolved slope variances (along, across the wind) from their total over both axes. */
export function windVariances(total: Float, windSpeed: Float): Vec2 {
  const along = alongWindShare(windSpeed);
  return vec2(total.mul(along), total.mul(float(1).sub(along)));
}

/** Slope variance along a horizontal `azimuth` (unit xz) for variances along and across a unit `wind`. */
export function azimuthVariance(variances: Vec2, wind: Vec2, azimuth: Vec2): Float {
  const along = dot(azimuth, wind);
  return mix(variances.y, variances.x, along.mul(along));
}

/** φ(t)/Φ(t) of the standard normal at any t (the inverse Mills ratio), with Φ's tail from the erfc approximation
 * 2e^{−x²}/(2.319x + √(4 + 1.52x²)) of Bruneton et al. (2010), written as a ratio so neither side underflows. */
function inverseMills(t: Float): Float {
  const bound = t.abs().mul(2.319 / Math.SQRT2).add(t.mul(t).mul(1.52 / 2).add(4).sqrt());
  const density = exp(t.mul(t).mul(-.5));
  return select(t.greaterThanEqual(0), density.mul(INV_SQRT_2PI).div(float(1).sub(density.div(bound))), bound.mul(INV_SQRT_2PI));
}

/** What a viewer sees of a Gaussian slope distribution (per-axis variance σ² along the view's azimuth) around a mean
 * surface seen at cot θ. Each facet counts by its projected area, (s + cot θ)⁺ for a slope s toward the viewer, which
 * favours facets turned toward them (Smith 1967; the visible normals of Heitz 2014): with t = cot θ/σ they tilt toward
 * the viewer by σ/(t + φ(t)/Φ(t)), 1.25 σ at grazing, and spread by σ²(1 + K − (K/g)²), K = g/(g + t), 0.43 σ² at
 * grazing. A mean surface facing away is seen through the facets that still face the viewer. */
export function visibleSlopes(cotangent: Float, variance: Float): { mean: Float; variance: Float } {
  const sigma = variance.max(1e-8).sqrt();
  // Beyond two deviations behind the viewer only the facets just turned toward them show: the floor below.
  const t = cotangent.div(sigma).max(-2);
  const mills = inverseMills(t), total = mills.add(t).max(1e-3);
  const mean = max(sigma.div(total), cotangent.negate().add(sigma.mul(.05)));
  const spread = variance.mul(float(1).add(mills.div(total)).sub(float(1).div(total.mul(total))));
  return { mean, variance: min(spread.max(0), variance) };
}

/** Smith's Λ for a Gaussian (Beckmann) slope distribution of per-axis variance σ² along the direction's azimuth, seen
 * at `cosine` from the mean surface: φ(t)/t − Φ(−t), t = cot θ/σ, with the same erfc approximation. */
export function beckmannLambda(cosine: Float, variance: Float): Float {
  const c = cosine.clamp(1e-4, 1);
  const t = c.div(float(1).sub(c.mul(c)).max(1e-8).sqrt().mul(variance.max(1e-8).sqrt())).max(1e-3);
  const bound = t.mul(2.319 / Math.SQRT2).add(t.mul(t).mul(1.52 / 2).add(4).sqrt());
  return exp(t.mul(t).mul(-.5)).mul(float(INV_SQRT_2PI).sub(t.div(bound))).div(t).max(0);
}

/** Fresnel reflectance averaged over the facets a viewer sees on a sea of RMS slope σ along the view's azimuth
 * (Bruneton, Neyret & Holzschuch 2010, a fit to the exact average): the visible facets turn toward a grazing viewer, so
 * rough water mirrors far less than all of the sky at the horizon and shows its body there. At σ = 0 it is Schlick's. */
export function meanFresnel(cosine: Float, sigma: Float): Float {
  const grazing = float(1).sub(cosine.clamp(1e-4, 1)).pow(exp(sigma.mul(-2.69)).mul(5));
  return float(WATER_F0).add(float(1 - WATER_F0).mul(grazing).div(sigma.pow(1.5).mul(22.7).add(1)));
}

/** The PMREM lookup roughness whose blur has angular standard deviation `angle` (radians), from PMREM_BLUR. */
export function pmremRoughness(angle: Float): Float {
  let roughness: Float = float(PMREM_BLUR[0][1]);
  for (let i = 1; i < PMREM_BLUR.length; i++) {
    const [from, low] = PMREM_BLUR[i - 1], [to, high] = PMREM_BLUR[i];
    roughness = roughness.add(angle.sub(from).div(to - from).clamp(0, 1).mul(high - low));
  }
  return roughness;
}

/** The mirrored lobe of the unresolved facets around the resolved `normal`. */
export interface ReflectionLobe {
  /** The visible facets' mean normal: the resolved normal tilted toward the viewer. */
  readonly facet: Vec3;
  /** The mirrored ray off `facet`. */
  readonly direction: Vec3;
  /** Unit vector perpendicular to `direction` in the plane of incidence, away from the surface. */
  readonly up: Vec3;
  /** Angular standard deviation (radians) of the mirrored rays in the plane of incidence, and across it. */
  readonly inPlane: Float;
  readonly across: Float;
  /** RMS unresolved slope along the view's azimuth, for the mean Fresnel. */
  readonly sigmaView: Float;
  /** The ray the screen-space trace follows: TRACE_BELOW in-plane deviations below `direction`. */
  readonly traced: Vec3;
}

/** Schlick's reflectance falls with the cosine of incidence c at the rate k = −d ln F/dc = 5(1 − F0)(1 − c)⁴/F(c): about
 * 5 toward grazing, where it is nearly e^{−5c}, and none once it settles at F0 looking down. */
function fresnelFalloff(cosine: Float): Float {
  const c = cosine.clamp(0, 1);
  return float(1).sub(c).pow(4).mul(5 * (1 - WATER_F0)).div(schlick(c));
}

/** The lobe of rays the unresolved facets mirror toward the viewer. A facet shows by its projected area and mirrors by
 * its Fresnel reflectance, which is high for facets seen edge-on and falls fast as they turn toward the viewer. Taking
 * F ≈ e^{−k c} with c ≈ cot θ + s near the view's cosine, it multiplies the Gaussian by an exponential, which only
 * moves its mean by −kσ²: the light the viewer receives comes from the visible facets of a distribution shifted
 * toward edge-on, with the same spread (within 2° of the exact average up to σ = 0.18). So a rough sea seen at a grazing
 * angle mirrors sky well above the horizon, though lower than its visible facets' mean (the far sea is darker than the
 * sky over it). The rays spread by twice the facets' spread in the plane of incidence but across it only by twice the
 * cross slope times the cosine of incidence, so a grazing view smears reflections toward the viewer and keeps them sharp
 * sideways. `variances` are per axis, along and across the unit `wind` (xz). */
export function reflectionLobe(view: Vec3, normal: Vec3, variances: Vec2, wind: Vec2): ReflectionLobe {
  const cosine = dot(normal, view);
  const tangent = view.sub(normal.mul(cosine)), sine = tangent.length().max(1e-5);
  const toward = tangent.div(sine);
  const azimuth = normalize(vec2(toward.x, toward.z).add(vec2(1e-6, 0)));
  const inPlaneVariance = azimuthVariance(variances, wind, azimuth);
  const acrossVariance = variances.x.add(variances.y).sub(inPlaneVariance).max(0);
  const shift = fresnelFalloff(cosine).mul(inPlaneVariance);
  const visible = visibleSlopes(cosine.div(sine).sub(shift), inPlaneVariance);
  const facet = normalize(normal.add(toward.mul(visible.mean.sub(shift))));
  const direction = reflect(view.negate(), facet);
  const up = normalize(facet.sub(direction.mul(dot(facet, direction))).add(vec3(0, 1e-6, 0)));
  // A slope s turns a facet by atan s, and the mirrored ray by twice that.
  const mean = visible.mean.sub(shift), turn = float(2).div(mean.mul(mean).add(1));
  const inPlane = visible.variance.sqrt().mul(turn), below = inPlane.mul(TRACE_BELOW);
  return { facet, direction, up, inPlane, across: acrossVariance.sqrt().mul(dot(facet, view).max(0).mul(2)), sigmaView: inPlaneVariance.sqrt(),
    traced: direction.mul(cos(below)).sub(up.mul(sin(below))) };
}

/** Sky radiance over the reflected lobe. The PMREM blurs isotropically, so an elongated lobe takes three taps along
 * the plane of incidence (weights ½ and ¼ at 0 and ±step, adding step²/2 to each tap's own variance to make the long
 * axis), each blurred by the short axis but at least TAP_BLUR of the long one; a round lobe takes one tap. Rays turned
 * below the horizon meet other waves, which at such angles mirror the horizon: they read the horizon (the sky bake
 * holds the horizon's colour below it, so the blurred lookups agree). One PMREM node in a loop: one texture binding. */
export function skyLobe(environment: Texture | null, lobe: ReflectionLobe): Vec3 {
  if (!environment) return vec3(0);
  return Fn(() => {
    const blur = max(lobe.across, lobe.inPlane.mul(TAP_BLUR));
    const step = lobe.inPlane.mul(lobe.inPlane).sub(blur.mul(blur)).mul(2).max(0).sqrt();
    const elongated = step.greaterThan(blur.mul(TAP_SPREAD));
    const roughness = pmremRoughness(select(elongated, blur, max(lobe.inPlane, lobe.across))).toVar();
    const taps = select(elongated, int(3), int(1)).toVar(), sky = vec3(0).toVar();
    Loop({ start: int(0), end: taps, type: 'int', condition: '<' }, ({ i }) => {
      const turn = float(i).sub(float(taps.sub(1)).mul(.5)).mul(step);
      const ray = lobe.direction.mul(cos(turn)).add(lobe.up.mul(sin(turn)));
      const weight = select(elongated, select(i.equal(1), float(.5), float(.25)), float(1));
      sky.addAssign(pmremTexture(environment, normalize(vec3(ray.x, ray.y.max(0), ray.z)), roughness).rgb.mul(weight));
    });
    return sky;
  })();
}

/** The sun's (or moon's) reflection by every facet, resolved or not: Cox–Munk's anisotropic Gaussian slope distribution
 * of the unresolved facets (plus the sun disc's own spread) around the resolved normal, with Smith masking and shadowing
 * (Bruneton et al. 2010, after Ross, Dion & Potvin 2005). Close up the resolved facets carry the slopes and the lobe is
 * as narrow as the disc, so single facets sparkle; farther off a pixel holds more facets and the lobe widens into the
 * glitter path, broader with the wind and toward the horizon, as in photographs of sunlit seas. `irradiance` is the
 * sun's on a surface facing it; `variances` per axis along and across the unit `wind`. */
export function sunGlitter(normal: Vec3, view: Vec3, sun: Vec3, irradiance: Vec3, variances: Vec2, wind: Vec2): Vec3 {
  const half = normalize(sun.add(view));
  const flatWind = vec3(wind.x, 0, wind.y);
  const along = normalize(flatWind.sub(normal.mul(dot(normal, flatWind)))), across = cross(normal, along);
  const cosine = dot(normal, half).max(1e-3);
  const slopeAlong = dot(half, along).div(cosine), slopeAcross = dot(half, across).div(cosine);
  const alongVariance = variances.x.add(SUN_DISC_VARIANCE), acrossVariance = variances.y.add(SUN_DISC_VARIANCE);
  const density = exp(slopeAlong.mul(slopeAlong).div(alongVariance).add(slopeAcross.mul(slopeAcross).div(acrossVariance)).mul(-.5))
    .div(alongVariance.mul(acrossVariance).sqrt().mul(2 * Math.PI));
  const toView = dot(normal, view), toSun = dot(normal, sun);
  const spread = vec2(alongVariance, acrossVariance);
  const heading = (direction: Vec3) => normalize(vec2(direction.x, direction.z).add(vec2(1e-6, 0)));
  const masking = float(1).div(float(1).add(beckmannLambda(toView, azimuthVariance(spread, wind, heading(view))))
    .add(beckmannLambda(toSun, azimuthVariance(spread, wind, heading(sun)))));
  const above = smoothstep(0, .02, toSun).mul(smoothstep(-.02, .03, sun.y));
  const cosine2 = cosine.mul(cosine);
  return irradiance.mul(schlick(dot(view, half)).mul(density).mul(masking).mul(above).div(toView.max(.01).mul(cosine2.mul(cosine2)).mul(4)));
}
