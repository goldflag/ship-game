import { DepthTexture, DoubleSide, NoBlending, NodeMaterial, type Color, type Node, type Texture } from 'three/webgpu';
import { cameraFar, cameraNear, cameraPosition, cameraViewMatrix, dot, exp, float, frontFacing, max, mix, nodeObject, normalize, perspectiveDepthToViewZ,
  pmremTexture, positionWorld, reference, reflect, refract, select, smoothstep, texture, uniform, varying, vec2, vec3, vec4, viewportTexture } from 'three/tsl';
import { EffectDepthTextureNode } from '../../EffectVolume';
import type { OceanApi, WakeSampler, WaveField } from '../contracts';
import { screenSpaceReflection } from '../stubs/screen';
import { foamTexture } from './foamTexture';
import type { OceanGeometry } from './OceanGeometry';

/** Reflectance of water at normal incidence. */
const WATER_F0 = .02;
/** Refractive index of sea water. */
const WATER_IOR = 1.333;
/** Pigment kept in full sun shadow: the sea is lit by the sky as well as the sun. */
const SHADOWED_PIGMENT = .45;
/** Foam kept in full sun shadow. */
const SHADOWED_FOAM = .6;
/** Slope variance the sun disc adds to its highlight. */
const SUN_VARIANCE = 2e-4;
/** Water column (m) over which shoreline foam fades out. */
const SHORE_DEPTH = 3.5;

/** What the surface reads live; every object is owned by the facade and mutated by the game. */
export interface SurfaceParameters extends Pick<OceanApi, 'colors' | 'foam' | 'sun' | 'reflections'> {
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

/** PMREM roughness for a Beckmann slope variance σ² (GGX α ≈ √2 σ, α = roughness²). */
function roughness(variance: Node<'float'>): Node<'float'> {
  return variance.mul(2).sqrt().sqrt().clamp(0, 1);
}

/** Sky radiance along the mirrored ray. Rays bent below the horizon by a steep facet see the horizon. */
function skyReflection(environment: Texture | null, direction: Node<'vec3'>, variance: Node<'float'>): Node<'vec3'> {
  if (!environment) return vec3(0);
  const upward = normalize(vec3(direction.x, direction.y.max(0), direction.z));
  return pmremTexture(environment, upward, roughness(variance)).rgb;
}

/** Sun (or moon) highlight: a Beckmann lobe widened by the unresolved slope variance. */
function sunGlint(normal: Node<'vec3'>, view: Node<'vec3'>, sun: Node<'vec3'>, radiance: Node<'vec3'>, variance: Node<'float'>): Node<'vec3'> {
  const half = normalize(sun.add(view));
  const cosine = dot(normal, half).max(1e-4), cosine2 = cosine.mul(cosine);
  const spread = variance.add(SUN_VARIANCE);
  const lobe = exp(float(1).sub(cosine2).div(cosine2.mul(spread).mul(2)).negate()).div(spread.mul(2 * Math.PI).mul(cosine2.mul(cosine2)));
  const facing = smoothstep(0, .02, dot(normal, sun)).mul(smoothstep(-.02, .03, sun.y));
  return radiance.mul(fresnel(dot(view, half)).mul(lobe).mul(facing).div(dot(normal, view).max(.08).mul(4)));
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

/** Share of a pixel covered by foam of strength `amount`, broken up by a bubble texture value. */
function dissolve(amount: Node<'float'>, detail: Node<'float'>): Node<'float'> {
  const coverage = amount.clamp(0, 1);
  return smoothstep(float(1).sub(coverage), float(1.3).sub(coverage), detail);
}

/** The ocean surface, drawn first in the scene pass's transparent queue so three's viewport copies
 * hold the opaque scene: straight-through transmission, shoreline foam and screen-space reflections
 * all read the same two copies. Colours and foam are emitted radiance that the game pre-scales for
 * night; the sky reflection is never shadowed. */
export class OceanSurfaceMaterial extends NodeMaterial {
  private readonly sceneColor = viewportTexture();
  private readonly sceneDepth = nodeObject(new EffectDepthTextureNode(undefined, null, new DepthTexture(1, 1)));
  private readonly foamDetail = foamTexture();
  private readonly screenReflections = uniform(0);

  constructor(private readonly parameters: SurfaceParameters, bindings: SurfaceBindings) {
    super();
    this.name = 'Ocean surface';
    this.transparent = true;
    this.blending = NoBlending;
    this.depthWrite = true;
    this.side = DoubleSide;
    this.forceSinglePass = true;
    this.bind(bindings);
  }

  /** Mirror the facade's live switches into uniforms; call once per frame. */
  update(): void { this.screenReflections.value = this.parameters.reflections.screenSpace && this.parameters.reflections.steps > 0 ? 1 : 0; }

  /** Rebuild the surface graph around new sky, wake or shadow bindings. */
  bind({ environment, wake, shadow }: SurfaceBindings): void {
    const { waves, geometry, colors, foam, sun, reflections } = this.parameters;
    const grid = geometry.grid, offset = waves.displacement(grid, geometry.spacing);
    this.positionNode = vec3(grid.x.add(offset.x), offset.y.add(wake.height(grid.x, grid.y)), grid.y.add(offset.z));

    const xz = varying(grid, 'oceanGrid');
    const sample = waves.surface(xz);
    const toCamera = cameraPosition.sub(positionWorld), distance = toCamera.length(), view = toCamera.div(distance);
    const wakeNormal = wake.normal(xz.x, xz.y);
    const up = surfaceNormal(sample.slope, wakeNormal);
    const lit = shadow ?? float(1);
    const sunDirection = uniform(sun.direction), sunRadiance = rgb(sun.color).mul(reference('intensity', 'float', sun));
    const pigment = rgb(colors.waterColor), absorption = rgb(colors.absorptionColor);

    // The opaque scene behind this pixel, and how much water lies between it and the surface.
    const sceneViewZ = perspectiveDepthToViewZ(this.sceneDepth.r, cameraNear, cameraFar);
    const rayViewZ = cameraViewMatrix.mul(vec4(view.negate(), 0)).z;
    const column = sceneViewZ.div(rayViewZ.min(-1e-4)).sub(distance).max(0);
    const through = transmittance(absorption, column);
    const body = this.sceneColor.rgb.mul(through).add(pigment.mul(mix(SHADOWED_PIGMENT, 1, lit)).mul(float(1).sub(through)));

    // Above: Fresnel between the reflected sky (or ships, where the screen trace finds them) and the water body.
    const cosine = dot(up, view).max(1e-4), reflectance = fresnel(cosine);
    const mirrored = reflect(view.negate(), up);
    const traced = screenSpaceReflection({ position: positionWorld, direction: mirrored,
      sceneColor: uv => this.sceneColor.sample(uv).rgb, sceneDepth: uv => this.sceneDepth.sample(uv).r,
      steps: reflections.steps, maxDistance: reference('maxDistance', 'float', reflections), enabled: this.screenReflections });
    const reflected = mix(skyReflection(environment, mirrored, sample.slopeVariance), traced.color, traced.confidence);
    const crest = positionWorld.y.div(max(waves.maxHeight, .1)).clamp(0, 1);
    const direct = sunGlint(up, view, sunDirection, sunRadiance, sample.slopeVariance)
      .add(crestTransmission(view, sunDirection, sunRadiance, rgb(colors.transmissionColor), crest));
    let above: Node<'vec3'> = mix(body, reflected, reflectance).add(direct.mul(lit));

    // Foam, from the widest and faintest to the brightest: surface pattern, crests, wakes, shorelines.
    const bubbles = texture(this.foamDetail, xz.div(9)).r, patches = texture(this.foamDetail, xz.div(71)).g;
    const foamLight = mix(SHADOWED_FOAM, 1, lit);
    const surfaceFoam = smoothstep(float(1).sub(reference('coverage', 'float', foam.surface)), 1, patches).mul(bubbles).mul(reference('opacity', 'float', foam.surface));
    const crestFoam = dissolve(sample.foam, bubbles).mul(reference('opacity', 'float', foam.crest));
    const wakeFoam = dissolve(wake.foam(xz.x, xz.y), bubbles);
    const shoreFoam = dissolve(float(1).sub(smoothstep(0, SHORE_DEPTH, column)), bubbles).mul(reference('opacity', 'float', foam.shoreline));
    const crestColor = rgb(foam.crest.color).mul(foamLight);
    above = mix(above, rgb(foam.surface.color).mul(foamLight), surfaceFoam.clamp(0, 1));
    above = mix(above, crestColor, max(crestFoam, wakeFoam).clamp(0, 1));
    above = mix(above, rgb(foam.shoreline.color).mul(foamLight), shoreFoam.clamp(0, 1));

    // Below: Snell's window shows the sky refracted through the surface; outside it the
    // surface mirrors the water body by total internal reflection.
    const down = up.negate();
    const refracted = refract(view.negate(), down, WATER_IOR);
    const window = dot(refracted, refracted).greaterThan(1e-6);
    const leaving = fresnel(dot(refracted, up).max(0));
    const sky = skyReflection(environment, refracted, float(0));
    const below = select(window, mix(sky, pigment, leaving), pigment);

    this.fragmentNode = vec4(select(frontFacing, above, below), 1);
    this.needsUpdate = true;
  }

  override dispose(): void {
    this.foamDetail.dispose();
    this.sceneDepth.value.dispose();
    this.sceneColor.value.dispose();
    super.dispose();
  }
}
