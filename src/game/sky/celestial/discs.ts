import type { Node } from 'three/webgpu';
import { Fn, If, dot, exp, float, floor, fract, length, max, min, mix, mx_noise_float, normalize, pow, sin, smoothstep, sqrt, vec2, vec3 } from 'three/tsl';

/** Angular radius (radians) of the sun and the moon: 1 − cos θ = 7.5e-5, a 1.4° disc, as the game has always drawn them. */
export const DISC_RADIUS = Math.sqrt(2 * 7.5e-5);

/** Radiance at the sun's centre per unit of irradiance above the air. The display blooms graded radiance above 2,
 * passing the whole pixel; a physical disc (10⁵ times the sky) would flood the frame. At noon this grades to about
 * 15, white-hot in AgX, and its bloom stays within a disc's width or two. */
const SUN_DISC = 1.35;
/** Limb darkening per channel, I(μ) = 1 − u(1 − μ): the limb is dimmer and redder than the centre. */
const SUN_LIMB = [.5, .6, .72] as const;
/** A thin corona hugging the disc: its brightness at the rim relative to the centre, and its e-folding width. */
const CORONA = .045, CORONA_WIDTH = .2 * Math.PI / 180;
/** The disc's edge, in pixels of blur. */
const EDGE_PX = .8;

/** Moon disc radiance per unit of moonlight (the luminance of `SkyUniforms.moonIrradiance` over the lit share) on
 * a fully lit highland. At full moon the highlands grade just under the bloom threshold, so the maria and rays stay
 * visible instead of clipping to white. */
export const MOON_DISC = 2.8;
/** A tight halo hugging the moon, relative to its surface, and its e-folding width. The glow in the air around
 * it is the atmosphere's. */
export const MOON_HALO = .06;
const MOON_HALO_WIDTH = .12 * Math.PI / 180;

/** Near-side maria in the disc's own frame (x toward the viewer's right, y toward the celestial pole, radius 1), from
 * their selenographic centres projected as the Moon is seen from the northern hemisphere: centre, radii, darkness. */
const MARIA: readonly (readonly [number, number, number, number, number])[] = [
  [-.23, .54, .3, .26, 1], // Imbrium
  [-.72, .2, .19, .42, .82], // Oceanus Procellarum
  [-.52, .02, .22, .28, .78],
  [-.37, -.17, .13, .11, .7], // Cognitum
  [.27, .47, .18, .16, .86], // Serenitatis
  [.5, .15, .24, .19, .95], // Tranquillitatis
  [.8, .29, .09, .14, 1], // Crisium
  [.74, -.15, .12, .24, .82], // Fecunditatis
  [.54, -.27, .1, .1, .82], // Nectaris
  [-.27, -.37, .2, .17, .76], // Nubium
  [-.57, -.41, .1, .1, .9], // Humorum
  [-.02, .82, .45, .06, .72], // Frigoris
  [.06, .24, .09, .07, .8], // Vaporum
  [.03, .04, .07, .05, .6], // Sinus Medii
];
/** Named craters: centre, radius, contrast (positive bright ejecta, negative dark floors). */
const CRATERS: readonly (readonly [number, number, number, number])[] = [
  [-.14, -.69, .025, .75], // Tycho
  [-.34, .17, .027, .45], // Copernicus
  [-.61, .14, .016, .4], // Kepler
  [-.67, .4, .014, .85], // Aristarchus
  [.86, -.15, .025, .3], // Langrenus
  [.7, .27, .012, .5], // Proclus
  [-.1, .78, .025, -.3], // Plato
  [-.93, -.09, .04, -.32], // Grimaldi
];
const TYCHO = [-.14, -.69] as const, COPERNICUS = [-.34, .17] as const;

export interface SunInputs {
  readonly direction: Node<'vec3'>;
  readonly irradiance: Node<'vec3'>;
}

/** Share of the view along `direction` the moon's disc covers (1 inside, 0 outside, anti-aliased over a pixel): it hides
 * the stars, the Milky Way and, at a new moon, the sun behind it. */
export function moonCover(direction: Node<'vec3'>, moon: Node<'vec3'>, pixel: Node<'float'>): Node<'float'> {
  const offset = direction.sub(moon);
  return smoothstep(pixel.mul(-EDGE_PX), pixel.mul(EDGE_PX), sqrt(dot(offset, offset)).sub(DISC_RADIUS).negate());
}

/** Limb-darkened sun and its corona along `direction`, behind the moon; `pixel` is the radians one pixel spans there. */
export function sunDisc(direction: Node<'vec3'>, sun: SunInputs, pixel: Node<'float'>, moon: Node<'vec3'>): Node<'vec3'> {
  const reach = DISC_RADIUS + CORONA_WIDTH * 9;
  return Fn(() => {
    const result = vec3(0).toVar();
    // Chord rather than the dot product's cosine: float32 keeps small angles exact at any zoom.
    const offset = direction.sub(sun.direction), angle2 = dot(offset, offset);
    If(angle2.lessThan(reach * reach), () => {
      const angle = sqrt(angle2), r = min(angle.div(DISC_RADIUS), 1);
      const mu = sqrt(float(1).sub(r.mul(r)));
      const limb = vec3(1).sub(vec3(...SUN_LIMB).mul(float(1).sub(mu)));
      const edge = smoothstep(pixel.mul(-EDGE_PX), pixel.mul(EDGE_PX), angle.sub(DISC_RADIUS).negate());
      const corona = exp(max(angle.sub(DISC_RADIUS), 0).div(-CORONA_WIDTH)).mul(CORONA);
      result.assign(sun.irradiance.mul(limb.mul(edge).add(corona).mul(SUN_DISC)).mul(moonCover(direction, moon, pixel).oneMinus()));
    });
    return result;
  })();
}

/** Albedo of the near side at disc position `p` (radius 1), about 1 in the highlands, with the maria's faint blue
 * cast. `pixels` is the disc's diameter on screen: features smaller than a pixel fade out rather than sparkle. */
function moonAlbedo(p: Node<'vec2'>, pixels: Node<'float'>): Node<'vec3'> {
  const coarse = smoothstep(20, 70, pixels), detail = smoothstep(60, 220, pixels);
  // Ragged shorelines: the maria are drawn in a warped frame, so their outlines lobe and wander.
  const warped = p.add(vec2(mx_noise_float(p.mul(3.1)), mx_noise_float(p.mul(3.1).add(17.3))).mul(.09))
    .add(vec2(mx_noise_float(p.mul(8.3).add(3.7)), mx_noise_float(p.mul(8.3).add(9.1))).mul(.035)).toVar();
  const shore = mx_noise_float(p.mul(12.7).add(4.1)).mul(.1);
  const dark = float(0).toVar();
  for (const [x, y, rx, ry, depth] of MARIA) {
    const e = length(warped.sub(vec2(x, y)).div(vec2(rx, ry))).add(shore);
    dark.assign(max(dark, smoothstep(1.08, .74, e).mul(depth)));
  }
  // Lava flows of different ages: the maria are not one flat shade.
  dark.mulAssign(mx_noise_float(p.mul(6.1).add(11.7)).mul(.16).add(.92));
  // Mottling: rougher ground in the highlands, and finer grain seen through glasses.
  const mottle = mx_noise_float(p.mul(8.3).add(1.3)).mul(.09).mul(coarse).add(mx_noise_float(p.mul(21.5).add(8.2)).mul(.05).mul(detail));
  let albedo: Node<'float'> = float(1).sub(dark.mul(.44)).mul(mottle.add(1));
  for (const [x, y, radius, contrast] of CRATERS) {
    const d = length(p.sub(vec2(x, y)));
    albedo = albedo.add(exp(d.div(radius).pow(2).negate()).mul(contrast).mul(coarse).add(exp(d.div(radius * 3).pow(2).negate()).mul(contrast * .2)));
  }
  // Ray systems of Tycho and Copernicus: streaks in random directions fading with distance.
  const rays = (centre: readonly [number, number], reach: number, strength: number, seed: number) => {
    const v = p.sub(vec2(...centre)), d = length(v);
    const streak = smoothstep(.3, .85, mx_noise_float(vec3(normalize(v).mul(3.9), seed)));
    return streak.mul(exp(d.div(-reach))).mul(smoothstep(.02, .07, d)).mul(strength);
  };
  albedo = albedo.add(rays(TYCHO, .55, .26, 1.7).mul(coarse.mul(.5).add(.5))).add(rays(COPERNICUS, .22, .14, 5.3).mul(coarse));
  // Craters too small to name, seen through glasses: the fresh ones' bright ejecta, of every size, at two scales.
  const ejecta = (scale: number, share: number, seed: number) => {
    const grid = p.mul(scale).add(seed), cell = floor(grid);
    const hash = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453)), size = fract(hash.mul(13.7).add(.31));
    const centre = cell.add(fract(vec2(hash.mul(17.3), hash.mul(29.9))).mul(.6).add(.2));
    const r = length(grid.sub(centre)).div(size.mul(.25).add(.08));
    return exp(r.mul(r).mul(-1.5)).mul(size.mul(.22).add(.08)).mul(smoothstep(1 - share, 1.02 - share, hash));
  };
  const craters = ejecta(21, .22, 0).add(ejecta(53, .15, 7.3)).mul(detail);
  return mix(vec3(1, .98, .95), vec3(.93, .95, 1), dark).mul(albedo.add(craters));
}

export interface MoonInputs {
  readonly direction: Node<'vec3'>;
  /** The disc's own axes in world space: toward the viewer's right, and toward the celestial pole. */
  readonly right: Node<'vec3'>;
  readonly up: Node<'vec3'>;
  /** Toward the sun in the disc's frame (right, up, toward the viewer). */
  readonly sun: Node<'vec3'>;
  /** Radiance of a fully lit highland, facing the sun: the moonlight over its lit share, times `MOON_DISC`. */
  readonly surface: Node<'vec3'>;
  /** Surface brightness at this phase angle relative to full (the opposition effect). */
  readonly phase: Node<'float'>;
  /** Earthshine on the dark side, relative to `surface`: blue-grey, strongest at a thin crescent. */
  readonly earthshine: Node<'vec3'>;
  /** Strength of the tight halo. */
  readonly glow: Node<'float'>;
}

/** The moon along `direction`: a sphere lit by the true sun (so the terminator follows the phase), with a
 * Lommel–Seeliger surface that makes the full moon evenly bright to its limb, a procedural near side, faint
 * earthshine on the dark side and a tight halo. `pixel` is the radians one pixel spans there. */
export function moonDisc(direction: Node<'vec3'>, moon: MoonInputs, pixel: Node<'float'>): Node<'vec3'> {
  const reach = DISC_RADIUS + MOON_HALO_WIDTH * 10;
  return Fn(() => {
    const result = vec3(0).toVar();
    const offset = direction.sub(moon.direction), angle2 = dot(offset, offset);
    If(angle2.lessThan(reach * reach), () => {
      const angle = sqrt(angle2).toVar();
      const edge = smoothstep(pixel.mul(-EDGE_PX), pixel.mul(EDGE_PX), angle.sub(DISC_RADIUS).negate()).toVar();
      result.assign(moon.surface.mul(moon.glow).mul(exp(max(angle.sub(DISC_RADIUS), 0).div(-MOON_HALO_WIDTH))).mul(edge.oneMinus()));
      // The face itself only where the disc covers the pixel: the halo reaches seven times its area.
      If(edge.greaterThan(0), () => {
        const p = vec2(dot(offset, moon.right), dot(offset, moon.up)).div(DISC_RADIUS).toVar();
        const z = sqrt(float(1).sub(dot(p, p)).max(0));
        // Mountains and crater walls catch the light past the terminator and shadow it before: a ragged edge.
        const rough = mx_noise_float(p.mul(9.3).add(2.2)).mul(.03).add(mx_noise_float(p.mul(23.1)).mul(.01));
        const lit = max(dot(vec3(p, z), moon.sun).add(rough), 0);
        // Lommel–Seeliger, cos i / (cos i + cos e), is 1/2 across a full moon; a little Lambert darkens the limb.
        const shade = lit.div(lit.add(z).add(1e-3)).mul(1.7).add(lit.mul(.15));
        const albedo = moonAlbedo(p, pixel.reciprocal().mul(DISC_RADIUS * 2));
        result.addAssign(moon.surface.mul(albedo).mul(moon.earthshine.mul(pow(z, .4)).add(shade.mul(moon.phase))).mul(edge));
      });
    });
    return result;
  })();
}

/** The moon for a blurred bake: a blob of the disc's energy, `spread` radians wide, so a coarse texture cannot miss it. */
export function moonGlow(direction: Node<'vec3'>, moon: Pick<MoonInputs, 'direction' | 'surface' | 'phase'>, lit: Node<'float'>, spread: Node<'float'>): Node<'vec3'> {
  const offset = direction.sub(moon.direction), angle2 = dot(offset, offset);
  // The disc's mean radiance (albedo about 0.8 over maria and highlands) times its solid angle, over the blob's.
  const energy = moon.surface.mul(moon.phase).mul(lit).mul(.8 * DISC_RADIUS * DISC_RADIUS / 2).div(spread.mul(spread));
  return energy.mul(exp(angle2.div(spread.mul(spread).mul(-2))));
}
