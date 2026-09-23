import { Vector3, type Node, type Texture, type TextureNode, type UniformNode } from 'three/webgpu';
import { If, add, bool, float, length, max, min, mix, mul, saturate, select, smoothstep, sqrt, sub, texture, texture3D, uniform, vec2, vec3 } from 'three/tsl';
import type { SkyUniforms } from '../contracts';
import { cloudType, heightProfile, liftedCoverage, localCover, CLEAR_RANGE, PLANET_RADIUS, WEATHER_SIZE, WEATHER_TILE, type Arithmetic } from './model';
import { BASE_VOLUME, DETAIL_VOLUME } from './noise';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;

/** The shared formulas of `model.ts`, compiled to nodes. */
export const nodes: Arithmetic<Float> = {
  add: (a, b) => add(a, b) as Float,
  sub: (a, b) => sub(a, b) as Float,
  mul: (a, b) => mul(a, b) as Float,
  mix: (a, b, t) => mix(a, b, t) as Float,
  smoothstep: (e0, e1, x) => smoothstep(e0, e1, x) as Float,
  saturate: x => saturate(x) as Float,
  min: (a, b) => min(a, b) as Float,
  max: (a, b) => max(a, b) as Float,
};

/** World metres one repeat of the base shape volume spans horizontally; vertically it repeats `BASE_STRETCH`
 * times sooner, so a lobe is a little taller than it is wide. */
export const BASE_TILE = 9_000, BASE_STRETCH = 1.4;
/** World metres one repeat of the detail volume spans. */
export const DETAIL_TILE = 720;
/** How much faster than the weather the base shapes drift (a share of the wind), so the sky slowly
 * re-forms instead of sliding as a rigid sheet; and how fast (m/s) they rise, boiling slowly upward. */
const RESHAPE = .06, RISE = .35;
/** Edge detail swirls through the shapes at this speed (m/s), on top of the drift. */
const SWIRL = new Vector3(1.1, 1.7, -.8);
/** Share of the base shape the low billow octaves erode away from the billows' centres, and share the
 * detail volume erodes from the edges: uniforms, so the shapes can be tuned live. */
export const erosion = { shape: uniform(.7), detail: uniform(.7) };
/** A volume's features alias once a pixel's footprint (m) spans a couple of its texels: over these
 * footprints, in texels, the finer octaves fade to their mean, which keeps the cloud's size and drops only
 * what the pixel cannot resolve. */
const RESOLVED = [1.5, 5] as const;
const BASE_TEXEL = BASE_TILE / BASE_VOLUME, DETAIL_TEXEL = DETAIL_TILE / DETAIL_VOLUME;
/** Mean of the billow octaves, what they fade to. */
const BILLOW_MEAN = .45;
/** Horizontal distance (m) of the farthest cloud a march reaches, and the share of it from which cover fades
 * out: beyond ~100 km a cloud is a sliver on the horizon, more haze than cloud. */
export const FARTHEST = 120_000, FADE_FROM = .6;

/** What every cloud pass reads besides the sky's shared uniforms: the scene's layer, live. */
export interface LayerUniforms {
  /** Cloud base and depth of the layer (m). */
  readonly base: UniformNode<'float', number>;
  readonly thickness: UniformNode<'float', number>;
  readonly coverage: UniformNode<'float', number>;
  readonly horizon: UniformNode<'float', number>;
  /** Extinction (1/m) at full density. */
  readonly extinction: UniformNode<'float', number>;
  /** 1 draws cloud; 0 makes every pass see clear sky (diagnostics). */
  readonly enabled: UniformNode<'float', number>;
}

export function createLayerUniforms(): LayerUniforms {
  return { base: uniform(1700), thickness: uniform(2400), coverage: uniform(.4), horizon: uniform(.06), extinction: uniform(.05), enabled: uniform(1) };
}

/** Where a ray from `altitude` (above the sea under the camera) whose upward component is `up` crosses the
 * sphere `height` above the sea: both distances, the nearer first, and whether it crosses at all. Written in
 * the stable form: in float32 the planet's radius swamps a naive quadratic's small root. */
export function crossings(altitude: Float, up: Float, height: Float | number): { near: Float; far: Float; hit: Node<'bool'> } {
  const b = add(altitude, PLANET_RADIUS).mul(up), c = sub(altitude, height).mul(add(altitude, height).add(2 * PLANET_RADIUS));
  const disc = b.mul(b).sub(c), root = sqrt(max(disc, 0));
  const q = select(b.greaterThanEqual(0), b.add(root).negate(), root.sub(b));
  const safe = select(q.abs().lessThan(1e-3), float(1e-3), q), other = c.div(safe);
  return { near: min(q, other), far: max(q, other), hit: disc.greaterThanEqual(0) };
}

/** The stretch of a ray inside the cloud shell (start, end; end ≤ start when it misses), from an origin
 * `altitude` above the sea. Below the base a ray runs from where it leaves the base's sphere to where it leaves
 * the top's; inside the layer from 0; above it from where it enters the top's sphere. A ray descending
 * onto the base's sphere from above ends there. */
export function shellSegment(altitude: Float, up: Float, base: Float, top: Float): { start: Float; end: Float } {
  const lower = crossings(altitude, up, base), upper = crossings(altitude, up, top);
  const ontoBase = altitude.greaterThan(base).and(lower.hit).and(lower.near.greaterThan(0));
  const end = select(ontoBase, lower.near, upper.far);
  const enters = upper.hit.and(upper.near.greaterThan(0));
  const start = select(altitude.lessThan(base), lower.far, select(altitude.greaterThan(top), select(enters, upper.near, float(1e9)), float(0)));
  return { start, end };
}

/** A cloud sample's inputs: where it is in the layer and what the weather map says there. */
export interface CloudSample {
  /** Density before detail erosion, 0–1; 0 means no cloud and no need to erode. */
  readonly coarse: Float;
  /** Height fraction through the layer, 0 at the base. */
  readonly height: Float;
  /** Cloud type (see `model.ts`), for lighting that differs between a deck and a cumulus. */
  readonly type: Float;
  /** The scene's coverage there, lifted toward the horizon. */
  readonly coverage: Float;
  /** The weather texel: (cover potential, type variation, storm potential, curtain texture). */
  readonly weather: Vec4;
  /** Horizontal distance (m) from here to the nearest column that can hold cloud at the scene's coverage. */
  readonly clear: Float;
}

export interface CloudField {
  readonly layer: LayerUniforms;
  /** Height above the sea of a world point, relative to the planet under the camera. */
  altitude(p: Vec3): Float;
  /** The weather texel over a world point (it drifts with the wind). */
  weather(p: Vec3): Vec4;
  /** Density before the detail erosion at a world point (`altitude` its height above the sea). `footprint`
   * is the width (m) a pixel covers there; the base shape's finer billows fade where it cannot resolve them. */
  sample(p: Vec3, altitude: Float, footprint?: Float, branch?: boolean): CloudSample;
  /** Density after eroding the edges with the detail volume, faded like the billows by `footprint`. */
  erode(sample: CloudSample, p: Vec3, footprint?: Float, branch?: boolean): Float;
  /** The weather map's cover at a point near `near` (no 3D noise; the cloud type and coverage are taken from
   * that sample): the cheap density a far light sample reads. */
  cover(p: Vec3, altitude: Float, near: CloudSample): Float;
  /** The texture nodes it reads (diagnostics swap their textures). */
  readonly maps: { readonly weather: TextureNode; readonly base: TextureNode; readonly detail: TextureNode };
}

/** 1 where a pixel `footprint` (m) wide resolves features of `texel` metres, fading to 0 where it cannot. */
function resolved(footprint: Float | undefined, texel: number): Float {
  return footprint ? smoothstep(texel * RESOLVED[1], texel * RESOLVED[0], footprint) : float(1);
}

/** The density field over the curved shell: the weather map's coverage, the cloud type's height profile,
 * the base shape and the detail erosion. Every read is at level 0: marches branch per pixel, where WGSL
 * has no derivatives for implicit mip selection. */
export function createCloudField(sky: SkyUniforms, layer: LayerUniforms, maps: { weather: Texture; base: Texture; detail: Texture }): CloudField {
  const camera = sky.cameraPosition, wind = sky.windOffset, time = sky.time;
  const weatherMap = texture(maps.weather), baseMap = texture3D(maps.base), detailMap = texture3D(maps.detail);
  const altitude = (p: Vec3): Float => {
    // √(A² + s) − A without cancellation, A the distance of the point's height from the planet's centre.
    const dx = p.x.sub(camera.x), dz = p.z.sub(camera.z), s = dx.mul(dx).add(dz.mul(dz)), a = p.y.add(PLANET_RADIUS);
    return p.y.add(s.div(a.add(sqrt(a.mul(a).add(s)))));
  };
  const weather = (p: Vec3): Vec4 => {
    const read = weatherMap.sample(p.xz.sub(wind.xz).div(WEATHER_TILE)).level(float(0));
    read.updateMatrix = false;
    return read as unknown as Vec4;
  };
  /** The octave sum of three billow channels, stretched from its 0.25–0.75 range and faded to its mean. */
  const billowSum = (texel: Vec4, fade: Float, first: 'x' | 'y') => {
    const sum = first === 'x' ? texel.x.mul(.625).add(texel.y.mul(.25)).add(texel.z.mul(.125)) : texel.y.mul(.625).add(texel.z.mul(.25)).add(texel.w.mul(.125));
    return mix(float(BILLOW_MEAN), saturate(sum.sub(.25).mul(2)), fade);
  };
  /** The column's cover at a height: weather potential, cloud type and height profile, faded out toward the
   * farthest clouds a march reaches so the layer sinks into the horizon haze instead of ending. */
  const columnCover = (w: Vec4, p: Vec3, height: Float) => {
    const distance = length(p.xz.sub(camera.xz));
    const coverage = liftedCoverage(nodes, layer.coverage, layer.horizon, distance).toVar();
    const type = cloudType(nodes, coverage, w.y, w.z, height).toVar();
    const fade = smoothstep(FARTHEST, FARTHEST * FADE_FROM, distance).mul(layer.enabled);
    return { type, coverage, cover: localCover(nodes, w.x, coverage).mul(heightProfile(nodes, height, type)).mul(fade) };
  };
  const cover = (p: Vec3, alt: Float, near: CloudSample): Float =>
    localCover(nodes, weather(p).x, near.coverage).mul(heightProfile(nodes, alt.sub(layer.base).div(layer.thickness), near.type));
  const sample = (p: Vec3, alt: Float, footprint?: Float, branch = true): CloudSample => {
    const w = weather(p), height = alt.sub(layer.base).div(layer.thickness);
    const { type, coverage, cover } = columnCover(w, p, height);
    const shaped = () => {
      const drift = vec2(wind.x, wind.z).mul(1 + RESHAPE);
      const uvw = vec3(p.x.sub(drift.x), alt.sub(time.mul(RISE)).mul(BASE_STRETCH), p.z.sub(drift.y)).div(BASE_TILE);
      const shape = baseMap.sample(uvw).level(float(0)) as unknown as Vec4;
      const eroding = billowSum(shape, resolved(footprint, BASE_TEXEL), 'y').oneMinus().mul(erosion.shape);
      const body = saturate(shape.x.sub(eroding).div(eroding.oneMinus()));
      // A thin cover keeps only the strongest parts of the shape: that is what rounds tops and breaks a sky up;
      // a cover past 1 fills the shape's hollows into a deck.
      return saturate(body.sub(cover.oneMinus()).div(max(cover, 1e-3))).mul(select(cover.greaterThan(0), float(1), float(0)));
    };
    const coarse = branch ? float(0).toVar() : shaped();
    // Clear columns (most samples of a fair sky) skip the 3D read. Light samples read unconditionally: without
    // branches the GPU issues all of a light march's reads together.
    if (branch) If(cover.greaterThan(0), () => { (coarse as unknown as { assign(v: Float): void }).assign(shaped()); });
    return { coarse, height, type, coverage, weather: w, clear: w.w.mul(CLEAR_RANGE * WEATHER_TILE / WEATHER_SIZE) };
  };
  /** Ragged, wispy bases (erode the billows' centres); cauliflower above them (erode between the billows). */
  const eroded = (s: CloudSample, billows: Float) => {
    const eroding = mix(billows, billows.oneMinus(), saturate(s.height.mul(5))).mul(erosion.detail);
    return saturate(s.coarse.sub(eroding).div(eroding.oneMinus()));
  };
  const erode = (s: CloudSample, p: Vec3, footprint?: Float, branch = true): Float => {
    const detailed = () => {
      const uvw = p.sub(wind).sub(vec3(SWIRL.x, SWIRL.y, SWIRL.z).mul(time)).div(DETAIL_TILE);
      const detail = detailMap.sample(uvw).level(float(0)) as unknown as Vec4;
      return eroded(s, billowSum(detail, resolved(footprint, DETAIL_TEXEL), 'x'));
    };
    if (!branch) return detailed();
    const result = eroded(s, float(BILLOW_MEAN)).toVar();
    // Where a pixel cannot resolve the detail it erodes by its mean, without reading it.
    If(footprint ? footprint.lessThan(DETAIL_TEXEL * RESOLVED[1]) : bool(true), () => { result.assign(detailed()); });
    return result;
  };
  return { layer, altitude, weather, sample, erode, cover, maps: { weather: weatherMap, base: baseMap, detail: detailMap } };
}
