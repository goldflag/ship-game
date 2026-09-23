/** GPU half of the wave field: evolves the CPU spectrum to the current time, inverse-transforms
 * every cascade with Stockham fragment passes (float32 render targets, a handful of draws per
 * update), persists crest foam, and serves the surface, vertex and height nodes the other ocean
 * parts sample. */
import { DataTexture, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoBlending, NodeMaterial,
  QuadMesh, RGBAFormat, RenderTarget, RepeatWrapping, Vector2, type Node, type Texture, type WebGPURenderer } from 'three/webgpu';
import { clamp, cos, dFdx, dFdy, exp, float, floor, fract, int, ivec2, log2, max, min, mix, mrt, screenCoordinate, select, sin, smoothstep,
  texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { OceanRealism, WaveCascadeInfo, WaveField, WaveFoamParameters, WaveParameters, WaveSurfaceSample } from '../contracts';
import { fftRadices } from './fft';
import { drawnSea, seaStateCascades } from './seaState';
import { FOLD_PERIOD, buildSpectrum, cascadeBands } from './spectrum';
import { type CascadeBreaking, cascadeBreaking, setBreakingThresholds, whitecapDepth } from './whitecaps';

type Vec4 = Node<'vec4'>;
type Float = Node<'float'>;
type Int = Node<'int'>;
type TextureMap = ReturnType<typeof texture>;
const floatUniform = () => uniform(0);

/** Fields per cascade layer: displacement (Dx, Dy, Dz, ·), derivatives (∂y/∂x, ∂y/∂z, ∂Dx/∂x, ∂Dz/∂z)
 * and extras (∂Dx/∂z, foam, (∂y/∂x)² + (∂y/∂z)², bubbles). The squared slope is mip-filtered with the slope,
 * so E[s²] − E[s]² is the slope variance inside any pixel's filter footprint (LEAN mapping). */
const FIELDS = ['displacement', 'derivatives', 'extras'] as const;
/** Mip chains stop at this many texels per edge. WebGPU builds every level of every layer in its own
 * render pass, and the tiny levels cost pass overhead only; waves finer than a coarsest texel fade
 * into the slope variance instead (see surface()). */
const COARSEST_TEXELS = 16;
const ANISOTROPY = 16;
/** Crest foam (see whitecaps.ts): a cascade's crests break where its standard-normal breaking indicator passes the
 * threshold z the wind's coverage sets; injection ramps from nothing to fresh foam (1) over BREAKING_RAMP / z of the
 * indicator, centred on the threshold, so a whitecap's rim is thinner than its core. A Gaussian field's peaks pass a
 * high threshold by about 1 / z, so the ramp keeps pace and breakers reach full strength alike at every wind. */
const BREAKING_RAMP = 2;
/** A threshold uniform standing for "never breaks". */
const NEVER = 1e4;
/** Short waves break on the crests of longer ones: a finer cascade's foam shows in full where the coarser cascades'
 * compression, in their own standard deviations, passes GATE_FULL and not below GATE_NONE. The longer tiles also
 * keep a finer tile's few whitecaps from repeating in a visible lattice. */
const GATE_NONE = -1, GATE_FULL = .75;
/** The surface's areal compression J that foam density follows is held within these: a fold (J ≤ 0) gathers at
 * most 1 / FOAM_JACOBIAN_MIN, and a stretched back thins foam at most to 1 / FOAM_JACOBIAN_MAX. */
const FOAM_JACOBIAN_MIN = .35, FOAM_JACOBIAN_MAX = 2.5;
/** Bubbles a breaking crest carries down persist like its foam but for this share of the foam's lifetime: the cloud
 * rises and dissolves within about a wave period, while the surface foam it leaves lingers. */
const BUBBLE_LIFE = .5;
/** The bubble cloud is read from a mip whose texels span at least this many metres: bubbles carried down under a
 * whitecap spread about as far again around it. */
const BUBBLE_SPREAD = 4;
/** Folded surfaces keep this much of the Jacobian when correcting slopes, so a fold reads as a
 * steep face instead of an inverted one. */
const MIN_JACOBIAN = .1;
/** Share of the tail (Cox–Munk's slope variance no cascade draws) that roughens the surface. In full it blurred a
 * light air's reflections of clouds into haze, where calm water mirrors them through the drawn waves' speckle. */
const TAIL_ROUGHNESS = .25;
/** heightAt's inversion: at the calibrated 25 m/s storm a quarter of the surface nearly folds, and
 * six steps damped by 0.7 leave a 0.14 m 90th-percentile position residual (three plain steps: 1 m). */
const INVERSION_STEPS = 6, INVERSION_DAMPING = .7;

/** A texture read without three's uv matrix: a bare texture node's first `.sample()` or `.load()`
 * otherwise gets its own matrix uniform, a per-draw update and a multiply. */
const direct = (node: TextureMap): TextureMap => { node.updateMatrix = false; return node; };

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
  /** The sea as drawn: `params` with the realism switch applied. */
  sea: WaveParameters;
  /** Current tiles: the tier's, grown with the sea's peak while `realism.seaState` is on. */
  cascades: readonly WaveCascadeInfo[];
  private seaState: boolean;
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
  /** Each cascade's tile edge (m) and texels per metre; tiles follow the sea state, so shaders read them as uniforms.
   * `this.texels[i]` stands wherever a fixed layout would have `this.size / cascade.size`. */
  private readonly tiles: ReturnType<typeof floatUniform>[];
  private readonly texels: ReturnType<typeof floatUniform>[];
  /** Longest wavelength each cascade holds (m), on the CPU and as uniforms. */
  private longest: number[] = [];
  private readonly longestWaves: ReturnType<typeof floatUniform>[];
  /** Tile (m) of the close-range ripples and its texels per metre; none where the finest cascade holds the spectral
   * peak (a single cascade). */
  private readonly rippleTile = uniform(0);
  private readonly rippleTexels = uniform(0);
  /** Wavenumber step 2π/size of each tile, as the first transform pass reads it. */
  private readonly wavenumbers: ReturnType<typeof uniformArray>;
  private readonly phase = uniform(0);
  private readonly choppiness = uniform(0);
  private readonly elapsed = uniform(0);
  private readonly wind = uniform(new Vector2(1, 0));
  private readonly layer = uniform(0, 'int');
  /** The cascade in `layer`: e-folding lifetime (s) of its foam, weights of its breaking indicator (compression,
   * forward face) and the indicator at which its crests break. */
  private readonly decay = uniform(1);
  private readonly breakingWeights = uniform(new Vector2());
  private readonly breakingThreshold = uniform(NEVER);
  private readonly tail = uniform(0);
  /** Each cascade's whole slope variance, which becomes roughness where it cannot be filtered. */
  private readonly slopes: ReturnType<typeof floatUniform>[];
  /** 1 / the standard deviation of the compression of the cascades coarser than each one (0 for the coarsest). */
  private readonly gates: ReturnType<typeof floatUniform>[];
  /** How each cascade breaks, for the current spectrum. */
  private breaking: CascadeBreaking[] = [];
  private lastPhase = -1;

  /** `tier` is the quality tier's layout; `realism.seaState` is read live, and flipping it rebuilds. */
  constructor(private readonly tier: readonly WaveCascadeInfo[], readonly params: WaveParameters, readonly foamParams: WaveFoamParameters,
    private readonly realism: Pick<OceanRealism, 'seaState'> = { seaState: false }) {
    const n = tier[0]?.resolution ?? 0, count = tier.length;
    if (!count || tier.some(c => c.resolution !== n)) throw new Error('Wave cascades must share one resolution');
    this.size = n;
    this.top = Math.max(0, Math.log2(n / COARSEST_TEXELS));
    this.slopes = tier.map(floatUniform);
    this.gates = tier.map(floatUniform);
    this.tiles = tier.map(floatUniform);
    this.texels = tier.map(floatUniform);
    this.longestWaves = tier.map(floatUniform);
    this.wavenumbers = uniformArray(tier.map(() => 0), 'float');
    this.seaState = realism.seaState;
    this.sea = drawnSea(params, this.seaState);
    this.cascades = tier;
    this.layOut(tier);
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

  /** Point every size-dependent read at a tile layout (same count and resolution as the tier's). */
  private layOut(cascades: readonly WaveCascadeInfo[]): void {
    const bands = cascadeBands(cascades), count = cascades.length, finest = bands[count - 1];
    this.cascades = cascades;
    this.longest = bands.map((band, i) => i ? 2 * Math.PI / band.lo : cascades[0].size);
    cascades.forEach((cascade, i) => {
      this.tiles[i].value = cascade.size;
      this.texels[i].value = this.size / cascade.size;
      this.longestWaves[i].value = this.longest[i];
      this.wavenumbers.array[i] = 2 * Math.PI / cascade.size;
    });
    // Read as many times finer as the finest band spans, the ripples continue it without overlap.
    this.rippleTile.value = count > 1 ? cascades[count - 1].size * finest.lo / finest.hi : 0;
    this.rippleTexels.value = count > 1 ? this.size / this.rippleTile.value : 0;
  }

  private layered(node: TextureMap, layer: Int): TextureMap { return this.tier.length > 1 ? node.depth(layer) : node; }

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
      const spectrum = texture(this.spectrum), wavenumber = this.wavenumbers.element(tile) as unknown as Float;
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
    // Crests break where they are compressed and steep on their forward face (see whitecaps.ts).
    const compression = cd.z.add(cd.w).negate(), face = cd.x.mul(this.wind.x).add(cd.y.mul(this.wind.y)).negate();
    const indicator = compression.mul(this.breakingWeights.x).add(face.mul(this.breakingWeights.y));
    const ramp = float(BREAKING_RAMP / 2).div(this.breakingThreshold.max(1));
    const injection = smoothstep(this.breakingThreshold.sub(ramp), this.breakingThreshold.add(ramp), indicator);
    const previous = this.layered(direct(this.previousExtras.load(pixel)), this.layer);
    const persisted = (last: Float, lifetime: Float): Float => select(this.elapsed.greaterThan(0), max(last.mul(exp(this.elapsed.negate().div(lifetime))), injection), last);
    return mrt({
      displacement: vec4(ab.xyz, 0),
      derivatives: cd,
      extras: vec4(ab.w, persisted(previous.y, this.decay), cd.x.mul(cd.x).add(cd.y.mul(cd.y)), persisted(previous.w, this.decay.mul(BUBBLE_LIFE))),
    });
  }

  private sample(field: typeof FIELDS[number], xz: Node<'vec2'>, cascade: number, level?: Float): Vec4 {
    const node = this.layered(direct(this.maps[field].sample(xz.div(this.tiles[cascade]).add(.5 / this.size))), int(cascade));
    return (level ? node.level(level) : node) as unknown as Vec4;
  }

  displacement(xz: Node<'vec2'>, spacing?: Float): Node<'vec3'> {
    return this.tier.reduce<Node<'vec3'>>((sum, _, i) => {
      if (!spacing) return sum.add(this.sample('displacement', xz, i, float(0)).xyz);
      // The mip whose texel matches the vertex spacing; the cascade fades out between four and two
      // vertices per its longest wave, where the mesh can no longer carry any of it.
      const level = clamp(log2(spacing.mul(this.texels[i])), 0, this.top);
      const fade = float(1).sub(smoothstep(this.longestWaves[i].mul(.25), this.longestWaves[i].mul(.5), spacing));
      return sum.add(this.sample('displacement', xz, i, level).xyz.mul(fade));
    }, vec3(0));
  }

  surface(xz: Node<'vec2'>): WaveSurfaceSample {
    // The pixel's footprint on the grid (m), as the anisotropic filter resolves it.
    const across = dFdx(xz).length(), down = dFdy(xz).length();
    const footprint = max(min(across, down), max(across, down).div(ANISOTROPY));
    let slope: Node<'vec2'> = vec2(0), strain: Node<'vec3'> = vec3(0), foam: Float = float(0), bubbles: Float = float(0), variance: Float = this.tail;
    this.tier.forEach((_, i) => {
      // A cascade whose waves are finer than its coarsest texel under this pixel fades out over the
      // last level (slopes, strain and foam alike, which would otherwise repeat with the tile); its
      // whole slope variance then roughens the surface instead.
      const level = log2(footprint.mul(this.texels[i]));
      const detail = float(1).sub(smoothstep(this.top - 1, this.top, level));
      const derivatives = this.sample('derivatives', xz, i), extras = this.sample('extras', xz, i);
      // A finer cascade's foam shows on the crests of the coarser ones summed so far (their compression is
      // −(∂Dx/∂x + ∂Dz/∂z), gated in its own standard deviations).
      const crests = i ? smoothstep(GATE_NONE, GATE_FULL, strain.x.add(strain.y).mul(this.gates[i]).negate()) : float(1);
      foam = max(foam, extras.y.mul(detail).mul(crests));
      const spread = clamp(max(level, log2(this.texels[i].mul(BUBBLE_SPREAD))), 0, this.top);
      bubbles = max(bubbles, this.sample('extras', xz, i, spread).w.mul(detail).mul(crests));
      slope = slope.add(derivatives.xy.mul(detail));
      strain = strain.add(vec3(derivatives.zw, extras.x).mul(detail));
      const filtered = max(extras.z.sub(derivatives.x.mul(derivatives.x)).sub(derivatives.y.mul(derivatives.y)), 0);
      variance = variance.add(mix(this.slopes[i], filtered, detail));
    });
    // World slope of the displaced surface: the grid slope through the inverse transpose of the
    // horizontal map's Jacobian [[1 + ∂Dx/∂x, ∂Dx/∂z], [∂Dx/∂z, 1 + ∂Dz/∂z]].
    const xx = strain.x.add(1), zz = strain.y.add(1), cross = strain.z;
    const jacobian = xx.mul(zz).sub(cross.mul(cross));
    const world = vec2(zz.mul(slope.x).sub(cross.mul(slope.y)), xx.mul(slope.y).sub(cross.mul(slope.x))).div(max(jacobian, MIN_JACOBIAN));
    const ripples = this.ripples(xz, footprint);
    // Foam rides the water: per area of sea it is as dense as the surface is compressed (1 / J), gathered on
    // converging crests and thinned where their backs stretch.
    const density = foam.div(clamp(jacobian, FOAM_JACOBIAN_MIN, FOAM_JACOBIAN_MAX));
    return { slope: world.add(ripples.slope), jacobian, foam: density, bubbles, slopeVariance: variance.add(ripples.variance) };
  }

  /** Waves shorter than the finest cascade, drawn close to the camera instead of only roughening the reflection.
   * The saturation range is self-similar in slope, so the finest cascade's slopes read as many times finer as its
   * band spans are statistically the band below it (moving slower than their own dispersion would, which close up
   * passes). They show where the pixel resolves them and fade out as the finest cascade's do. `variance` is the
   * change to the total: the share of the tail's roughness they draw as resolved slopes (the game's steep seas can
   * leave no tail; the ripples then only add detail). A single cascade holds the peak, which is not self-similar. */
  private ripples(xz: Node<'vec2'>, footprint: Float): { slope: Node<'vec2'>; variance: Float } {
    if (this.tier.length < 2) return { slope: vec2(0), variance: float(0) };
    const finest = this.tier.length - 1, size = this.rippleTile;
    const level = log2(footprint.mul(this.rippleTexels)).max(0);
    const shown = float(1).sub(smoothstep(this.top - 1, this.top, level));
    const read = this.layered(direct(this.maps.derivatives.sample(xz.div(size).add(.5 / this.size))), int(finest)) as unknown as Vec4;
    // Each mip level averages away about one octave of the band's slopes, which then stay roughness.
    const resolved = float(1).sub(level.div(this.top)).max(0);
    return { slope: read.xy.mul(shown), variance: min(this.slopes[finest], this.tail).mul(resolved).mul(shown).negate() };
  }

  heightAt(xz: Node<'vec2'>): Float {
    // Fixed-point inversion of the choppy map (the grid point whose displaced position is xz),
    // damped after the first step: undamped steps oscillate where storm crests fold.
    const horizontal = (at: Node<'vec2'>) => this.tier.reduce<Node<'vec2'>>((sum, _, i) => sum.add(this.sample('displacement', at, i, float(0)).xz), vec2(0));
    let grid: Node<'vec2'> = xz;
    for (let step = 0; step < INVERSION_STEPS; step++) {
      const target = xz.sub(horizontal(grid));
      grid = step ? grid.add(target.sub(grid).mul(INVERSION_DAMPING)) : target;
    }
    return this.tier.reduce<Float>((sum, _, i) => sum.add(this.sample('displacement', grid, i, float(0)).y), float(0));
  }

  update(renderer: WebGPURenderer, time: number, dt: number): void {
    let rebuilt = false;
    if (this.params.dirty || !this.built || this.realism.seaState !== this.seaState) {
      // The drawn sea and its tiles follow the realism switch; flipping it rebuilds like any change, paused or not.
      this.seaState = this.realism.seaState;
      this.sea = { ...drawnSea(this.params, this.seaState), dirty: false };
      this.layOut(this.seaState ? seaStateCascades(this.tier, this.sea.peakWavelength) : this.tier);
      const spectrum = buildSpectrum(this.cascades, this.sea), n = this.size, count = this.cascades.length;
      const data = this.spectrum.image.data as Float32Array;
      spectrum.cascades.forEach((cascade, c) => {
        for (let z = 0; z < n; z++) data.set(cascade.amplitudes.subarray(z * n * 4, (z + 1) * n * 4), (z * count + c) * n * 4);
        this.slopes[c].value = cascade.slopeVariance;
      });
      this.spectrum.needsUpdate = true;
      this.maxHeight = spectrum.maxHeight; this.maxHorizontalDisplacement = spectrum.maxHorizontalDisplacement;
      this.tail.value = spectrum.tailSlopeVariance * TAIL_ROUGHNESS;
      this.choppiness.value = this.sea.choppiness;
      this.wind.value.set(Math.cos(this.sea.windDirection), Math.sin(this.sea.windDirection));
      this.prepareWhitecaps(spectrum);
      this.params.dirty = false; this.built = rebuilt = true;
    }
    const phase = Math.fround((time % FOLD_PERIOD + FOLD_PERIOD) % FOLD_PERIOD / FOLD_PERIOD);
    // A paused frame with nothing changed keeps last frame's fields, foam included.
    if (!rebuilt && dt <= 0 && phase === this.lastPhase) return;
    this.lastPhase = phase; this.phase.value = phase;
    this.elapsed.value = Math.max(0, dt);
    setBreakingThresholds(this.breaking, whitecapDepth(this.params.windSpeed, this.foamParams.coverageScale));
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
        this.setBreaking(c);
        renderer.setRenderTarget(output, c);
        this.finalPass.render(renderer);
      });
      this.current = next;
      FIELDS.forEach((field, i) => { this.maps[field].value = output.textures[i]; });
    } finally {
      renderer.setRenderTarget(target, face, level); renderer.setMRT(mrtState);
    }
  }

  /** Whitecap statistics of a rebuilt spectrum, from the choppiness and wind the surface is drawn with: how each
   * cascade breaks, and each finer cascade's gate on the coarser cascades' compression (variance: choppiness² × their
   * slope variance). */
  private prepareWhitecaps(spectrum: ReturnType<typeof buildSpectrum>): void {
    const choppiness = Math.max(0, this.choppiness.value), wind = this.wind.value;
    this.breaking = cascadeBreaking(spectrum, wind.x, wind.y, choppiness);
    let coarser = 0;
    spectrum.cascades.forEach((cascade, c) => {
      this.gates[c].value = coarser > 0 ? 1 / Math.sqrt(coarser) : 0;
      coarser += choppiness ** 2 * cascade.slopeVariance;
    });
  }

  /** The resolve pass's foam uniforms for cascade `c`: its breaking indicator, threshold and foam lifetime. */
  private setBreaking(c: number): void {
    const breaking = this.breaking[c];
    this.breakingWeights.value.set(breaking.compression, breaking.face);
    this.breakingThreshold.value = Math.min(NEVER, breaking.threshold);
    this.decay.value = Math.max(1e-3, this.foamParams.lifetime * breaking.period);
  }

  dispose(): void {
    this.spectrum.dispose();
    for (const target of [...this.spectra, ...this.fields]) target.dispose();
    for (const pass of [...this.passes, this.finalPass]) (pass.material as NodeMaterial).dispose();
  }
}
