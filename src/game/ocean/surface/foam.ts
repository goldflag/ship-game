/** Foam shading for the ocean surface: whitecaps through their life, the churned water behind hulls, the bubble cloud
 * under both, wind-drawn windrows, and the light every kind of foam is lit by. The wave field decides where crests break
 * and how long ago (`WaveSurfaceSample.foam`: foam per area, about 1 while breaking and more on a converging crest,
 * spreading and e-folding after; `fresh`, its part that broke in the last few seconds; `foamMean` and `bubbles`, both
 * spread over the pixel); the realistic wake's sampler decides where its churned water lies. This module decides what
 * they look like.
 *
 * Whitecaps are one substance through their life (Monahan & Mac Niocaill, *Oceanic Whitecaps*, 1986): a small, dense,
 * billowing core on the forward face while the crest breaks (stage A), and a larger patch of lacy, see-through foam
 * streaked along the wind that it leaves behind and that thins to clear water (stage B). The patch is what covers
 * Monahan's share of the sea (`whitecaps.ts` calibrates its area); averaged over that area foam reflects about a quarter
 * of the light, as Koepke (1984) measured of real whitecaps, not the four fifths of a fresh sheet. */
import type { Node, Texture } from 'three/webgpu';
import { clamp, cos, dFdx, dFdy, dot, exp, float, max, min, mix, sin, smoothstep, step, texture, vec2 } from 'three/tsl';
import { noise } from '../noise';
import { FOAM_ANISOTROPY, FOAM_TEXELS } from './foamTexture';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;

/** Metres across the wind per tile of the foam texture; along the wind it stretches with the crest foam's `windStretch`. */
const FOAM_TILE = 40;
/** Old foam is the lace drawn out along the wind: read at this share of the lace's scale across the wind and this many
 * times longer along it (filaments about 1–4 m apart across the wind, running on for 3–20 m). Whitecaps' residue and
 * windrows are made of it. */
const STREAK_SCALE = .5, STREAK_STRETCH = 2.5;
/** Windrows gather in bands where the circulation the wind drives converges: the texture's band mask (bands 12–32 m
 * apart) and broad patches, read this many times larger than the lace (and a second patch read at an irrational ratio of
 * it, so their sum never repeats as a lattice seen from the air), drawn out this much further along the wind. */
const BAND_SCALES = [4, 4 * Math.SQRT2 * 1.13] as const, BAND_STRETCH = 2;
/** The bands' layout is shifted by the world's noise (`noise.ts`) in cells this many metres wide, by up to this many
 * metres along the wind and across it: the texture's tile repeats every 160 m across the wind, and its bands drew
 * corduroy over the far sea. Shifted, they meander a few degrees off the wind and never fall in the same place twice. */
const BAND_WARP_CELL = 600, BAND_WARP_ALONG = 100, BAND_WARP_ACROSS = 80;
/** How strongly the patches gather windrows into some bands and thin them in others: coverage runs from 1 − this to
 * 1 + this times its mean. */
const WINDROW_GATHER = .35;
/** The most of its band a windrow covers, so even the densest line stays a string of beads and filaments, and how far
 * its foam is drawn out along the wind: a little, so beads and patches, not threads. */
const WINDROW_PEAK = .4, WINDROW_STREAKING = .3;
/** Edge half-width of windrows and of whitecaps' residue, in levels of the equalised lace: soft, frayed filaments. */
const WINDROW_EDGE = .35, RESIDUE_EDGE = .35;

/** Texels per pixel (across a pixel, its length over the sampler's anisotropy, or the side of the area it averages)
 * over which a foam pattern gives way to its mean coverage: every mip level of the foam texture down to 16 × 16 is equalised, so thresholds keep
 * their share while a pixel spans a few texels, but a threshold on a level whose texels are wider than the pattern's
 * finest filaments draws blocks. */
const FOAM_BLUR_START = 4, FOAM_BLUR_END = 24;
/** Share of light a bubble raft scatters back: fresh foam about 0.8 (Whitlock et al. 1982); thinner foam is thinner
 * cover over the water, not a darker white. */
const FOAM_ALBEDO = .8;
/** Wrap of the sun's terminator on foam: light diffuses through the bubbles, so a face turned from the sun still
 * glows faintly instead of cutting off at the terminator. */
const FOAM_WRAP = .5;
/** Share of the sun's irradiance foam takes, the share lit meshes once took: whitecaps stay below the tone curve's
 * shoulder. Lit meshes now take the whole sun, so a white hull reads brighter than the whitecaps beside it. */
const FOAM_SUN = .55;
/** Share of the water's Fresnel reflectance foam keeps: its bubbly top scatters most of the mirror image away. */
const FOAM_GLOSS = .5;

/** Range of the broad patches' sway on the foam amount, and of the billows' (the churn channel, 0.3 to 2 m): whitecaps
 * differ in strength, and their outlines fray at every scale down to the billows, so the wave field's texels (0.7 m and
 * more) never show as the polygons their bilinear reconstruction draws. */
const PATCH_SWAY = [.6, 1.4] as const, BILLOW_SWAY = [.55, 1.45] as const;
/** Fresh foam (`WaveSurfaceSample.fresh`: what broke in the last few seconds, per area) over which a whitecap's core goes
 * from nothing to a full sheet: foam breaking now and gathered on its converging crest (up to about 3 on a fold). */
const CORE_START = .85, CORE_FULL = 1.3;
/** Spread fresh foam (its logarithm) over which the share of a pixel whitecap cores cover rises: the drawn core's
 * threshold averaged over the sway, which scales the amount by 0.33–2 (a smoothstep in the logarithm fits it within
 * 0.02). */
const CORE_MEAN_START = Math.log(.49), CORE_MEAN_FULL = Math.log(2.62);
/** Share of its patch a full core covers, and its edge half-width in the lace: aerated water keeps a few holes. */
const CORE_COVER = .9, CORE_EDGE = .25;
/** Foam amount below which a whitecap's patch is clear water, and above which it is fully there: the long, faint rim
 * of old foam fading out around and behind it. A pixel counts toward the whitecaps' area (Monahan's W, measured on
 * photographs by a brightness threshold that leaves the faintest foam out) above PATCH_COUNTED. */
const PATCH_GONE = .01, PATCH_FULL = .3, PATCH_COUNTED = .17;
/** Share of the patch the residue's filaments cover where it thins and where it is full, and their opacity likewise:
 * old foam is lace the sea shows through, fading with its patch instead of ending at a rim. */
const RESIDUE_SPARSE = .25, RESIDUE_COVER = .62, RESIDUE_FAINT = .12, RESIDUE_DENSE = .6;
/** How far the thinnest residue's lace is drawn out along the wind (the old foam's streaks), from none in a full patch. */
const RESIDUE_STREAKING = .4;
/** Brightness of the residue's thinnest filaments relative to its densest (the lace's lowest and highest levels):
 * a film of bubbles is thinner, so lets more of the dark water through, where it thins. */
const RESIDUE_DIM = .7;

/** Dense white water (whitecap cores and churned water): its opacity on its billows, and in the gaps between them,
 * where the churn channel is low, the opacity left, so the bubble-lit turquoise water shows through. Churn levels over
 * which a gap closes. */
const DENSE_OPACITY = .97, THIN_OPACITY = .08, THIN_LOW = .16, THIN_HIGH = .3;
/** Billows in dense white water: brightness in the creases between them (the churn channel's lowest), rising to full
 * over these churn levels, and each billow lit on its sunward side by this much per unit of the channel's rise over
 * EMBOSS_METRES toward the sun. Sunlit foam sits on the tone curve's shoulder, so only deep creases read. */
const CREASE_LIGHT = .82, CREASE_LOW = .3, CREASE_HIGH = .8, EMBOSS_GAIN = 1.5, EMBOSS_METRES = .3;

/** Footprint (m, the pixel's across-view size or a quarter of its along-view size, whichever is larger) over which a
 * whitecap goes from drawn to drawn on its spread foam with the coarse lace, and over which that gives way to the
 * wind's mean coverage: a whitecap smaller than a pixel reads as a faint brightening instead of a fleck. */
const FLECK_START = 1.5, FLECK_END = 4, FAR_START = 8, FAR_END = 20;
/** A whitecap's depth along the wind (m), about the cores' and fresh patches' size across their crests, and its length
 * along them. */
const WHITECAP_DEPTH = 3, WHITECAP_LENGTH = 8;
/** On-screen length (px) over which a whitecap thinner than a pixel row gives way to the wind's mean. Drawn flat on the
 * water, a whitecap seen through binoculars would be a line a hundred pixels long and one tall, where the real breaking
 * face stands up as a short fleck. A chase view's distant whitecaps stay under the start. */
const LINE_START = 20, LINE_END = 60;
/** Gain on the cover of a thin patch of spread whitecaps (none on a full one), for what spreading takes from whitecaps
 * smaller than the spread, which holds the spread path's mean opacity within 15% of the drawn whitecaps' at 9–30 m/s;
 * and the whitecaps' mean opacity over their area far off (a quarter of the light with foam's 0.8 albedo, as
 * Koepke (1984) measured). Both measured with `bun scripts/browser/ocean-waves.ts --coverage`. */
const MEAN_GAIN = 2.2, AREA_OPACITY = .26;
/** Foam a stretched back thins and a converging crest gathers is held within these factors, and their mean over the
 * surface, which the windrows' share is divided by (measured). */
const GATHERED = [.3, 2.2] as const, GATHERED_MEAN = 1.12;

/** The realistic wake's churned water (a sampler with a slick): foam energy over which it goes from clear to its
 * densest, and the edge half-width of its lace. The sampler's eddies already tear its outline. */
const CHURN_START = 0, CHURN_FULL = 1, CHURN_EDGE = .3;

/** Bubble clouds under breaking crests and churned water: the whitecaps' spread bubble amount over which the water turns
 * aerated, and the densest a whitecap's cloud gets relative to a hull's propeller wash (a transient plume, not the
 * continuous churn behind a warship); the wake sampler's densest bubbles; and the most of the way the densest aerated
 * water turns toward the cloud's light. */
const BUBBLE_START = .02, BUBBLE_FULL = .5, WHITECAP_BUBBLES = .45, WAKE_BUBBLES = .6, BUBBLE_STRENGTH = .6;
/** Share of daylight a bubble cloud scatters back up, and the metres of water down to it and back, which take the red
 * first: the pale turquoise under a whitecap and a warship's wake. */
const BUBBLE_ALBEDO = .3, BUBBLE_PATH = 4.5;
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
 * texels, all of it once a pixel averages dozens and the texture reads as its mean. The sampler resolves the pattern
 * down to the pixel's length over its anisotropy, but it averages along that length: a pixel drawn out along a grazing
 * view (binoculars look through strips a tenth of a metre wide and tens of metres long) averages as many of the
 * pattern's features as fit in its area, at least one feature wide. A threshold on that flattened pattern draws hard
 * lines across the view instead of lace. */
export function foamBlur(uv: Vec2): Float {
  const across = dFdx(uv).length().mul(FOAM_TEXELS), down = dFdy(uv).length().mul(FOAM_TEXELS);
  const minor = min(across, down), major = max(across, down);
  const resolved = max(minor, major.div(FOAM_ANISOTROPY)), averaged = max(minor, FOAM_BLUR_START).mul(major).sqrt();
  return smoothstep(FOAM_BLUR_START, FOAM_BLUR_END, max(resolved, averaged));
}

/** The pixel's footprint on the sea at grid point `xz` (m). `size` is its extent across the view or a quarter of its
 * length along it, whichever is larger: past a couple of metres a whitecap is thinner than the pixel's height on screen.
 * `along` is its whole length along the view, which grazing views and binoculars stretch to tens of metres, and
 * `across` its width. */
export function foamFootprint(xz: Vec2): { size: Float; along: Float; across: Float } {
  const across = dFdx(xz).length(), down = dFdy(xz).length();
  return { size: max(min(across, down), max(across, down).div(4)), along: max(across, down), across: min(across, down) };
}

/** The foam texture read at grid point `xz`, `stretch` drawing it out along the wind `wind`: the lace layout's four
 * channels, the old foam's streaked lace, the windrows' band mask and gathering patches, and the churn channel a step
 * toward the sun `sun` (for the billows' relief), with each layout's blur. */
export function foamPatterns(map: Texture, xz: Vec2, wind: Float, stretch: Float, sun: Vec3) {
  const uv = foamLayout(xz, wind, stretch, FOAM_TILE);
  const streakUv = foamLayout(xz, wind, stretch.mul(STREAK_STRETCH), FOAM_TILE * STREAK_SCALE);
  const along = vec2(cos(wind), sin(wind)), cell = xz.div(BAND_WARP_CELL);
  const bandsAt = xz.add(along.mul(noise(cell, 1).sub(.5).mul(2 * BAND_WARP_ALONG)))
    .add(vec2(along.y.negate(), along.x).mul(noise(cell, 2).sub(.5).mul(2 * BAND_WARP_ACROSS)));
  const [nearUv, farUv] = BAND_SCALES.map(scale => foamLayout(bandsAt, wind, stretch.mul(BAND_STRETCH), FOAM_TILE * scale));
  const nearBands = texture(map, nearUv), farBands = texture(map, farUv), coarseBlur = foamBlur(nearUv);
  return {
    pattern: texture(map, uv), blur: foamBlur(uv),
    streaks: texture(map, streakUv).r, streaksBlur: foamBlur(streakUv),
    // The bands and patches give way to their means where the pixel averages them: past the sampler's anisotropy a
    // grazing pixel reads them unfiltered along its length, and the windrows scaled by them drew the texture's tile as
    // a grid toward the horizon.
    lines: mix(nearBands.b, float(map.userData.streakMean), coarseBlur), gather: mix(nearBands.g.add(farBands.g).mul(.5), float(.5), coarseBlur),
    // The windrows' layout is also the coarse lace and churn a whitecap averaged over its pixel is drawn with.
    coarse: nearBands, coarseBlur,
    churnSunward: texture(map, uv.add(sunward(sun, wind, stretch, EMBOSS_METRES, FOAM_TILE))).a,
  };
}

export type FoamPatterns = ReturnType<typeof foamPatterns>;

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

/** The whitecap foam amount `amount` swayed by the broad patches and the billows of the foam texture's `pattern` (none
 * where the pattern is blurred away). */
function swayed(amount: Float, pattern: Node<'vec4'>, blur: Float): Float {
  const sway = mix(PATCH_SWAY[0], PATCH_SWAY[1], pattern.g).mul(mix(BILLOW_SWAY[0], BILLOW_SWAY[1], pattern.a));
  return amount.mul(mix(sway, float(1), blur));
}

/** How much of a whitecap's patch is there at swayed foam amount `amount`, 0–1: the soft rim fading into clear water. */
function whitecapPatch(amount: Float): Float {
  return smoothstep(PATCH_GONE, PATCH_FULL, amount);
}

/** Whether the pixel lies in a whitecap's patch (1) or not (0), for foam `amount` and the lace layout's `pattern`: what
 * the whitecaps' area, Monahan's W, counts. */
export function inWhitecap(amount: Float, pattern: Node<'vec4'>, blur: Float): Float {
  return step(PATCH_COUNTED, swayed(amount, pattern, blur));
}

/** Whitecaps over a pixel too coarse to draw their lace: the drawn model on the foam spread over the pixel
 * (`WaveSurfaceSample.foamMean`) and the fresh foam spread with it (`WaveSurfaceSample.bubbles`), with the lace and
 * churn of the coarse layout (`coarse`, blur `blur`) at the scale the pixel still resolves. Its core covers the drawn
 * core's own mean share, averaged over the sway; a thin patch covers its share times the gain spreading takes from a
 * whitecap smaller than the spread (measured with `bun scripts/browser/ocean-waves.ts --coverage`), a full one none:
 * a large whitecap seen from afar is a marbled patch as bright as its drawn mean, not a white disc. */
export function spreadWhitecaps(mean: Float, meanFresh: Float, coarse: Node<'vec4'>, blur: Float): Float {
  const patch = whitecapPatch(mean);
  const cover = mix(RESIDUE_SPARSE, RESIDUE_COVER, patch).mul(patch.sqrt()).mul(mix(float(MEAN_GAIN), float(1), patch));
  const residue = foamShare(cover, coarse.r, blur, RESIDUE_EDGE).mul(mix(RESIDUE_FAINT, RESIDUE_DENSE, patch));
  const core = smoothstep(CORE_MEAN_START, CORE_MEAN_FULL, meanFresh.max(1e-4).log());
  const coreOpacity = foamShare(core.mul(CORE_COVER), coarse.r, blur, CORE_EDGE).mul(mix(float(RESIDUE_DENSE), denseOpacity(coarse.a, blur), core));
  return max(coreOpacity, residue);
}

/** Mean of dense white water's opacity over the equalised churn channel: THIN_OPACITY plus the rest times
 * E[smoothstep(a, b, U)] for U uniform on [0, 1], which is 1 − b + (b − a) / 2. */
const DENSE_MEAN = THIN_OPACITY + (DENSE_OPACITY - THIN_OPACITY) * (1 - THIN_HIGH + (THIN_HIGH - THIN_LOW) / 2);

/** Opacity of dense white water (whitecap cores, churned water) over its cover: nearly opaque on its billows, thin in
 * the gaps where the churn channel `churn` is low, averaged where the pattern is blurred away. */
function denseOpacity(churn: Float, blur: Float): Float {
  return mix(mix(float(THIN_OPACITY), float(DENSE_OPACITY), smoothstep(THIN_LOW, THIN_HIGH, churn)), float(DENSE_MEAN), blur);
}

/** A whitecap from the wave field's foam at this pixel: `amount` (drawn), `fresh` (its part that broke in the last few
 * seconds), `mean` and `meanFresh` (both spread over the pixel) and `share` (the wind's whitecap area), with the foam
 * texture's `patterns` (`foamPatterns`). Near, a small dense core where the crest breaks now and a larger lacy,
 * streaked, see-through patch around and behind it; a whitecap smaller than its pixel (`footprint.size`, m) turns into
 * the same drawn on its spread foam with the coarse lace, and far off into the wind's mean. A pixel much longer along the
 * view than a whitecap is deep (`footprint.along`) filters the whitecap's amounts down by the share of its length the
 * whitecap covers: the drawn whitecap is thresholded on the undiluted amounts and scaled by that share, so a sliver of
 * foam lights a sliver of the pixel instead of a hard line across a grazing view. Returns the opacity, how much of it is
 * dense core (for the billows), and how far the pixel has gone to a mean: the means are measured over whole whitecaps,
 * the aerated water inside their outline included, so a caller adds no bubble cloud of its own there. */
export function whitecapFoam(amount: Float, fresh: Float, mean: Float, meanFresh: Float, share: Float, patterns: FoamPatterns,
  footprint: { size: Float; along: Float; across: Float }) {
  const { pattern, blur, streaks, streaksBlur, coarse, coarseBlur } = patterns;
  const covered = min(float(1), float(WHITECAP_DEPTH).div(footprint.along.max(1e-3)));
  const inPatch = amount.div(covered), inCore = fresh.div(covered);
  const core = smoothstep(CORE_START, CORE_FULL, swayed(inCore, pattern, blur)), patch = whitecapPatch(swayed(inPatch, pattern, blur));
  const coreOpacity = foamShare(core.mul(CORE_COVER), pattern.r, blur, CORE_EDGE).mul(mix(float(RESIDUE_DENSE), denseOpacity(pattern.a, blur), core));
  // The residue's lace leans toward the wind's streaks as the patch thins: fresh foam is lace, old foam drawn out.
  const lace = mix(pattern.r, streaks, float(1).sub(patch).mul(RESIDUE_STREAKING));
  const residue = foamShare(mix(RESIDUE_SPARSE, RESIDUE_COVER, patch).mul(patch.sqrt()), lace, max(blur, streaksBlur), RESIDUE_EDGE)
    .mul(mix(RESIDUE_FAINT, RESIDUE_DENSE, patch));
  const drawn = max(coreOpacity, residue).mul(covered);
  // Thinner than a pixel row yet many pixels long (binoculars), a whitecap lying flat on the water can only draw a line.
  const rows = float(WHITECAP_DEPTH).div(footprint.along.max(1e-4)), length = float(WHITECAP_LENGTH).div(footprint.across.max(1e-4));
  const line = smoothstep(LINE_START, LINE_END, length).mul(float(1).sub(smoothstep(.5, 1.5, rows)));
  const toMean = smoothstep(FLECK_START, FLECK_END, footprint.size), toFar = max(smoothstep(FAR_START, FAR_END, footprint.size), line);
  const far = share.mul(AREA_OPACITY);
  return { opacity: mix(mix(drawn, spreadWhitecaps(mean, meanFresh, coarse, coarseBlur), toMean), far, toFar), dense: core.mul(float(1).sub(toMean)), averaged: toMean };
}

/** The realistic wake's churned water from its sampler's foam `energy`: the same dense, billowing white water as a
 * whitecap's core, over the cover the sampler's eddies and ramp give it. Returns its opacity and cover. */
export function churnedWater(energy: Float, pattern: Node<'vec4'>, blur: Float) {
  const cover = smoothstep(CHURN_START, CHURN_FULL, energy);
  return { opacity: foamShare(cover, pattern.r, blur, CHURN_EDGE).mul(denseOpacity(pattern.a, blur)), dense: cover };
}

/** Windrows: old foam the wind has gathered into lines along itself, covering `coverage` of the sea. The band mask
 * `lines` (mean `linesMean` at every distance) lays the lines and the patches `gather` crowd them into some stretches
 * of sea; within them the old foam (`lace`, partly drawn out along the wind as `streaks`; blur `blur`) breaks each line
 * into beads and patches of varying width, thicker where the surface converges (`jacobian`), so they ride the waves.
 * Far off they keep their mean. */
export function windrowOpacity(coverage: Float, lines: Float, linesMean: number, gather: Float, lace: Float, streaks: Float, blur: Float, jacobian: Float): Float {
  const gathered = coverage.mul(gather.sub(.5).mul(2 * WINDROW_GATHER).add(1)).mul(lines).div(linesMean);
  const density = clamp(float(1).div(jacobian.max(.05)), GATHERED[0], GATHERED[1]).div(GATHERED_MEAN);
  return foamShare(gathered.min(WINDROW_PEAK), mix(lace, streaks, WINDROW_STREAKING), blur, WINDROW_EDGE).mul(density);
}

/** Mean brightness of dense white water over the equalised churn channel: CREASE_LIGHT plus the rest times
 * E[smoothstep(a, b, U)], which is 1 − b + (b − a) / 2; brightness is divided by it, so billows do not dim the foam. */
const BILLOW_MEAN = CREASE_LIGHT + (1 - CREASE_LIGHT) * (1 - CREASE_HIGH + (CREASE_HIGH - CREASE_LOW) / 2);

/** Brightness of foam relative to its light. Dense white water (as `dense` says) billows: the churn channel `churn`
 * darkens into the creases between billows and each is lit on its sunward side (`churnSunward`, the channel a step
 * toward the sun). Thinner foam dims where its lace `lace` thins. None where the pattern is blurred away. */
export function billows(churn: Float, churnSunward: Float, lace: Float, dense: Float, blur: Float): Float {
  const shade = mix(float(CREASE_LIGHT), float(1), smoothstep(CREASE_LOW, CREASE_HIGH, churn)).div(BILLOW_MEAN);
  const billowed = shade.add(churn.sub(churnSunward).mul(EMBOSS_GAIN)).max(0);
  const film = mix(float(RESIDUE_DIM), float(1), lace).div((1 + RESIDUE_DIM) / 2);
  return mix(float(1), mix(film, billowed, dense), float(1).sub(blur));
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
  const whitecaps = smoothstep(BUBBLE_START, BUBBLE_FULL, bubbles).mul(WHITECAP_BUBBLES);
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
