/** GPU half of the wave field: evolves the CPU spectrum to the current time, inverse-transforms
 * every cascade with Stockham fragment passes (float32 render targets, a handful of draws per
 * update), persists crest foam, and serves the surface, vertex and height nodes the other ocean
 * parts sample. */
import { DataTexture, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoBlending, NodeMaterial,
  QuadMesh, RGBAFormat, RenderTarget, RepeatWrapping, Vector2, type Node, type Texture, type WebGPURenderer } from 'three/webgpu';
import { clamp, cos, dFdx, dFdy, exp, float, floor, fract, int, ivec2, log2, max, min, mix, mrt, screenCoordinate, select, sin, smoothstep,
  texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { WaveCascadeInfo, WaveField, WaveFoamParameters, WaveParameters, WaveSurfaceSample } from '../contracts';
import { fftRadices } from './fft';
import { FOLD_PERIOD, buildSpectrum, cascadeBands } from './spectrum';

type Vec4 = Node<'vec4'>;
type Float = Node<'float'>;
type Int = Node<'int'>;
type TextureMap = ReturnType<typeof texture>;
const floatUniform = () => uniform(0);

/** Fields per cascade layer: displacement (Dx, Dy, Dz, ·), derivatives (∂y/∂x, ∂y/∂z, ∂Dx/∂x, ∂Dz/∂z)
 * and extras (∂Dx/∂z, foam, (∂y/∂x)² + (∂y/∂z)², ·). The squared slope is mip-filtered with the slope,
 * so E[s²] − E[s]² is the slope variance inside any pixel's filter footprint (LEAN mapping). */
const FIELDS = ['displacement', 'derivatives', 'extras'] as const;
/** Mip chains stop at this many texels per edge. WebGPU builds every level of every layer in its own
 * render pass, and the tiny levels cost pass overhead only; waves finer than a coarsest texel fade
 * into the slope variance instead (see surface()). */
const COARSEST_TEXELS = 16;
const ANISOTROPY = 16;
/** Crest foam: none while a cascade's Jacobian stays above CREST_START, all of `crestStrength` once it
 * falls to CREST_FULL. A single choppy wave at Stokes' breaking steepness (ka ≈ 0.44) has J ≈ 0.5,
 * so injection sits around breaking crests. Windward foam: downwind faces steeper than FACE_START
 * (slope), full at FACE_FULL. With the game's calibrated gains, surface() averages 0.8% foam at
 * 9 m/s, 4.4% at 15 and 14% at 25, against Monahan & O'Muircheartaigh's whitecap fraction
 * (3.84e-6·U^3.41) of 0.7%, 3.9% and 22%. */
const CREST_START = .6, CREST_FULL = .2;
const FACE_START = .22, FACE_FULL = .5;
/** Whitecaps form on waves near the spectral peak, not on ripples: a cascade injects foam in full once
 * its longest waves reach a third of the peak wavelength, and none below an eighth. */
const WHITECAP_SHORTEST = 1 / 8, WHITECAP_FULL = 1 / 3;
/** Compression of the longer waves (∂Dx/∂x + ∂Dz/∂z) over which a finer cascade's foam fades in. */
const CREST_MODULATION = .1;
/** Folded surfaces keep this much of the Jacobian when correcting slopes, so a fold reads as a
 * steep face instead of an inverted one. */
const MIN_JACOBIAN = .1;
/** Share of the tail (Cox–Munk's slope variance no cascade draws) that roughens the surface. In full it blurred a
 * light air's reflections of clouds into haze, where calm water mirrors them through the drawn waves' speckle. */
const TAIL_ROUGHNESS = .25;
/** heightAt's inversion: at the calibrated 25 m/s storm a quarter of the surface nearly folds, and
 * six steps damped by 0.7 leave a 0.14 m 90th-percentile position residual (three plain steps: 1 m). */
const INVERSION_STEPS = 6, INVERSION_DAMPING = .7;
/** A wake's slick damps waves shorter than this (m): turbulence and the films it brings up still the capillary and
 * short gravity waves, while the swell runs through. Each cascade loses its share of slope in them. */
const SLICK_WAVELENGTH = 25;

/** Share of each cascade's slope in waves shorter than SLICK_WAVELENGTH: the saturation range holds equal slope
 * variance per octave, so it is the share of the band's octaves beyond the cut. */
export function slickShares(cascades: readonly WaveCascadeInfo[]): number[] {
  return cascadeBands(cascades).map((band, i) => {
    const lo = i ? band.lo : 2 * Math.PI / cascades[0].size, cut = Math.max(lo, 2 * Math.PI / SLICK_WAVELENGTH);
    return Math.max(0, Math.log(band.hi / cut) / Math.log(band.hi / lo));
  });
}

/** A texture read without three's uv matrix: a bare texture node's first `.sample()` or `.load()`
 * otherwise gets its own matrix uniform, a per-draw update and a multiply. */
const direct = (node: TextureMap): TextureMap => { node.updateMatrix = false; return node; };

/** Scales a slope or slope variance by what a slick of strength `calm` leaves of waves holding `share` of it in the
 * short waves it damps; without a slick the node is returned untouched. */
type Stilled = <T extends Node<'float'> | Node<'vec2'>>(value: T, share: number) => T;
const slick = (calm?: Float): Stilled => (value, share) => (calm && share > 0 ? value.mul(float(1).sub(calm.mul(share))) : value) as typeof value;

/** e^{iθ}-rotation of two packed complex numbers (xy, zw). */
const rotate = (value: Vec4, c: Float, s: Float): Vec4 => value.mul(c).add(vec4(value.y.negate(), value.x, value.w.negate(), value.z).mul(s));

function passMaterial(output: Node): NodeMaterial {
  const material = new NodeMaterial();
  material.fragmentNode = output;
  material.depthTest = material.depthWrite = false;
  material.blending = NoBlending; material.toneMapped = false; material.fog = false;
  return material;
}

/** Stockham pass input for output j (see fft.ts): first index, and the twiddle step angle. */
function stockham(j: Int, radix: number, span: number) {
  const block = radix * span;
  return { first: j.div(block).mul(span).add(j.mod(span)), angle: float(j.mod(block)).mul(2 * Math.PI / block) };
}

export class GpuWaveField implements WaveField {
  maxHeight = 0;
  maxHorizontalDisplacement = 0;
  private readonly size: number;
  private readonly spectrum: DataTexture;
  /** Frequency-domain atlas (cascades side by side), two packed complex signals per texture. */
  private readonly spectra: [RenderTarget, RenderTarget];
  /** Spatial fields, one array layer per cascade; they alternate so foam reads last frame's. */
  private readonly fields: [RenderTarget, RenderTarget];
  private current = 0;
  private built = false;
  /** Index of the coarsest mip level. */
  private readonly top: number;
  private readonly maps: Record<typeof FIELDS[number], TextureMap>;
  private readonly previousExtras: TextureMap;
  /** Horizontal passes, then all but the last vertical pass; pass t writes spectra[t % 2]. */
  private readonly passes: QuadMesh[] = [];
  /** The last vertical pass, drawn once per cascade layer. */
  private readonly finalPass: QuadMesh;
  /** Longest wavelength each cascade holds (m). */
  private readonly longest: number[];
  /** Tile (m) of the close-range ripples, or 0 where the finest cascade holds the spectral peak (a single cascade). */
  private readonly rippleTile: number;
  private readonly phase = uniform(0);
  private readonly choppiness = uniform(0);
  private readonly elapsed = uniform(0);
  private readonly decay = uniform(1);
  private readonly crest = uniform(0);
  private readonly windward = uniform(0);
  private readonly wind = uniform(new Vector2(1, 0));
  private readonly layer = uniform(0, 'int');
  /** Share of the foam injection the cascade in `layer` receives. */
  private readonly whitecaps = uniform(0);
  private readonly tail = uniform(0);
  /** Each cascade's whole slope variance, which becomes roughness where it cannot be filtered. */
  private readonly slopes: ReturnType<typeof floatUniform>[];
  /** What a slick damps of each cascade (`slickShares`). */
  private readonly slickShares: number[];
  private lastPhase = -1;

  constructor(readonly cascades: readonly WaveCascadeInfo[], readonly params: WaveParameters, readonly foamParams: WaveFoamParameters) {
    const n = cascades[0]?.resolution ?? 0, count = cascades.length;
    if (!count || cascades.some(c => c.resolution !== n)) throw new Error('Wave cascades must share one resolution');
    this.size = n;
    this.top = Math.max(0, Math.log2(n / COARSEST_TEXELS));
    this.slopes = cascades.map(floatUniform);
    const bands = cascadeBands(cascades), finest = bands[count - 1];
    this.longest = bands.map((band, i) => i ? 2 * Math.PI / band.lo : cascades[0].size);
    this.slickShares = slickShares(cascades);
    // Read as many times finer as the finest band spans, the ripples continue it without overlap.
    this.rippleTile = count > 1 ? cascades[count - 1].size * finest.lo / finest.hi : 0;
    this.spectrum = new DataTexture(new Float32Array(n * n * count * 4), n * count, n, RGBAFormat, FloatType);
    this.spectrum.minFilter = this.spectrum.magFilter = NearestFilter;
    const atlas = () => {
      const target = new RenderTarget(n * count, n, { count: 2, type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, generateMipmaps: false });
      target.textures.forEach((t, i) => { t.name = `spectrum${i}`; });
      return target;
    };
    this.spectra = [atlas(), atlas()];
    const layers = () => {
      const target = new RenderTarget(n, n, { depth: count, count: FIELDS.length, type: HalfFloatType, format: RGBAFormat, depthBuffer: false,
        minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, anisotropy: ANISOTROPY, generateMipmaps: false });
      // A render target's `mipmaps` only sets its level count; both backends skip uploads for it.
      target.textures.forEach((t, i) => { t.name = FIELDS[i]; t.mipmaps = Array.from({ length: this.top + 1 }, () => ({ data: new Uint8Array(0), width: 0, height: 0 })); });
      return target;
    };
    this.fields = [layers(), layers()];
    this.maps = { displacement: texture(this.fields[0].textures[0]), derivatives: texture(this.fields[0].textures[1]), extras: texture(this.fields[0].textures[2]) };
    this.previousExtras = texture(this.fields[1].textures[2]);

    // Rows first (the first pass also evolves the spectrum to the current time), then columns;
    // the last column pass resolves one cascade layer at a time.
    const radices = fftRadices(n);
    let span = 1;
    radices.forEach((radix, i) => { this.passes.push(this.pass(i ? this.spectra[(i - 1) % 2].textures : null, radix, span, true)); span *= radix; });
    span = 1;
    radices.slice(0, -1).forEach(radix => {
      const t = this.passes.length;
      this.passes.push(this.pass(this.spectra[(t - 1) % 2].textures, radix, span, false)); span *= radix;
    });
    this.finalPass = new QuadMesh(passMaterial(this.resolve(this.spectra[(this.passes.length - 1) % 2].textures, radices[radices.length - 1], span)));
  }

  /** The latest displacement, derivatives and extras textures (one layer per cascade), for diagnostics. */
  get textures(): readonly Texture[] { return this.fields[this.current].textures; }

  private layered(node: TextureMap, layer: Int): TextureMap { return this.cascades.length > 1 ? node.depth(layer) : node; }

  /** Complex spectra of the eight fields at one atlas texel, packed as four complex signals
   * f + i·g (each IFFT then yields two real fields): (Dx, Dy), (Dz, ∂Dx/∂z), (∂y/∂x, ∂y/∂z),
   * (∂Dx/∂x, ∂Dz/∂z). Choppy displacement is +i·k̂·λ·H so crests sharpen as in Gerstner waves. */
  private evolve(spectrum: TextureMap, column: Int, row: Int, tile: Int, wavenumber: Float): [Vec4, Vec4] {
    const n = this.size, half = int(n / 2);
    const a = direct(spectrum.load(ivec2(tile.mul(n).add(column), row)));
    // H = a·e^{−2πi·m·phase}; m·phase is split as 256·high + low so float32 keeps ~1e-5 of a turn.
    const high = floor(a.z.div(256)), low = a.z.sub(high.mul(256));
    const turn = fract(high.mul(fract(this.phase.mul(256))).add(low.mul(this.phase))).mul(2 * Math.PI);
    const c = cos(turn), s = sin(turn);
    const h = vec2(a.x.mul(c).add(a.y.mul(s)), a.y.mul(c).sub(a.x.mul(s))), ih = vec2(h.y.negate(), h.x);
    const kx = float(select(column.lessThan(half), column, column.sub(n))).mul(wavenumber);
    const kz = float(select(row.lessThan(half), row, row.sub(n))).mul(wavenumber);
    const k = kx.mul(kx).add(kz.mul(kz)).sqrt().max(1e-6), lambda = this.choppiness;
    const x = lambda.mul(kx).div(k), z = lambda.mul(kz).div(k);
    return [
      vec4(ih.mul(x.add(1)), ih.mul(z.mul(float(1).sub(kx)))),
      vec4(ih.mul(kx).sub(h.mul(kz)), h.mul(kx.mul(kx)).add(ih.mul(kz.mul(kz))).mul(lambda.div(k).negate())),
    ];
  }

  /** One radix pass over the atlas; without `inputs` it evolves the spectrum as its input. The
   * radix sum is unrolled: a straight-line shader whose output is the MRT itself. */
  private pass(inputs: Texture[] | null, radix: number, span: number, horizontal: boolean): QuadMesh {
    const n = this.size, pixel = ivec2(screenCoordinate);
    const tile = pixel.x.div(n), { first, angle } = stockham(horizontal ? pixel.x.sub(tile.mul(n)) : pixel.y, radix, span);
    let read: (index: Int) => Vec4[];
    if (inputs) {
      const maps = inputs.map(t => texture(t));
      read = index => maps.map(map => direct(map.load(horizontal ? ivec2(tile.mul(n).add(index), pixel.y) : ivec2(pixel.x, index))) as unknown as Vec4);
    } else {
      const spectrum = texture(this.spectrum), wavenumber = uniformArray(this.cascades.map(c => 2 * Math.PI / c.size), 'float').element(tile) as unknown as Float;
      read = index => this.evolve(spectrum, index, pixel.y, tile, wavenumber);
    }
    const sums: [Vec4, Vec4] = [vec4(0), vec4(0)];
    for (let r = 0; r < radix; r++) {
      const values = read(first.add(r * n / radix));
      const turn = angle.mul(r), c = cos(turn), s = sin(turn);
      sums.forEach((sum, k) => { sums[k] = sum.add(rotate(values[k], c, s)); });
    }
    return new QuadMesh(passMaterial(mrt({ spectrum0: sums[0], spectrum1: sums[1] })));
  }

  /** Last column pass for the cascade in `layer`: spatial fields, slope moments and foam. */
  private resolve(inputs: Texture[], radix: number, span: number): Node {
    const n = this.size, pixel = ivec2(screenCoordinate), maps = inputs.map(t => texture(t));
    const { first, angle } = stockham(pixel.y, radix, span);
    let ab: Vec4 = vec4(0), cd: Vec4 = vec4(0);
    for (let r = 0; r < radix; r++) {
      const at = ivec2(this.layer.mul(n).add(pixel.x), first.add(r * n / radix));
      const turn = angle.mul(r), c = cos(turn), s = sin(turn);
      ab = ab.add(rotate(direct(maps[0].load(at)) as unknown as Vec4, c, s));
      cd = cd.add(rotate(direct(maps[1].load(at)) as unknown as Vec4, c, s));
    }
    const jacobian = cd.z.add(1).mul(cd.w.add(1)).sub(ab.w.mul(ab.w));
    const downwind = cd.x.mul(this.wind.x).add(cd.y.mul(this.wind.y));
    // Crest foam where this cascade nears breaking; windward foam on steep downwind faces.
    const injection = this.crest.mul(float(1).sub(smoothstep(CREST_FULL, CREST_START, jacobian)))
      .add(this.windward.mul(smoothstep(FACE_START, FACE_FULL, downwind.negate()))).mul(this.whitecaps);
    const previous = this.layered(direct(this.previousExtras.load(pixel)), this.layer).y;
    const foam = select(this.elapsed.greaterThan(0), max(previous.mul(exp(this.elapsed.negate().div(this.decay))), injection), previous);
    return mrt({
      displacement: vec4(ab.xyz, 0),
      derivatives: cd,
      extras: vec4(ab.w, foam, cd.x.mul(cd.x).add(cd.y.mul(cd.y)), 0),
    });
  }

  private sample(field: typeof FIELDS[number], xz: Node<'vec2'>, cascade: number, level?: Float): Vec4 {
    const node = this.layered(direct(this.maps[field].sample(xz.div(this.cascades[cascade].size).add(.5 / this.size))), int(cascade));
    return (level ? node.level(level) : node) as unknown as Vec4;
  }

  displacement(xz: Node<'vec2'>, spacing?: Float): Node<'vec3'> {
    return this.cascades.reduce<Node<'vec3'>>((sum, cascade, i) => {
      if (!spacing) return sum.add(this.sample('displacement', xz, i, float(0)).xyz);
      // The mip whose texel matches the vertex spacing; the cascade fades out between four and two
      // vertices per its longest wave, where the mesh can no longer carry any of it.
      const level = clamp(log2(spacing.mul(this.size / cascade.size)), 0, this.top);
      const fade = float(1).sub(smoothstep(this.longest[i] / 4, this.longest[i] / 2, spacing));
      return sum.add(this.sample('displacement', xz, i, level).xyz.mul(fade));
    }, vec3(0));
  }

  surface(xz: Node<'vec2'>, calm?: Float): WaveSurfaceSample {
    // The pixel's footprint on the grid (m), as the anisotropic filter resolves it.
    const across = dFdx(xz).length(), down = dFdy(xz).length();
    const footprint = max(min(across, down), max(across, down).div(ANISOTROPY));
    const stilled = slick(calm);
    let slope: Node<'vec2'> = vec2(0), strain: Node<'vec3'> = vec3(0), foam: Float = float(0), variance: Float = stilled(this.tail, 1);
    this.cascades.forEach((cascade, i) => {
      // A cascade whose waves are finer than its coarsest texel under this pixel fades out over the
      // last level (slopes, strain and foam alike, which would otherwise repeat with the tile); its
      // whole slope variance then roughens the surface instead.
      const detail = float(1).sub(smoothstep(this.top - 1, this.top, log2(footprint.mul(this.size / cascade.size))));
      const derivatives = this.sample('derivatives', xz, i), extras = this.sample('extras', xz, i);
      // Short waves break on the crests of longer ones: finer cascades' foam follows the compression
      // (∂Dx/∂x + ∂Dz/∂z < 0) of the coarser ones summed so far, whose longer tiles also keep a
      // finer tile's few whitecaps from repeating in a visible lattice.
      const crests = i ? smoothstep(CREST_MODULATION, -CREST_MODULATION, strain.x.add(strain.y)) : float(1);
      foam = foam.add(extras.y.mul(detail).mul(crests));
      slope = slope.add(stilled(derivatives.xy.mul(detail), this.slickShares[i]));
      strain = strain.add(vec3(derivatives.zw, extras.x).mul(detail));
      const filtered = max(extras.z.sub(derivatives.x.mul(derivatives.x)).sub(derivatives.y.mul(derivatives.y)), 0);
      variance = variance.add(stilled(mix(this.slopes[i], filtered, detail), this.slickShares[i]));
    });
    // World slope of the displaced surface: the grid slope through the inverse transpose of the
    // horizontal map's Jacobian [[1 + ∂Dx/∂x, ∂Dx/∂z], [∂Dx/∂z, 1 + ∂Dz/∂z]].
    const xx = strain.x.add(1), zz = strain.y.add(1), cross = strain.z;
    const jacobian = xx.mul(zz).sub(cross.mul(cross));
    const world = vec2(zz.mul(slope.x).sub(cross.mul(slope.y)), xx.mul(slope.y).sub(cross.mul(slope.x))).div(max(jacobian, MIN_JACOBIAN));
    const ripples = this.ripples(xz, footprint, stilled);
    return { slope: world.add(ripples.slope), jacobian, foam, slopeVariance: variance.add(ripples.variance) };
  }

  /** Waves shorter than the finest cascade, drawn close to the camera instead of only roughening the reflection.
   * The saturation range is self-similar in slope, so the finest cascade's slopes read as many times finer as its
   * band spans are statistically the band below it (moving slower than their own dispersion would, which close up
   * passes). They show where the pixel resolves them and fade out as the finest cascade's do. `variance` is the
   * change to the total: the share of the tail's roughness they draw as resolved slopes (the game's steep seas can
   * leave no tail; the ripples then only add detail). A single cascade holds the peak, which is not self-similar. */
  private ripples(xz: Node<'vec2'>, footprint: Float, stilled: Stilled): { slope: Node<'vec2'>; variance: Float } {
    if (!this.rippleTile) return { slope: vec2(0), variance: float(0) };
    const finest = this.cascades.length - 1, size = this.rippleTile;
    const level = log2(footprint.mul(this.size / size)).max(0);
    const shown = float(1).sub(smoothstep(this.top - 1, this.top, level));
    const read = this.layered(direct(this.maps.derivatives.sample(xz.div(size).add(.5 / this.size))), int(finest)) as unknown as Vec4;
    // Each mip level averages away about one octave of the band's slopes, which then stay roughness.
    const resolved = float(1).sub(level.div(this.top)).max(0);
    return { slope: stilled(read.xy.mul(shown), 1), variance: stilled(min(this.slopes[finest], this.tail).mul(resolved).mul(shown).negate(), 1) };
  }

  heightAt(xz: Node<'vec2'>): Float {
    // Fixed-point inversion of the choppy map (the grid point whose displaced position is xz),
    // damped after the first step: undamped steps oscillate where storm crests fold.
    const horizontal = (at: Node<'vec2'>) => this.cascades.reduce<Node<'vec2'>>((sum, _, i) => sum.add(this.sample('displacement', at, i, float(0)).xz), vec2(0));
    let grid: Node<'vec2'> = xz;
    for (let step = 0; step < INVERSION_STEPS; step++) {
      const target = xz.sub(horizontal(grid));
      grid = step ? grid.add(target.sub(grid).mul(INVERSION_DAMPING)) : target;
    }
    return this.cascades.reduce<Float>((sum, _, i) => sum.add(this.sample('displacement', grid, i, float(0)).y), float(0));
  }

  update(renderer: WebGPURenderer, time: number, dt: number): void {
    let rebuilt = false;
    if (this.params.dirty || !this.built) {
      const spectrum = buildSpectrum(this.cascades, this.params), n = this.size, count = this.cascades.length;
      const data = this.spectrum.image.data as Float32Array;
      spectrum.cascades.forEach((cascade, c) => {
        for (let z = 0; z < n; z++) data.set(cascade.amplitudes.subarray(z * n * 4, (z + 1) * n * 4), (z * count + c) * n * 4);
        this.slopes[c].value = cascade.slopeVariance;
      });
      this.spectrum.needsUpdate = true;
      this.maxHeight = spectrum.maxHeight; this.maxHorizontalDisplacement = spectrum.maxHorizontalDisplacement;
      this.tail.value = spectrum.tailSlopeVariance * TAIL_ROUGHNESS;
      this.choppiness.value = this.params.choppiness;
      this.wind.value.set(Math.cos(this.params.windDirection), Math.sin(this.params.windDirection));
      this.params.dirty = false; this.built = rebuilt = true;
    }
    const phase = Math.fround((time % FOLD_PERIOD + FOLD_PERIOD) % FOLD_PERIOD / FOLD_PERIOD);
    // A paused frame with nothing changed keeps last frame's fields, foam included.
    if (!rebuilt && dt <= 0 && phase === this.lastPhase) return;
    this.lastPhase = phase; this.phase.value = phase;
    this.elapsed.value = Math.max(0, dt);
    this.decay.value = Math.max(1e-3, this.foamParams.decayTime);
    this.crest.value = this.foamParams.crestStrength; this.windward.value = this.foamParams.windwardStrength;
    const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel(), mrtState = renderer.getMRT();
    try {
      renderer.setMRT(null);
      this.passes.forEach((pass, t) => { renderer.setRenderTarget(this.spectra[t % 2]); pass.render(renderer); });
      const next = this.current ^ 1, output = this.fields[next];
      this.previousExtras.value = this.fields[this.current].textures[2];
      this.cascades.forEach((_, c) => {
        // Mipmaps once per update, after the last layer: generation covers every layer.
        for (const t of output.textures) t.generateMipmaps = c === this.cascades.length - 1;
        this.layer.value = c;
        const ratio = this.longest[c] / this.params.peakWavelength;
        this.whitecaps.value = Math.min(1, Math.max(0, (ratio - WHITECAP_SHORTEST) / (WHITECAP_FULL - WHITECAP_SHORTEST)));
        renderer.setRenderTarget(output, c);
        this.finalPass.render(renderer);
      });
      this.current = next;
      FIELDS.forEach((field, i) => { this.maps[field].value = output.textures[i]; });
    } finally {
      renderer.setRenderTarget(target, face, level); renderer.setMRT(mrtState);
    }
  }

  dispose(): void {
    this.spectrum.dispose();
    for (const target of [...this.spectra, ...this.fields]) target.dispose();
    for (const pass of [...this.passes, this.finalPass]) (pass.material as NodeMaterial).dispose();
  }
}
