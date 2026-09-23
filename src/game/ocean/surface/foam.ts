/** Foam shading for the ocean surface: whitecaps through their life, the bubble cloud under them, wind-drawn
 * windrows, and the light every kind of foam is lit by. The wave field decides where crests break and how long ago
 * (`WaveSurfaceSample.foam`: 1 while breaking, e-folding after); this module decides what that looks like. */
import type { Node, Texture } from 'three/webgpu';
import { cos, dot, exp, float, fwidth, max, min, mix, sin, smoothstep, texture, vec2 } from 'three/tsl';
import { FOAM_TEXELS } from './foamTexture';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Metres across the wind per tile of the foam texture; along the wind it stretches with the crest foam's `windStretch`. */
const FOAM_TILE = 40;
/** Windrows are laid out at this share of the lace's scale across the wind, so their lines stay thin, and drawn out
 * this much further along it: lines of old foam run on for hundreds of metres. They gather in bands where the
 * circulation the wind drives converges: the texture's broad patches at two scales this many times the lace's, whose
 * ratio is irrational so the sum never repeats as a lattice seen from the air, drawn out along the wind. */
const WINDROW_SCALE = .75, WINDROW_STRETCH = 3, WINDROW_BANDS = [8, 8 * Math.SQRT2 * 1.13] as const, WINDROW_BAND_STRETCH = 3;
/** How strongly the bands gather windrows: coverage runs from 1 − this to 1 + this times its mean. */
const WINDROW_GATHER = .6;
/** Wind (m/s) over which decaying whitecaps turn from lace into streaks drawn out along the wind (Beaufort 6 to 10). */
const STREAKING_WIND_START = 11, STREAKING_WIND_FULL = 25;

/** Texels per pixel over which a foam pattern blurs into its mean. */
const FOAM_BLUR_START = 4, FOAM_BLUR_END = 48;
/** Share of light a bubble raft scatters back: fresh foam about 0.8, thinning films less (Whitlock et al. 1982). */
const FOAM_ALBEDO = .8;
/** Wrap of the sun's terminator on foam: light diffuses through the bubbles, so a face turned from the sun still
 * glows faintly instead of cutting off at the terminator. */
const FOAM_WRAP = .5;
/** Share of the sun's irradiance foam takes, the same share the game's lit meshes take (VisualEnvironment's
 * MESH_SUNLIGHT): whitecaps stay as bright as a white hull beside them, below the tone curve's shoulder. */
const FOAM_SUN = .5;
/** Depth of the billowing in fresh white water: its churn channel darkens it by up to this share. */
const CHURN_DEPTH = .3;
/** Foam amount below which a whitecap's remains are clear water, and above which foam is fresh: still breaking or
 * just broken and gathered on its crest, a white sheet. */
const FOAM_GONE = .04, FOAM_FRESH = 1.1;
/** Range of the broad patches' sway on the foam amount: whitecaps differ in strength, and their outlines fray at
 * scales a distant pixel still resolves, not only in the fine lace. */
const PATCH_SWAY = [.55, 1.45] as const;
/** Edge half-width of whitecaps in levels of the equalised pattern: soft and ragged, never cut out. */
const WHITECAP_EDGE = .22;
/** Opacity of fresh white water, and of the thinnest film a whitecap leaves: old foam is lace the sea shows through. */
const FRESH_OPACITY = .97, FILM_OPACITY = .45;
/** Share of its patch even the freshest white water covers: aerated water keeps a few holes, never a painted sheet. */
const FRESH_COVERAGE = .9;
/** How much of a decaying whitecap's lace is drawn out along the wind (the lace read at the windrows' layout) at full
 * windiness. */
const RESIDUE_STREAKS = .8;
/** Bubble cloud: the aerated water under and just behind fresh foam brightens toward pale turquoise. Its strength,
 * the foam amounts where it starts and where it is dense, and the depth (m) of water it is seen through, which tints it. */
const BUBBLE_STRENGTH = .7, BUBBLE_START = .15, BUBBLE_FULL = .9, BUBBLE_DEPTH = 2.5;
/** Share of the water's reflection that the bubbly surface over a fresh bubble cloud scatters away: aerated water
 * reads milky from any angle instead of mirroring the sky. */
const AERATED_MATTE = .5;
/** Share of daylight the bubble cloud scatters back up through the water above it. */
const BUBBLE_ALBEDO = .3;
/** Edge half-width of windrows, and the opacity left in a line's gaps between lace filaments. */
const WINDROW_EDGE = .08, WINDROW_LACE = .15;
/** Lace levels over which a windrow goes from its gaps to full lumps of foam. */
const WINDROW_BEADS = [.35, .8] as const;
/** Share of the water's Fresnel reflectance foam keeps: its bubbly top scatters most of the mirror image away. */
const FOAM_GLOSS = .5;

/** The foam texture's coordinates at grid point `xz`: laid in the wind's frame, `stretch` times longer along the wind
 * than across it, one tile per `tile` metres across. */
function foamLayout(xz: Node<'vec2'>, wind: Float, stretch: Float, tile: number): Node<'vec2'> {
  const along = vec2(cos(wind), sin(wind));
  return vec2(dot(xz, along).div(stretch), dot(xz, vec2(along.y.negate(), along.x))).div(tile);
}

/** The foam texture read twice at grid point `xz`: at the lace's scale, and at the windrows' larger, longer one; each
 * with the share of its contrast that filtering has averaged away. `stretch` draws both out along the wind. */
export function foamPatterns(map: Texture, xz: Node<'vec2'>, wind: Float, stretch: Float) {
  const uv = foamLayout(xz, wind, stretch, FOAM_TILE), rowsUv = foamLayout(xz, wind, stretch.mul(WINDROW_STRETCH), FOAM_TILE * WINDROW_SCALE);
  const [near, far] = WINDROW_BANDS.map(scale => texture(map, foamLayout(xz, wind, stretch.mul(WINDROW_BAND_STRETCH), FOAM_TILE * scale)).g);
  return { pattern: texture(map, uv), blur: foamBlur(uv), rows: texture(map, rowsUv), rowsBlur: foamBlur(rowsUv), bands: near.add(far).mul(.5) };
}

/** How far the wind draws decaying whitecaps into streaks, 0–1, at `windSpeed` (m/s). */
export function streaking(windSpeed: Float): Float {
  return smoothstep(STREAKING_WIND_START, STREAKING_WIND_FULL, windSpeed);
}

/** Share of the foam texture's contrast that filtering has averaged away at `uv`: none while a pixel spans a few
 * texels, all of it once a pixel averages dozens and the texture reads as its mean. */
export function foamBlur(uv: Node<'vec2'>): Float {
  return smoothstep(FOAM_BLUR_START, FOAM_BLUR_END, max(fwidth(uv.x), fwidth(uv.y)).mul(FOAM_TEXELS));
}

/** Opacity of foam covering a share `coverage` of the sea. The texture channel `pattern` is equalised, so
 * thresholding it at 1 − coverage keeps exactly that share: a fresh sheet is solid white and thinning foam keeps only
 * the pattern's brightest filaments, instead of turning grey. Where the pattern is blurred to its mean the pixel
 * takes the coverage itself. */
export function foamOpacity(coverage: Float, pattern: Float, blur: Float, edge: number): Float {
  // The threshold runs from just above the pattern's top to just below its bottom, so no coverage shows nothing.
  const share = coverage.clamp(0, 1), threshold = mix(float(1 + edge), float(-edge), share);
  return mix(smoothstep(threshold.sub(edge), threshold.add(edge), pattern), share, blur);
}

/** Opacity of foam covering exactly a share `coverage` of the sea: the threshold at 1 − coverage keeps that share
 * of the equalised `pattern`, and the soft edge narrows near either end so it never leaves the pattern's range (where
 * `foamOpacity` shows less than its coverage). Where the pattern is blurred to its mean the pixel takes the share. */
export function foamShare(coverage: Float, pattern: Float, blur: Float, edge: number): Float {
  const share = coverage.clamp(0, 1), threshold = float(1).sub(share);
  const width = min(float(edge), min(share, threshold)).max(1e-4);
  return mix(smoothstep(threshold.sub(width), threshold.add(width), pattern), share, blur).mul(smoothstep(0, 1e-3, share));
}

/** How fresh the foam is, 0–1: 1 while its crest breaks, falling as it decays. */
export function foamFreshness(amount: Float): Float {
  return smoothstep(FOAM_GONE, FOAM_FRESH, amount);
}

/** Whitecaps from the wave field's foam `amount` (1 while breaking, e-folding after), the foam texture's `pattern`
 * (lace, patches, streaks, churn) and its lace drawn out along the wind (`drawn`). Fresh white water covers its patch
 * in a billowing, near-opaque sheet whose rim, where the amount falls off, frays into the lace; as it decays it keeps
 * fewer, thinner filaments, dragged into streaks as `windiness` rises, until clear water is left. */
export function whitecapOpacity(amount: Float, pattern: Node<'vec4'>, drawn: Float, blur: Float, windiness: Float): Float {
  const fresh = foamFreshness(amount.mul(mix(PATCH_SWAY[0], PATCH_SWAY[1], pattern.g)));
  // Coverage falls slower than the amount: old foam lingers as sparse lace rather than fading as a whole.
  const coverage = fresh.sqrt().mul(FRESH_COVERAGE);
  const structure = mix(pattern.r, drawn, windiness.mul(RESIDUE_STREAKS).mul(float(1).sub(fresh)));
  const density = mix(FILM_OPACITY, FRESH_OPACITY, fresh).mul(mix(float(1 - CHURN_DEPTH), float(1), mix(pattern.a, .5, blur)));
  return foamShare(coverage, structure, blur, WHITECAP_EDGE).mul(density);
}

/** Windrows: old foam the wind has gathered into long thin lines along itself, covering `coverage` of the sea in the
 * `bands` (mean ½) that gather it, each line a string of lumps of the lace (read at its own scale). */
export function windrowOpacity(coverage: Float, bands: Float, streaks: Float, lace: Float, blur: Float): Float {
  const beads = mix(float(WINDROW_LACE), float(1), smoothstep(WINDROW_BEADS[0], WINDROW_BEADS[1], lace));
  const gathered = coverage.mul(bands.sub(.5).mul(2 * WINDROW_GATHER).add(1));
  return foamShare(gathered, streaks, blur, WINDROW_EDGE).mul(mix(beads, float(1), blur));
}

/** Radiance of a diffuse white scatterer facing `normal`: the sky dome's light about the normal (`sky`, its radiance
 * blurred over the hemisphere) plus the sun's or moon's irradiance, wrapped because light diffuses through the
 * bubbles, and cut by the sun's shadow `lit`. */
export function foamRadiance(sky: Vec3, sunRadiance: Vec3, normal: Vec3, sun: Vec3, lit: Float): Vec3 {
  const facing = dot(normal, sun).add(FOAM_WRAP).div(1 + FOAM_WRAP).max(0).mul(smoothstep(-.1, .05, sun.y));
  return sky.add(sunRadiance.mul(facing).mul(lit).mul(FOAM_SUN / Math.PI)).mul(FOAM_ALBEDO);
}

/** How aerated the water is, 0–1, from the wave field's bubble cloud: fresh foam's bubbles, spread around it. */
export function aeration(bubbles: Float): Float {
  return smoothstep(BUBBLE_START, BUBBLE_FULL, bubbles);
}

/** The water's Fresnel `reflectance` over aerated water: the bubbly surface scatters part of the mirror image away. */
export function aeratedReflectance(reflectance: Float, aerated: Float): Float {
  return reflectance.mul(float(1).sub(aerated.mul(AERATED_MATTE)));
}

/** The water body brightened by the bubble cloud fresh foam leaves under and behind it: daylight (`light`, the foam's
 * own) scattered back by bubbles and tinted by the water above them, which absorbs red most: pale turquoise. */
export function bubbleCloud(body: Vec3, aerated: Float, light: Vec3, absorption: Vec3): Vec3 {
  const tint = exp(absorption.mul(-BUBBLE_DEPTH));
  const cloud = light.mul(tint).mul(BUBBLE_ALBEDO / FOAM_ALBEDO);
  return mix(body, max(body, cloud), aerated.mul(BUBBLE_STRENGTH));
}

/** `sea` with foam of radiance `foam` over `opacity` of it. Foam's wet, bubbly top reflects the sky (`mirrored`) less
 * than smooth water, by FOAM_GLOSS of the water's `reflectance`; and it is never darker than the water it covers
 * without its glints (`water`): too rough to glint, it takes the place of the sparkle, not of the sky's reflection. */
export function foamOver(sea: Vec3, water: Vec3, foam: Vec3, mirrored: Vec3, reflectance: Float, opacity: Float): Vec3 {
  return mix(sea, max(mix(foam, mirrored, reflectance.mul(FOAM_GLOSS)), water), opacity.clamp(0, 1));
}
