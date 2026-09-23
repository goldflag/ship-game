/** Foam shading for the ocean surface: whitecaps through their life, the bubble cloud under them, wind-drawn
 * windrows, and the light every kind of foam is lit by. The wave field decides where crests break and how long ago
 * (`WaveSurfaceSample.foam`: foam per area, about 1 while breaking and more on a converging crest, e-folding after;
 * `bubbles`: the cloud they leave in the water); this module decides what that looks like. */
import type { Node, Texture } from 'three/webgpu';
import { cos, dot, exp, float, fwidth, max, min, mix, sin, smoothstep, texture, vec2 } from 'three/tsl';
import { FOAM_TEXELS } from './foamTexture';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Metres across the wind per tile of the foam texture; along the wind it stretches with the crest foam's `windStretch`. */
const FOAM_TILE = 40;
/** Windrows are laid out this many times larger than the lace across the wind (lines about 0.5 to 2 m wide, 8 to 20
 * m apart) and drawn out this much further along it: lines of old foam run on for tens of metres before they break.
 * They gather in bands where the circulation the wind drives converges: the texture's broad patches at two scales
 * this many times the lace's, whose ratio is irrational so the sum never repeats as a lattice seen from the air. */
const WINDROW_SCALE = 2.5, WINDROW_STRETCH = 4, WINDROW_BANDS = [8, 8 * Math.SQRT2 * 1.13] as const, WINDROW_BAND_STRETCH = 3;
/** How strongly the bands gather windrows: coverage runs from 1 − this to 1 + this times its mean. */
const WINDROW_GATHER = .6;
/** The bands also shift the windrow lines across the wind by up to half this share of their tile, so the lines never
 * repeat with the tile's width (a stripe pattern seen from the air). */
const WINDROW_WARP = .3;

/** Texels per pixel over which a foam pattern gives way to its mean coverage: every mip level of the foam texture is
 * equalised, so thresholds keep their share until the levels are too small to hold a pattern (8 × 8 and below). */
const FOAM_BLUR_START = 24, FOAM_BLUR_END = 96;
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
/** Foam amount below which a whitecap's remains are clear water, and above which foam is fresh: breaking now and
 * gathered on its converging crest (the amount is foam per area, up to about 3 on a fold), a white sheet. Foam that
 * has spread off the crest, or broke a moment ago, is already thinning. */
const FOAM_GONE = .04, FOAM_FRESH = 1.2;
/** Range of the broad patches' sway on the foam amount: whitecaps differ in strength, and their outlines fray at
 * scales a distant pixel still resolves, not only in the fine lace. */
const PATCH_SWAY = [.55, 1.45] as const;
/** Edge half-width of whitecaps in levels of the equalised pattern: soft and ragged, never cut out. */
const WHITECAP_EDGE = .3;
/** Opacity of fresh white water, and of the thinnest film a whitecap leaves: old foam is lace the sea shows through. */
const FRESH_OPACITY = .97, FILM_OPACITY = .35;
/** Share of its patch even the freshest white water covers: aerated water keeps a few holes, never a painted sheet. */
const FRESH_COVERAGE = .9;
/** Bubble cloud: the aerated water under, around and just behind breaking crests brightens toward pale turquoise. Its
 * strength, the spread bubble amounts where it starts and where it is dense, and the depth (m) of water it is seen
 * through, which tints it. Its soft rise around each whitecap is what keeps a distant one from reading as a cut-out. */
const BUBBLE_STRENGTH = .6, BUBBLE_START = .02, BUBBLE_FULL = .4, BUBBLE_DEPTH = 2.5;
/** Share of the water's reflection that the bubbly surface over a fresh bubble cloud scatters away: aerated water
 * reads milky from any angle instead of mirroring the sky. */
const AERATED_MATTE = .5;
/** Share of daylight the bubble cloud scatters back up through the water above it. */
const BUBBLE_ALBEDO = .18;
/** Opacity left in a windrow's gaps between lace filaments. */
const WINDROW_LACE = .05;
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

/** The foam texture read at grid point `xz`: at the lace's scale (with the share of its contrast filtering has averaged
 * away), at the windrows' larger and longer one, and for the windrows' bands. `stretch` draws all out along the wind. */
export function foamPatterns(map: Texture, xz: Node<'vec2'>, wind: Float, stretch: Float) {
  const uv = foamLayout(xz, wind, stretch, FOAM_TILE);
  const [near, far] = WINDROW_BANDS.map(scale => texture(map, foamLayout(xz, wind, stretch.mul(WINDROW_BAND_STRETCH), FOAM_TILE * scale)).g);
  const bands = near.add(far).mul(.5);
  const rowsUv = foamLayout(xz, wind, stretch.mul(WINDROW_STRETCH), FOAM_TILE * WINDROW_SCALE).add(vec2(0, bands.sub(.5).mul(WINDROW_WARP)));
  return { pattern: texture(map, uv), blur: foamBlur(uv), rows: texture(map, rowsUv), bands };
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

/** Whitecaps from the wave field's foam `amount` (foam per area: about 1 while breaking, more on a converging crest,
 * e-folding after) and the foam texture's `pattern` (lace, patches, streaks, churn). Fresh white water on the crest is
 * a billowing, near-opaque sheet whose rim, where the amount falls off, frays into the lace; the rest of the patch and
 * the foam it leaves behind keep fewer, thinner and fainter filaments until clear water is left. */
export function whitecapOpacity(amount: Float, pattern: Node<'vec4'>, blur: Float): Float {
  const fresh = foamFreshness(amount.mul(mix(PATCH_SWAY[0], PATCH_SWAY[1], pattern.g)));
  // Coverage falls slower than the amount: old foam lingers as sparse lace rather than fading as a whole.
  const coverage = fresh.sqrt().mul(FRESH_COVERAGE);
  const density = mix(FILM_OPACITY, FRESH_OPACITY, fresh).mul(mix(float(1 - CHURN_DEPTH), float(1), mix(pattern.a, .5, blur)));
  return foamShare(coverage, pattern.r, blur, WHITECAP_EDGE).mul(density);
}

/** Mean of the windrows' beading over the equalised lace: WINDROW_LACE plus the rest times E[smoothstep(a, b, U)]
 * for U uniform on [0, 1], which is 1 − b + (b − a) / 2. */
const BEADS_MEAN = WINDROW_LACE + (1 - WINDROW_LACE) * (1 - WINDROW_BEADS[1] + (WINDROW_BEADS[1] - WINDROW_BEADS[0]) / 2);

/** Windrows: old foam the wind has gathered into long thin lines along itself, covering `coverage` of the sea in the
 * `bands` (mean ½) that gather it, each line a string of lumps of the lace (read at its own scale, `blur` averaged
 * away far off). The streak mask (mean `streakMean` at every distance) is scaled rather than thresholded, so lines too
 * fine for a pixel fade to their true share instead of vanishing. */
export function windrowOpacity(coverage: Float, bands: Float, streaks: Float, lace: Float, blur: Float, streakMean: number): Float {
  const beads = mix(mix(float(WINDROW_LACE), float(1), smoothstep(WINDROW_BEADS[0], WINDROW_BEADS[1], lace)), float(BEADS_MEAN), blur);
  const gathered = coverage.mul(bands.sub(.5).mul(2 * WINDROW_GATHER).add(1));
  return streaks.mul(gathered.div(streakMean * BEADS_MEAN)).min(1).mul(beads);
}

/** Radiance of a diffuse white scatterer facing `normal`: the sky dome's light about the normal (`sky`, its radiance
 * blurred over the hemisphere) plus the sun's or moon's irradiance, wrapped because light diffuses through the
 * bubbles, and cut by the sun's shadow `lit`. */
export function foamRadiance(sky: Vec3, sunRadiance: Vec3, normal: Vec3, sun: Vec3, lit: Float): Vec3 {
  const facing = dot(normal, sun).add(FOAM_WRAP).div(1 + FOAM_WRAP).max(0).mul(smoothstep(-.1, .05, sun.y));
  return sky.add(sunRadiance.mul(facing).mul(lit).mul(FOAM_SUN / Math.PI)).mul(FOAM_ALBEDO);
}

/** How aerated the water is, 0–1, from the wave field's bubble cloud: breaking crests' bubbles, spread around them. */
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
