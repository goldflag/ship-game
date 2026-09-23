import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, type Node, type TextureNode } from 'three/webgpu';
import { Fn, If, abs, exp, exp2, float, floor, fract, ivec2, max, min, mix, select, sin, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { blackbodyColor, colorTemperature, COLOR_INDEX_RANGE, MAX_STARS, STAR_GRID, STAR_TEXTURE, starCatalog, starTexels, WARP, type Star } from './stars';

/** Peak radiance of a magnitude-0 star, and how much of the true brightness range the dome keeps: a factor of
 * 10^(0.4 · COMPRESSION) per magnitude instead of 2.512, so a 6.5 star still shows beside a −1.5 one without
 * the brightest blooming. */
const STAR_PEAK = 1, COMPRESSION = .55;
/** Point spread, in pixels (σ of a Gaussian); bright stars read a little larger. About 1.5 pixels across at
 * half maximum: sharp, yet wide enough that its energy stays constant as it moves between pixels. */
const SPREAD_PX = .62, BRIGHT_SPREAD = .35;
/** Scintillation: relative flicker overhead and at the horizon, where starlight crosses the most air. */
const TWINKLE_ZENITH = .1, TWINKLE_HORIZON = .75;
/** Stars' colour saturation over their blackbody tint: naked-eye star colours are faint, graded up a little. */
const COLOR_SATURATION = 1.35;
/** Colours sampled across B−V. */
const RAMP_SIZE = 64;

export interface StarFieldInputs {
  /** Direction in the galactic frame. */
  readonly galactic: Node<'vec3'>;
  /** World direction (for the twinkle's air mass). */
  readonly direction: Node<'vec3'>;
  /** Radians one pixel spans at this direction. */
  readonly pixelAngle: Node<'float'>;
  /** Faintest magnitude drawn: the tier's catalog, and fewer in twilight. */
  readonly limit: Node<'float'>;
  /** Radiance multiplier: night fade and the binoculars' gain on point sources. */
  readonly gain: Node<'float'>;
  readonly time: Node<'float'>;
}

/** A read that skips the texture's UV matrix (r185 re-enables it on every `sample`/`load` clone). */
function direct<T extends TextureNode>(node: T): T {
  node.updateMatrix = false;
  return node;
}

/** The star catalog as the dome draws it: each pixel finds the one or two stars that can reach it in the two
 * cube grids (`stars.ts`) and adds their point images, evaluated analytically at the pixel's exact direction.
 * Nothing is baked at a resolution, so stars stay pinpoints at any zoom and do not crawl as the view turns. */
export class StarField {
  readonly catalog: readonly Star[] = starCatalog();
  private readonly data = new Uint16Array(STAR_TEXTURE.width * STAR_TEXTURE.height * 4);
  private readonly map = new DataTexture(this.data, STAR_TEXTURE.width, STAR_TEXTURE.height, RGBAFormat, HalfFloatType);
  private readonly ramp: DataTexture;
  private count = 0;

  constructor(count: number) {
    Object.assign(this.map, { minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false, name: 'Star grid' });
    const colors = new Uint16Array(RAMP_SIZE * 4);
    for (let i = 0; i < RAMP_SIZE; i++) {
      const index = COLOR_INDEX_RANGE[0] + (COLOR_INDEX_RANGE[1] - COLOR_INDEX_RANGE[0]) * i / (RAMP_SIZE - 1);
      const rgb = blackbodyColor(colorTemperature(index));
      const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      rgb.forEach((channel, c) => { colors[i * 4 + c] = DataUtils.toHalfFloat(Math.max(0, luminance + (channel - luminance) * COLOR_SATURATION)); });
      colors[i * 4 + 3] = DataUtils.toHalfFloat(1);
    }
    this.ramp = new DataTexture(colors, RAMP_SIZE, 1, RGBAFormat, HalfFloatType);
    Object.assign(this.ramp, { minFilter: LinearFilter, magFilter: LinearFilter, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, generateMipmaps: false, name: 'Star colours' });
    this.ramp.needsUpdate = true;
    this.setCount(count);
  }

  /** Draw the brightest `count` stars. A texture upload, no new pipeline. */
  setCount(count: number): void {
    count = Math.min(count, MAX_STARS);
    if (count === this.count) return;
    this.count = count;
    starTexels(this.catalog, count, this.data);
    this.map.needsUpdate = true;
  }

  /** Radiance of the stars around one direction. Every pixel pays for the cell lookup (a face, a warp and two
   * texel loads); only pixels in an occupied cell go on to the star's image. */
  radiance(input: StarFieldInputs): Node<'vec3'> {
    const n = STAR_GRID.cells, map = texture(this.map), ramp = texture(this.ramp);
    // The warp and its slope: `warp`, `warpSlope` in stars.ts.
    const warp = (u: Node<'float'>) => { const a = abs(u); return u.mul(float(1).sub(a).mul(a.mul(WARP[1]).add(WARP[0])).add(1)); };
    const slope = (u: Node<'float'>) => { const a = abs(u); return a.mul(2 * (WARP[1] - WARP[0])).sub(a.mul(a).mul(3 * WARP[1])).add(1 + WARP[0]); };
    return Fn(() => {
      const g = input.galactic, a = abs(g);
      // `cubeFace` in stars.ts, ties included.
      const xMajor = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
      const yMajor = xMajor.not().and(a.y.greaterThanEqual(a.z));
      const major = select(xMajor, a.x, select(yMajor, a.y, a.z));
      const face = select(xMajor, select(g.x.greaterThanEqual(0), float(0), float(1)),
        select(yMajor, select(g.y.greaterThanEqual(0), float(2), float(3)), select(g.z.greaterThanEqual(0), float(4), float(5)))).toVar();
      const uv = select(xMajor, g.yz, select(yMajor, g.zx, g.xy)).div(major).toVar();
      const grid = vec2(warp(uv.x), warp(uv.y)).add(1).mul(n / 2).toVar();
      const result = vec3(0).toVar();
      const star = (cell: Node<'vec2'>, local: Node<'vec2'>, row: number) => {
        const texel = direct(map.load(ivec2(vec2(face.mul(n + 1).add(cell.x), cell.y.add(row))))).toVar();
        // Magnitude 40 marks an empty cell; stars fainter than the limit fade out over half a magnitude.
        If(texel.z.lessThan(input.limit.add(.5)), () => {
          // Squared angle of the offset from the gnomonic metric: with (du, dv) = (ds/s′(u), dt/s′(v)),
          // [(1 + v²) du² + (1 + u²) dv² − 2uv du dv] / C², C = 1 + u² + v².
          const d = local.sub(texel.xy).mul(2 / n).div(vec2(slope(uv.x), slope(uv.y)));
          const u2 = uv.x.mul(uv.x), v2 = uv.y.mul(uv.y), c = u2.add(v2).add(1);
          const angle2 = v2.add(1).mul(d.x).mul(d.x).add(u2.add(1).mul(d.y).mul(d.y)).sub(uv.x.mul(uv.y).mul(d.x).mul(d.y).mul(2)).div(c.mul(c)).toVar();
          If(angle2.lessThan(STAR_GRID.margin * STAR_GRID.margin), () => {
            const flux = exp2(texel.z.mul(-.4 * COMPRESSION * Math.log2(10))).mul(STAR_PEAK).mul(smoothstep(input.limit.add(.5), input.limit.sub(.5), texel.z));
            const spread = input.pixelAngle.mul(SPREAD_PX).mul(max(float(1), float(1.5).sub(texel.z).mul(BRIGHT_SPREAD).add(1)));
            // Truncated to zero at the margin, where the cell ends: a smooth quartic that leaves the core alone.
            const fall = angle2.div(STAR_GRID.margin * STAR_GRID.margin);
            const image = exp(angle2.div(spread.mul(spread).mul(-2))).mul(fall.mul(fall).oneMinus());
            // Scintillation grows toward the horizon, where starlight crosses the most air.
            const air = smoothstep(0, .5, input.direction.y).oneMinus();
            const seed = fract(texel.xy.mul(vec2(71.37, 23.91)).add(texel.yx.mul(vec2(3.17, 11.3))));
            const flicker = sin(input.time.mul(seed.x.mul(2.3).add(1.9).mul(2 * Math.PI)).add(seed.y.mul(40))).mul(.6)
              .add(sin(input.time.mul(seed.y.mul(2.9).add(3.1).mul(2 * Math.PI)).add(seed.x.mul(57))).mul(.4));
            const twinkle = flicker.mul(mix(float(TWINKLE_ZENITH), float(TWINKLE_HORIZON), air.mul(air))).add(1).max(.15);
            const color = direct(ramp.sample(vec2(texel.w.sub(COLOR_INDEX_RANGE[0]).div(COLOR_INDEX_RANGE[1] - COLOR_INDEX_RANGE[0]), .5)).level(float(0))).rgb;
            result.addAssign(color.mul(flux).mul(image).mul(twinkle));
          });
        });
      };
      // The grid of whole cells, then the grid offset half a cell (its first and last cells are halves).
      const whole = min(floor(grid), float(n - 1));
      star(whole, grid.sub(whole), 0);
      const shifted = grid.add(.5), half = floor(shifted);
      star(half, shifted.sub(half), n + 1);
      return result.mul(input.gain);
    })();
  }

  dispose(): void { this.map.dispose(); this.ramp.dispose(); }
}
