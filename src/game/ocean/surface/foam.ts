/** Foam shading for the ocean surface: whitecaps through their life, the churned water behind hulls, the bubble cloud
 * under both, wind-drawn windrows, and the light every kind of foam is lit by. The wave field decides where crests break
 * and how long ago (`WaveSurfaceSample.foam`: foam per area, about 1 while breaking and more on a converging crest,
 * e-folding after; `foamMean`, the same spread over the pixel; `bubbles`, the cloud they leave in the water); the
 * realistic wake's sampler decides where its churned water lies. This module decides what they look like.
 *
 * Whitecaps are one substance through their life (Monahan & Mac Niocaill, *Oceanic Whitecaps*, 1986): a small, dense,
 * billowing core on the forward face while the crest breaks (stage A), and a larger patch of lacy, see-through foam
 * streaked along the wind that it leaves behind and that thins to clear water (stage B). The patch is what covers
 * Monahan's share of the sea (`whitecaps.ts` calibrates its area); averaged over that area foam reflects about a quarter
 * of the light, as Koepke (1984) measured of real whitecaps, not the four fifths of a fresh sheet. */
import type { Node, Texture } from 'three/webgpu';
import { clamp, cos, dFdx, dFdy, dot, exp, float, fwidth, max, min, mix, sin, smoothstep, step, texture, vec2 } from 'three/tsl';
import { FOAM_TEXELS } from './foamTexture';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** Metres across the wind per tile of the foam texture; along the wind it stretches with the crest foam's `windStretch`. */
const FOAM_TILE = 40;
/** Old foam is the lace drawn out along the wind: read at this share of the lace's scale across the wind and this many
 * times longer along it (filaments about 1–5 m apart across the wind, running on for 5–40 m). Whitecaps' residue and
 * windrows are made of it. */
const STREAK_SCALE = .6, STREAK_STRETCH = 4;
/** Windrows gather in bands where the circulation the wind drives converges: the texture's band mask and broad patches,
 * read this many times larger than the lace (and a second patch read at an irrational ratio of it, so their sum never
 * repeats as a lattice seen from the air), drawn out this much further along the wind. */
const BAND_SCALES = [8, 8 * Math.SQRT2 * 1.13] as const, BAND_STRETCH = 1.5;
/** How strongly the patches gather windrows into some bands and thin them in others: coverage runs from 1 − this to
 * 1 + this times its mean. */
const WINDROW_GATHER = .6;
/** The most of its band a windrow covers, so even the densest line stays a string of beads and filaments. */
const WINDROW_PEAK = .75;
/** Edge half-width of windrows and of whitecaps' residue, in levels of the equalised lace: soft, frayed filaments. */
const WINDROW_EDGE = .25, RESIDUE_EDGE = .25;

/** Texels per pixel over which a foam pattern gives way to its mean coverage: every mip level of the foam texture down
 * to 16 × 16 is equalised, so thresholds keep their share until the levels are too small to hold a pattern. */
const FOAM_BLUR_START = 24, FOAM_BLUR_END = 96;
/** Share of light a bubble raft scatters back: fresh foam about 0.8 (Whitlock et al. 1982); thinner foam is thinner
 * cover over the water, not a darker white. */
const FOAM_ALBEDO = .8;
/** Wrap of the sun's terminator on foam: light diffuses through the bubbles, so a face turned from the sun still
 * glows faintly instead of cutting off at the terminator. */
const FOAM_WRAP = .5;
/** Share of the sun's irradiance foam takes, the same share the game's lit meshes take (VisualEnvironment's
 * MESH_SUNLIGHT): whitecaps stay as bright as a white hull beside them, below the tone curve's shoulder. */
const FOAM_SUN = .55;
/** Share of the water's Fresnel reflectance foam keeps: its bubbly top scatters most of the mirror image away. */
const FOAM_GLOSS = .5;

/** Range of the broad patches' sway on the foam amount: whitecaps differ in strength, and their outlines fray at
 * scales a distant pixel still resolves, not only in the fine lace. */
const PATCH_SWAY = [.6, 1.4] as const;
/** Foam amount over which a whitecap's core goes from nothing to a full sheet: foam breaking now and gathered on its
 * converging crest (the amount is foam per area, up to about 3 on a fold). Foam that has spread off the crest, or
 * broke a moment ago, is no longer core. */
const CORE_START = .9, CORE_FULL = 1.8;
/** Share of its patch a full core covers, and its edge half-width in the lace: aerated water keeps a few holes. */
const CORE_COVER = .95, CORE_EDGE = .2;
/** Foam amount below which a whitecap's patch is clear water, and above which it is fully there: the soft rim of the
 * patch. A pixel counts toward the whitecaps' area where the patch is at least half there (`whitecapPatch`). */
const PATCH_GONE = .03, PATCH_FULL = .3;
/** Share of the patch the residue's filaments cover, and their opacity as the patch thins and where it is full. */
const RESIDUE_COVER = .55, RESIDUE_FAINT = .2, RESIDUE_DENSE = .5;

/** Dense white water (whitecap cores and churned water): its opacity, and in its thin spots, where the churn channel
 * is low, the opacity left, so the bubble-lit water shows through. Churn levels over which a spot thickens. */
const DENSE_OPACITY = .97, THIN_OPACITY = .5, THIN_LOW = .12, THIN_HIGH = .45;
/** Billows in dense white water: brightness varies by this much across the churn channel, and each billow is lit on
 * its sunward side by this much per unit of the channel's rise over EMBOSS_METRES toward the sun. */
const BILLOW_DEPTH = .35, EMBOSS_GAIN = .9, EMBOSS_METRES = .35;

/** Footprint (m, the pixel's across-view size or a quarter of its along-view size, whichever is larger) over which a
 * whitecap goes from drawn to its share of the pixel, and over which that gives way to the wind's mean coverage: a
 * whitecap smaller than a pixel reads as a faint brightening instead of a fleck. */
const FLECK_START = 1.5, FLECK_END = 4, FAR_START = 8, FAR_END = 20;
/** Mean opacity a pixel takes per unit of spread foam (`foamMean`), and the mean opacity over the whitecaps' area:
 * measured on the drawn whitecaps with `bun scripts/browser/ocean-waves.ts --coverage`. */
const MEAN_GAIN = 1.2, AREA_OPACITY = .32;
/** Foam a stretched back thins and a converging crest gathers is held within these factors of its mean (windrows). */
const GATHERED = [.6, 1.6] as const;

/** The realistic wake's churned water (a sampler with a slick): foam energy over which it goes from clear to its
 * densest, and the edge half-width of its lace. The sampler's eddies already tear its outline. */
const CHURN_START = 0, CHURN_FULL = 1, CHURN_EDGE = .3;

/** Bubble clouds under breaking crests and churned water: the whitecaps' spread bubble amount over which the water turns
 * aerated, the wake sampler's densest bubbles, and the most of the way aerated water turns toward the cloud's light. */
const BUBBLE_START = .02, BUBBLE_FULL = .5, WAKE_BUBBLES = .6, BUBBLE_STRENGTH = .6;
/** Share of daylight a bubble cloud scatters back up, and the metres of water down to it and back, which take the red
 * first: the pale turquoise under a whitecap and a warship's wake. */
const BUBBLE_ALBEDO = .28, BUBBLE_PATH = 2.2;
/** Share of the water's reflection that the bubbly surface over an aerated cloud scatters away: aerated water reads
 * milky from any angle instead of mirroring the sky. */
const AERATED_MATTE = .5;

/** The foam texture's coordinates at grid point `xz`: laid in the wind's frame, `stretch` times longer along the wind
 * than across it, one tile per `tile` metres across. */
function foamLayout(xz: Vec2, wind: Float, stretch: Float, tile: number): Vec2 {
  const along = vec2(cos(wind), sin(wind));
  return vec2(dot(xz, along).div(stretch), dot(xz, vec2(along.y.negate(), along.x))).div(tile);
}

/** A step of `metres` toward the sun `sun` in the foam texture's coordinates (laid as `foamLayout`): as long as the sun
 * is low, none when it stands overhead. */
function sunward(sun: Vec3, wind: Float, stretch: Float, metres: number, tile: number): Vec2 {
  const along = vec2(cos(wind), sin(wind)), step = vec2(sun.x, sun.z).mul(metres);
  return vec2(dot(step, along).div(stretch), dot(step, vec2(along.y.negate(), along.x))).div(tile);
}

/** Share of the foam texture's contrast that filtering has averaged away at `uv`: none while a pixel spans a few
 * texels, all of it once a pixel averages dozens and the texture reads as its mean. */
export function foamBlur(uv: Vec2): Float {
  return smoothstep(FOAM_BLUR_START, FOAM_BLUR_END, max(fwidth(uv.x), fwidth(uv.y)).mul(FOAM_TEXELS));
}

/** The pixel's footprint on the sea at grid point `xz` (m): its size across the view, or a quarter of its length along
 * it, whichever is larger. Past a couple of metres a whitecap is thinner than the pixel's height on screen. */
export function foamFootprint(xz: Vec2): Float {
  const across = dFdx(xz).length(), down = dFdy(xz).length();
  return max(min(across, down), max(across, down).div(4));
}

/** The foam texture read at grid point `xz`, `stretch` drawing it out along the wind `wind`: the lace layout's four
 * channels, the old foam's streaked lace, the windrows' band mask and gathering patches, and the churn channel a step
 * toward the sun `sun` (for the billows' relief), with each layout's blur. */
export function foamPatterns(map: Texture, xz: Vec2, wind: Float, stretch: Float, sun: Vec3) {
  const uv = foamLayout(xz, wind, stretch, FOAM_TILE);
  const streakUv = foamLayout(xz, wind, stretch.mul(STREAK_STRETCH), FOAM_TILE * STREAK_SCALE);
  const [nearBands, farBands] = BAND_SCALES.map(scale => texture(map, foamLayout(xz, wind, stretch.mul(BAND_STRETCH), FOAM_TILE * scale)));
  return {
    pattern: texture(map, uv), blur: foamBlur(uv),
    streaks: texture(map, streakUv).r, streaksBlur: foamBlur(streakUv),
    lines: nearBands.b, gather: nearBands.g.add(farBands.g).mul(.5),
    churnSunward: texture(map, uv.add(sunward(sun, wind, stretch, EMBOSS_METRES, FOAM_TILE))).a,
  };
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

/** The whitecap foam amount `amount` swayed by the broad patches `patches` (none where they are blurred away). */
function swayed(amount: Float, patches: Float, blur: Float): Float {
  return amount.mul(mix(mix(PATCH_SWAY[0], PATCH_SWAY[1], patches), 1, blur));
}

/** How much of a whitecap's patch is there at swayed foam amount `amount`, 0–1: the soft rim fading into clear water. A
 * pixel counts toward the whitecaps' area (Monahan's W) where this is at least ½. */
function whitecapPatch(amount: Float): Float {
  return smoothstep(PATCH_GONE, PATCH_FULL, amount);
}

/** Whether the pixel lies in a whitecap's patch (1) or not (0), for foam `amount` and the lace layout's `pattern`: what
 * the whitecaps' area, Monahan's W, counts. */
export function inWhitecap(amount: Float, pattern: Node<'vec4'>, blur: Float): Float {
  return step(.5, whitecapPatch(swayed(amount, pattern.g, blur)));
}

/** Mean opacity of whitecaps too small for their pixel, from the foam spread over it (`WaveSurfaceSample.foamMean`). */
export function spreadWhitecaps(mean: Float): Float {
  return float(1).sub(exp(mean.mul(-MEAN_GAIN)));
}

/** Mean of dense white water's opacity over the equalised churn channel: THIN_OPACITY plus the rest times
 * E[smoothstep(a, b, U)] for U uniform on [0, 1], which is 1 − b + (b − a) / 2. */
const DENSE_MEAN = THIN_OPACITY + (DENSE_OPACITY - THIN_OPACITY) * (1 - THIN_HIGH + (THIN_HIGH - THIN_LOW) / 2);

/** Opacity of dense white water (whitecap cores, churned water) over its cover: nearly opaque, with thin spots where
 * the churn channel `churn` is low, averaged where the pattern is blurred away. */
function denseOpacity(churn: Float, blur: Float): Float {
  return mix(mix(float(THIN_OPACITY), float(DENSE_OPACITY), smoothstep(THIN_LOW, THIN_HIGH, churn)), float(DENSE_MEAN), blur);
}

/** A whitecap from the wave field's foam at this pixel: `amount` (drawn), `mean` (spread over the pixel) and `share`
 * (the wind's whitecap area), with the lace layout's `pattern`, the old foam's `streaks` and their blurs. Near, a small
 * dense core on the gathering crest and a larger lacy, streaked, see-through patch around and behind it; a whitecap
 * smaller than its pixel (`footprint`, m) turns into its share of the pixel, and far off into the wind's mean. Returns
 * the opacity, how much of it is dense core (for the billows), and how far the pixel has gone to the mean. */
export function whitecapFoam(amount: Float, mean: Float, share: Float, pattern: Node<'vec4'>, blur: Float, streaks: Float, streaksBlur: Float, footprint: Float) {
  const swayedAmount = swayed(amount, pattern.g, blur);
  const core = smoothstep(CORE_START, CORE_FULL, swayedAmount), patch = whitecapPatch(swayedAmount);
  const coreOpacity = foamShare(core.mul(CORE_COVER), pattern.r, blur, CORE_EDGE).mul(denseOpacity(pattern.a, blur));
  const residue = foamShare(patch.mul(RESIDUE_COVER), streaks, streaksBlur, RESIDUE_EDGE).mul(mix(RESIDUE_FAINT, RESIDUE_DENSE, patch));
  const drawn = max(coreOpacity, residue);
  const toMean = smoothstep(FLECK_START, FLECK_END, footprint), toFar = smoothstep(FAR_START, FAR_END, footprint);
  const far = share.mul(AREA_OPACITY);
  return { opacity: mix(mix(drawn, spreadWhitecaps(mean), toMean), far, toFar), dense: core.mul(float(1).sub(toMean)), far: toFar };
}

/** The realistic wake's churned water from its sampler's foam `energy`: the same dense, billowing white water as a
 * whitecap's core, over the cover the sampler's eddies and ramp give it. Returns its opacity and cover. */
export function churnedWater(energy: Float, pattern: Node<'vec4'>, blur: Float) {
  const cover = smoothstep(CHURN_START, CHURN_FULL, energy);
  return { opacity: foamShare(cover, pattern.r, blur, CHURN_EDGE).mul(denseOpacity(pattern.a, blur)), dense: cover };
}

/** Windrows: old foam the wind has gathered into lines along itself, covering `coverage` of the sea. The band mask
 * `lines` (mean `linesMean` at every distance) lays the lines and the patches `gather` crowd them into some stretches
 * of sea; within them the old foam's `streaks` (blur `blur`) break each line into beads and filaments of varying width,
 * thicker where the surface converges (`jacobian`), so they ride the waves. Far off they keep their mean. */
export function windrowOpacity(coverage: Float, lines: Float, linesMean: number, gather: Float, streaks: Float, blur: Float, jacobian: Float): Float {
  const gathered = coverage.mul(gather.sub(.5).mul(2 * WINDROW_GATHER).add(1)).mul(lines).div(linesMean);
  const density = clamp(float(1).div(jacobian.max(.05)), GATHERED[0], GATHERED[1]);
  return foamShare(gathered.min(WINDROW_PEAK), streaks, blur, WINDROW_EDGE).mul(density);
}

/** Brightness of dense white water relative to its light: its billows (the churn channel `churn`) vary it and each is
 * lit on its sunward side (`churnSunward`, the channel a step toward the sun), in proportion to how `dense` the foam is;
 * none where the pattern is blurred away. */
export function billows(churn: Float, churnSunward: Float, dense: Float, blur: Float): Float {
  const relief = churn.sub(.5).mul(BILLOW_DEPTH).add(churn.sub(churnSunward).mul(EMBOSS_GAIN));
  return float(1).add(relief.mul(dense).mul(float(1).sub(blur)));
}

/** Radiance of a diffuse white scatterer facing `normal`: the sky dome's light about the normal (`sky`, its radiance
 * blurred over the hemisphere) plus the sun's or moon's irradiance, wrapped because light diffuses through the
 * bubbles, and cut by the sun's shadow `lit`. */
export function foamRadiance(sky: Vec3, sunRadiance: Vec3, normal: Vec3, sun: Vec3, lit: Float): Vec3 {
  const facing = dot(normal, sun).add(FOAM_WRAP).div(1 + FOAM_WRAP).max(0).mul(smoothstep(-.1, .05, sun.y));
  return sky.add(sunRadiance.mul(facing).mul(lit).mul(FOAM_SUN / Math.PI)).mul(FOAM_ALBEDO);
}

/** How aerated the water is, 0–1: the whitecaps' spread `bubbles`, or the wake's `wakeBubbles` where there is a wake. */
export function aeration(bubbles: Float, wakeBubbles?: Float): Float {
  const whitecaps = smoothstep(BUBBLE_START, BUBBLE_FULL, bubbles);
  return wakeBubbles ? max(whitecaps, wakeBubbles.div(WAKE_BUBBLES).clamp(0, 1)) : whitecaps;
}

/** The water's Fresnel `reflectance` over aerated water: the bubbly surface scatters part of the mirror image away. */
export function aeratedReflectance(reflectance: Float, aerated: Float): Float {
  return reflectance.mul(float(1).sub(aerated.mul(AERATED_MATTE)));
}

/** The water body brightened by the bubble clouds in it: daylight (`light`, the foam's own) scattered back by bubbles and
 * tinted by the water above them, which absorbs red most: pale turquoise. */
export function bubbleCloud(body: Vec3, aerated: Float, light: Vec3, absorption: Vec3): Vec3 {
  const cloud = light.mul(exp(absorption.mul(-BUBBLE_PATH))).mul(BUBBLE_ALBEDO / FOAM_ALBEDO);
  return mix(body, max(body, cloud), aerated.mul(BUBBLE_STRENGTH));
}

/** `sea` with foam of radiance `foam` over `opacity` of it. Foam's wet, bubbly top reflects the sky (`mirrored`) less
 * than smooth water, by FOAM_GLOSS of the water's `reflectance`; and it is never darker than the water it covers
 * without its glints (`water`): too rough to glint, it takes the place of the sparkle, not of the sky's reflection. */
export function foamOver(sea: Vec3, water: Vec3, foam: Vec3, mirrored: Vec3, reflectance: Float, opacity: Float): Vec3 {
  return mix(sea, max(mix(foam, mirrored, reflectance.mul(FOAM_GLOSS)), water), opacity.clamp(0, 1));
}
