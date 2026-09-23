import { DepthTexture, DoubleSide, NoBlending, NodeMaterial, type Color, type Node, type Texture } from 'three/webgpu';
import { Fn, If, cameraFar, cameraNear, cameraPosition, cameraViewMatrix, cos, dot, exp, float, frontFacing, max, mix, nodeObject, normalize, perspectiveDepthToViewZ,
  pmremTexture, positionView, positionWorld, reference, reflect, refract, select, sin, smoothstep, texture, uniform, varying, vec2, vec3, vec4, viewportTexture } from 'three/tsl';
import { EffectDepthTextureNode } from '../../EffectVolume';
import { writeSceneTargets } from '../../TemporalAntialiasing';
import type { OceanApi, WakeSampler, WaveField } from '../contracts';
import { screenSpaceReflection } from '../screen/reflections';
import { aeratedReflectance, aeration, billows, bubbleCloud, churnedWater, foamFootprint, foamOpacity, foamOver, foamPatterns, foamRadiance, whitecapFoam, windrowOpacity } from './foam';
import { foamTexture } from './foamTexture';
import type { OceanGeometry } from './OceanGeometry';
import { TRACE_BELOW, footprintVariance, meanFresnel, reflectionLobe, skyLobe, sunGlitter, windVariances } from './physicalReflection';
import { backscatter, columnTransmittance, skyIrradiance, subsurfaceReflectance, upwelling, waterBody } from './waterBody';

/** Reflectance of water at normal incidence. */
const WATER_F0 = .02;
/** Refractive index of sea water. */
const WATER_IOR = 1.333;
/** Pigment kept in full sun shadow: the sea is lit by the sky as well as the sun. */
const SHADOWED_PIGMENT = .45;
/** Slope variance of a glint: the sun disc's (2e-4 for the game's 1.4° disc) widened by facets just finer than a
 * pixel, which tilt within it. */
const GLINT_VARIANCE = 1e-3;
/** Share of the wave slope screen-space reflections follow: about the longest waves' share of it at moderate winds. */
const TRACE_SLOPE = .3;
/** The wake without a slick (the look first tuned to the replaced library): foam energy at which its trail starts to
 * show, where it covers the sea completely, how softly its edge dissolves, and the opacity of its densest water. The
 * realistic wake's churned water is shaded as `foam.ts`'s dense white water. */
const WAKE_START = .05, WAKE_FULL = .6, WAKE_EDGE = .8, WAKE_OPACITY = .75;
/** Water column (m) over which shoreline foam fades out, and its soft edge: a thin line along a hull. */
const SHORE_DEPTH = .8, SHORE_EDGE = .4;
/** Camera depth (m) over which the surface seen from below dims by e. */
const DAYLIGHT_DEPTH = 60;
/** Seen from below, daylight scattered along the underside of the surface relative to the sky's mean radiance
 * overhead: the sun and the whole dome feed it through Snell's window. */
const SIDE_LIGHT = 2.5;
/** Optical depth, in its most transparent channel, over which that daylight takes the colour of what the water
 * absorbs least. Relative to that channel, so the game's submerged easing of the absorption (a uniform scale) keeps
 * the hue. */
const TINT_DEPTH = .5;
/** Vertical components of a mirrored ray over which the sea seen from below turns from the deep's upwelling to the
 * daylight along the surface. */
const DEEP_VIEW = -1, SIDE_VIEW = 0;

/** What the surface reads live; every object is owned by the facade and mutated by the game. */
export interface SurfaceParameters extends Pick<OceanApi, 'colors' | 'foam' | 'sun' | 'reflections' | 'realism'> {
  waves: WaveField;
  geometry: OceanGeometry;
}

/** What the facade can rebind; each change recompiles the surface. */
export interface SurfaceBindings {
  environment: Texture | null;
  wake: WakeSampler;
  shadow: Node<'float'> | null;
}

/** A live colour as a vec3: the uniform holds the Color object itself, so the game's edits reach the GPU. */
const rgb = (color: Color): Node<'vec3'> => uniform(color) as unknown as Node<'vec3'>;

/** Schlick's approximation with a tiny grazing guard: distant slopes seen at a 29 m eye height
 * (cosines of 1e-3 at 20 km) must keep distinct reflectance under binocular magnification. */
export function fresnel(cosine: Node<'float'>): Node<'float'> {
  return float(WATER_F0).add(float(1 - WATER_F0).mul(float(1).sub(cosine.max(1e-4)).pow(5)));
}

/** Upward normal of the displaced sea: the wave slope plus the wake's own slope. */
function surfaceNormal(slope: Node<'vec2'>, wake: Node<'vec3'>): Node<'vec3'> {
  const total = slope.sub(wake.xz.div(wake.y.max(.05)));
  return normalize(vec3(total.x.negate(), 1, total.y.negate()));
}

/** PMREM roughness for an unresolved slope variance σ²: the Beckmann width √(2σ²). Read as a GGX
 * roughness this blurs less than the matching lobe would, which keeps distant water as bright as the
 * horizon sky it mirrors (tuned against captures of the renderer this ocean replaced). */
function roughness(variance: Node<'float'>): Node<'float'> {
  return variance.mul(2).sqrt().clamp(0, 1);
}

/** The mirrored ray the screen-space trace follows: off a normal keeping TRACE_SLOPE of the wave slope. One ray per
 * pixel off the full slope scatters with the short waves into speckle, where a real reflection of a hull is blurred
 * by them into a wavering image of the hull. */
function traceDirection(view: Node<'vec3'>, normal: Node<'vec3'>): Node<'vec3'> {
  return reflect(view.negate(), normalize(vec3(normal.x.mul(TRACE_SLOPE), normal.y, normal.z.mul(TRACE_SLOPE))));
}

/** Sky radiance along the mirrored ray, blurred by the unresolved facets. Rays bent below the
 * horizon by a steep facet see the horizon. */
function skyReflection(environment: Texture | null, direction: Node<'vec3'>, rough: Node<'float'>): Node<'vec3'> {
  if (!environment) return vec3(0);
  return pmremTexture(environment, normalize(vec3(direction.x, direction.y.max(0), direction.z)), rough).rgb;
}

/** Smith masking Λ of a Beckmann surface seen at `cosine` from its mean normal (Walter et al. 2007 fit). */
function smithLambda(cosine: Node<'float'>, variance: Node<'float'>): Node<'float'> {
  const c = cosine.clamp(1e-4, 1);
  const a = c.div(variance.mul(2).sqrt().mul(float(1).sub(c.mul(c)).sqrt().max(1e-4)));
  return select(a.lessThan(1.6), float(1).sub(a.mul(1.259)).add(a.mul(a).mul(.396)).div(a.mul(3.535).add(a.mul(a).mul(2.181))), float(0));
}

/** Sun (or moon) glints on the resolved facets: a Beckmann lobe of GLINT_VARIANCE, with Smith masking so a low
 * sun stays finite. Where the pixel resolves the waves (close up, ripples included) the facets that tilt into the
 * lobe glitter as many small points, as sunlit water does. Facets too small to resolve scatter the disc as well,
 * but the glint keeps only the share of the light they leave in the mirror direction: spread over a smooth sheen
 * the rest would bleach the whole glitter path. */
function sunGlint(normal: Node<'vec3'>, view: Node<'vec3'>, sun: Node<'vec3'>, radiance: Node<'vec3'>, variance: Node<'float'>): Node<'vec3'> {
  const spread = float(GLINT_VARIANCE), resolved = spread.div(variance.add(GLINT_VARIANCE));
  const half = normalize(sun.add(view));
  const cosine = dot(normal, half).max(1e-4), cosine2 = cosine.mul(cosine);
  const lobe = exp(float(1).sub(cosine2).div(cosine2.mul(spread).mul(2)).negate()).div(spread.mul(2 * Math.PI).mul(cosine2.mul(cosine2)));
  const toView = dot(normal, view).max(1e-4), toSun = dot(normal, sun);
  const masking = float(1).div(float(1).add(smithLambda(toView, spread)).add(smithLambda(toSun, spread)));
  const above = smoothstep(0, .02, toSun).mul(smoothstep(-.02, .03, sun.y));
  return radiance.mul(fresnel(dot(view, half)).mul(lobe).mul(masking).mul(above).mul(resolved).div(toView.mul(4)));
}

/** Light scattered through thin crests toward an observer looking into the sun. */
function crestTransmission(view: Node<'vec3'>, sun: Node<'vec3'>, radiance: Node<'vec3'>, tint: Node<'vec3'>, crest: Node<'float'>): Node<'vec3'> {
  const against = dot(normalize(vec3(view.x, 0, view.z)).negate(), normalize(vec3(sun.x, 0, sun.z))).max(0);
  return tint.mul(radiance).mul(against.pow(4).mul(crest).mul(.04));
}

/** Fraction of light surviving `column` metres of water. */
function transmittance(absorption: Node<'vec3'>, column: Node<'float'>): Node<'vec3'> {
  return exp(absorption.mul(column).negate());
}

/** The lit sea seen along `direction` from just below the surface: the pigment looking down into the deep,
 * brightening toward the horizontal into daylight scattered along the surface, tinted by what the water absorbs
 * least. `daylight` is the sky's mean radiance overhead, dark at night like the sky itself. */
function seaFromBelow(pigment: Node<'vec3'>, absorption: Node<'vec3'>, daylight: Node<'vec3'>, direction: Node<'vec3'>): Node<'vec3'> {
  const tint = exp(absorption.div(max(absorption.x, max(absorption.y, absorption.z)).max(1e-6)).mul(-TINT_DEPTH));
  return mix(pigment, daylight.mul(tint).mul(SIDE_LIGHT), smoothstep(DEEP_VIEW, SIDE_VIEW, direction.y));
}

/** The surface seen from a submerged camera: Snell's window shows the sky refracted through it; outside the window
 * it mirrors the lit sea by total internal reflection, so the waves show as their facets tilt the mirrored ray
 * between the dark deep and the bright daylight along the surface. The daylight dims with the water above the
 * camera: the game eases the view-ray absorption under water so hulls stay visible, which would otherwise leave the
 * surface as bright from 50 m as from 5 m. */
function underside(environment: Texture | null, view: Node<'vec3'>, normal: Node<'vec3'>, pigment: Node<'vec3'>, absorption: Node<'vec3'>): Node<'vec3'> {
  const incident = view.negate(), down = normal.negate();
  const refracted = refract(incident, down, WATER_IOR).toVar();
  // The sky's mean radiance overhead is the fully blurred bake.
  const daylight = skyReflection(environment, vec3(0, 1, 0), float(1)).mul(exp(cameraPosition.y.min(0).div(DAYLIGHT_DEPTH)));
  const sea = seaFromBelow(pigment, absorption, daylight, reflect(incident, down)).toVar();
  const window = mix(skyReflection(environment, refracted, float(0)), sea, fresnel(dot(refracted, normal).max(0)));
  return select(dot(refracted, refracted).greaterThan(1e-6), window, sea);
}

/** The ocean surface, drawn first in the scene pass's transparent queue so three's viewport copies
 * hold the opaque scene: straight-through transmission, shoreline foam and screen-space reflections
 * all read the same two copies. Colours and foam are emitted radiance that the game pre-scales for
 * night; the sky reflection is never shadowed. */
export class OceanSurfaceMaterial extends NodeMaterial {
  private readonly sceneColor = viewportTexture();
  private readonly sceneDepth = nodeObject(new EffectDepthTextureNode(undefined, null, new DepthTexture(1, 1)));
  private readonly foamDetail = foamTexture();
  private readonly screenReflections = uniform(false);
  /** Whether the camera is under water: only then is every back face the sea's underside. */
  private readonly cameraSubmerged = uniform(false);
  /** The bindings and realism switches the graph was last built with: flipping a switch rebuilds it. */
  private bindings!: SurfaceBindings;
  private built = { reflections: false, waterColor: false };

  constructor(private readonly parameters: SurfaceParameters, bindings: SurfaceBindings) {
    super();
    this.name = 'Ocean surface';
    this.transparent = true;
    this.blending = NoBlending;
    this.depthWrite = true;
    this.side = DoubleSide;
    this.forceSinglePass = true;
    // Temporal AA takes no history on the sea: its waves move through the world, so reprojecting
    // them as static would smear their detail. Extra scene targets get no colour from it.
    this.userData.temporalResponse = 1;
    writeSceneTargets(this);
    this.bind(bindings);
  }

  /** Mirror the facade's live switches into uniforms; call once per frame. */
  update(cameraSubmerged: boolean): void {
    this.screenReflections.value = this.parameters.reflections.screenSpace && this.parameters.reflections.steps > 0;
    this.cameraSubmerged.value = cameraSubmerged;
    const { reflections, waterColor } = this.parameters.realism;
    if (reflections !== this.built.reflections || waterColor !== this.built.waterColor) this.bind(this.bindings);
  }

  /** Rebuild the surface graph around new sky, wake or shadow bindings. */
  bind(bindings: SurfaceBindings): void {
    const { environment, wake, shadow } = this.bindings = bindings;
    const { waves, geometry, colors, foam, sun, reflections, realism } = this.parameters;
    const physical = this.built = { reflections: realism.reflections, waterColor: realism.waterColor };
    const grid = geometry.grid, offset = waves.displacement(grid, geometry.spacing);
    this.positionNode = vec3(grid.x.add(offset.x), offset.y.add(wake.height(grid.x, grid.y)), grid.y.add(offset.z));

    const xz = varying(grid, 'oceanGrid');
    // A wake's slick stills the short waves: their slopes and the roughness they leave unresolved. The sea coupled to
    // hulls is read where the point is drawn.
    const sample = waves.surface(xz, wake.slick?.(xz.x, xz.y), positionWorld.xz);
    const toCamera = cameraPosition.sub(positionWorld), distance = toCamera.length(), view = toCamera.div(distance);
    const wakeNormal = wake.normal(xz.x, xz.y);
    const up = surfaceNormal(sample.slope, wakeNormal);
    const sunIntensity = reference('intensity', 'float', sun);
    const sunDirection = uniform(sun.direction), sunRadiance = rgb(sun.color).mul(sunIntensity);
    // Ship shadows on the sea fade with the celestial light that casts them: faint under the moon.
    const lit = shadow ? mix(1, shadow, sunIntensity.div(2).clamp(0, 1)) : float(1);
    const pigment = rgb(colors.waterColor), absorption = rgb(colors.absorptionColor);

    // The opaque scene behind this pixel, and how much water lies between it and the surface.
    const sceneViewZ = perspectiveDepthToViewZ(this.sceneDepth.r, cameraNear, cameraFar);
    const rayViewZ = cameraViewMatrix.mul(vec4(view.negate(), 0)).z;
    const column = sceneViewZ.div(rayViewZ.min(-1e-4)).sub(distance).max(0);
    let body: Node<'vec3'>;
    if (physical.waterColor) {
      // Light scattered back out of the water, lit by the sun and sky that cross the surface (see waterBody.ts).
      const scatter = backscatter();
      const deep = upwelling(subsurfaceReflectance(absorption, scatter), sunDirection, sunRadiance, skyIrradiance(environment), lit);
      body = waterBody(this.sceneColor.rgb, deep, columnTransmittance(absorption, scatter, column, view));
    } else {
      const through = transmittance(absorption, column);
      body = this.sceneColor.rgb.mul(through).add(pigment.mul(mix(SHADOWED_PIGMENT, 1, lit)).mul(float(1).sub(through)));
    }

    // Above: Fresnel between the reflected sky (or ships, where the screen trace finds them) and the water body.
    // Physical reflections mirror the facets the viewer sees through their spread (see physicalReflection.ts).
    const heading = reference('windDirection', 'float', waves.params), downwind = vec2(cos(heading), sin(heading));
    const variances = physical.reflections ? windVariances(sample.unresolvedVariance.add(footprintVariance(up)), reference('windSpeed', 'float', waves.params)) : undefined;
    const lobe = variances ? reflectionLobe(view, up, variances, downwind) : undefined;
    const reflectance = lobe ? meanFresnel(dot(up, view), lobe.sigmaView) : fresnel(dot(up, view));
    const sky = lobe ? skyLobe(environment, lobe) : skyReflection(environment, reflect(view.negate(), up), roughness(sample.slopeVariance));
    // Ships and islands the mirrored ray meets on screen replace the sky (High and Ultra only).
    const toView = (direction: Node<'vec3'>) => cameraViewMatrix.mul(vec4(direction, 0)).xyz;
    const traced = reflections.steps > 0 ? screenSpaceReflection({ position: positionView, direction: toView(lobe ? lobe.traced : traceDirection(view, up)),
      sceneColor: this.sceneColor, sceneDepth: this.sceneDepth, enabled: this.screenReflections,
      maxDistance: reference('maxDistance', 'float', reflections), steps: reflections.steps,
      blur: lobe ? { up: toView(lobe.up), spread: lobe.inPlane, centre: TRACE_BELOW } : undefined }) : undefined;
    const reflected = traced ? mix(sky, traced.color, traced.confidence) : sky;
    // How far up a wave this point sits: crests reach about Hs / 2, rare ones Hs.
    const crest = positionWorld.y.div(reference('significantHeight', 'float', waves.params).max(.1)).clamp(0, 1);
    const glint = variances ? sunGlitter(up, view, sunDirection, sunRadiance, variances, downwind)
      : sunGlint(up, view, sunDirection, sunRadiance, sample.slopeVariance);
    const direct = glint.add(crestTransmission(view, sunDirection, sunRadiance, rgb(colors.transmissionColor), crest));
    // Foam: the texture laid in the wind's frame and drawn out along it by the crest foam's wind stretch.
    const stretch = reference('windStretch', 'float', foam.crest).mul(2).add(1);
    const { pattern, blur, streaks, streaksBlur, lines, gather, churnSunward } = foamPatterns(this.foamDetail, xz, reference('windDirection', 'float', waves.params),
      stretch, sunDirection);
    const lace = pattern.r;
    const whitecaps = whitecapFoam(sample.foam, sample.foamMean, sample.whitecapShare, pattern, blur, streaks, streaksBlur, foamFootprint(xz));
    // The realistic wake's churned water is the whitecaps' dense white water; without a slick the trail keeps the
    // replaced library's soft, puffy foam.
    const churned = wake.slick !== undefined ? churnedWater(wake.foam(xz.x, xz.y), pattern, blur) : undefined;
    const wakeFoam = churned?.opacity ?? foamOpacity(smoothstep(WAKE_START, WAKE_FULL, wake.foam(xz.x, xz.y)), lace, blur, WAKE_EDGE).mul(WAKE_OPACITY);
    // Foam is lit like any diffuse white surface, by the sky about its normal and the sun; the bubble clouds under
    // breaking crests and churned water scatter the same daylight back up through the water. A pixel gone to the
    // whitecaps' mean has their brightness in it already.
    const foamLight = foamRadiance(skyReflection(environment, up, float(1)), sunRadiance, up, sunDirection, lit);
    const aerated = aeration(sample.bubbles, wake.bubbles?.(xz.x, xz.y)).mul(float(1).sub(whitecaps.far));
    const water = mix(bubbleCloud(body, aerated, foamLight, absorption), reflected, aeratedReflectance(reflectance, aerated));
    let above: Node<'vec3'> = water.add(direct.mul(lit));

    // From the widest and faintest to the brightest: windrows, whitecaps and churned water, shorelines.
    const windrows = windrowOpacity(reference('coverage', 'float', foam.surface), lines, this.foamDetail.userData.streakMean, gather, streaks, streaksBlur,
      sample.jacobian).mul(reference('opacity', 'float', foam.surface));
    const white = billows(pattern.a, churnSunward, max(whitecaps.dense, churned?.dense ?? float(0)), blur);
    // Where the water column behind the surface thins to nothing: a beach, or the line along a hull.
    const shoreFoam = foamOpacity(float(1).sub(smoothstep(0, SHORE_DEPTH, column)), lace, blur, SHORE_EDGE).mul(reference('opacity', 'float', foam.shoreline));
    above = foamOver(above, water, foamLight.mul(rgb(foam.surface.color)), reflected, reflectance, windrows);
    above = foamOver(above, water, foamLight.mul(rgb(foam.crest.color)).mul(white), reflected, reflectance,
      max(whitecaps.opacity.mul(reference('opacity', 'float', foam.crest)), wakeFoam));
    above = foamOver(above, water, foamLight.mul(rgb(foam.shoreline.color)), reflected, reflectance, shoreFoam);

    this.fragmentNode = Fn(() => {
      // Everything above is evaluated first, in uniform control flow: it takes screen-space derivatives. Only back
      // faces seen from under water pay for the underside. A camera above water sees back faces only where a storm
      // crest folds over, and those keep the crest's shading and foam; a back face above the camera still counts,
      // for the frame the camera probe lags and for a near plane that dips under the surface.
      const color = above.toVar();
      If(frontFacing.not().and(this.cameraSubmerged.or(positionWorld.y.greaterThan(cameraPosition.y))), () => {
        color.assign(underside(environment, view, up, pigment, absorption));
      });
      return vec4(color, 1);
    })();
    this.needsUpdate = true;
  }

  override dispose(): void {
    this.foamDetail.dispose();
    this.sceneDepth.value.dispose();
    this.sceneColor.value.dispose();
    super.dispose();
  }
}
