/** GPU half of the wave field: evolves the CPU spectrum to the current time, inverse-transforms
 * every cascade with Stockham fragment passes, persists crest foam, and serves the surface,
 * vertex and height nodes the other ocean parts sample. One code path runs on WebGPU and on
 * three's WebGL2 fallback: render-to-texture passes, float32 intermediates, no compute. */
import { DataTexture, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoBlending, NodeMaterial,
  QuadMesh, RGBAFormat, RenderTarget, RepeatWrapping, Vector2, type Node, type Texture, type WebGPURenderer } from 'three/webgpu';
import { clamp, cos, exp, float, floor, fract, int, ivec2, log2, max, mrt, screenCoordinate, select, sin, smoothstep,
  texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { WaveCascadeInfo, WaveField, WaveFoamParameters, WaveParameters, WaveSurfaceSample } from '../contracts';
import { fftRadices } from './fft';
import { FOLD_PERIOD, buildSpectrum, cascadeBands } from './spectrum';

type Vec4 = Node<'vec4'>;
type Float = Node<'float'>;
type Int = Node<'int'>;
type TextureMap = ReturnType<typeof texture>;

/** Fields per cascade layer: displacement (Dx, Dy, Dz, ·), derivatives (∂y/∂x, ∂y/∂z, ∂Dx/∂x, ∂Dz/∂z)
 * and extras (∂Dx/∂z, foam, (∂y/∂x)² + (∂y/∂z)², ·). The squared slope is mip-filtered with the slope,
 * so E[s²] − E[s]² is the slope variance inside any pixel's filter footprint (LEAN mapping). */
const FIELDS = ['displacement', 'derivatives', 'extras'] as const;
/** Full crest-foam injection where a cascade's Jacobian falls to CREST_FULL, none above CREST_START. */
const CREST_START = .7, CREST_FULL = .1;
/** Windward injection on downwind faces steeper than FACE_START (slope), full at FACE_FULL. */
const FACE_START = .2, FACE_FULL = .6;
/** Folded surfaces keep this much of the Jacobian when correcting slopes, so a fold reads as a
 * steep face instead of an inverted one. */
const MIN_JACOBIAN = .1;
/** heightAt's inversion: at the calibrated 25 m/s storm a quarter of the surface nearly folds, and
 * six steps damped by 0.7 leave a 0.14 m 90th-percentile position residual (three plain steps: 1 m). */
const INVERSION_STEPS = 6, INVERSION_DAMPING = .7;

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
  /** Whether each field target has been drawn: its first draw allocates the mip chain. */
  private readonly allocated = [false, false];
  private built = false;
  private readonly maps: Record<typeof FIELDS[number], TextureMap>;
  private readonly previousExtras: TextureMap;
  /** Horizontal passes, then all but the last vertical pass; pass t writes spectra[t % 2]. */
  private readonly passes: QuadMesh[] = [];
  /** The last vertical pass, drawn once per cascade layer. */
  private readonly finalPass: QuadMesh;
  /** Longest wavelength each cascade holds (m). */
  private readonly longest: number[];
  private readonly phase = uniform(0);
  private readonly choppiness = uniform(0);
  private readonly elapsed = uniform(0);
  private readonly decay = uniform(1);
  private readonly crest = uniform(0);
  private readonly windward = uniform(0);
  private readonly wind = uniform(new Vector2(1, 0));
  private readonly layer = uniform(0, 'int');
  private readonly tail = uniform(0);
  private lastPhase = -1;

  constructor(readonly cascades: readonly WaveCascadeInfo[], readonly params: WaveParameters, readonly foamParams: WaveFoamParameters) {
    const n = cascades[0]?.resolution ?? 0, count = cascades.length;
    if (!count || cascades.some(c => c.resolution !== n)) throw new Error('Wave cascades must share one resolution');
    this.size = n;
    this.longest = cascadeBands(cascades).map((band, i) => i ? 2 * Math.PI / band.lo : cascades[0].size);
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
        minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping, anisotropy: 16, generateMipmaps: true });
      target.textures.forEach((t, i) => { t.name = FIELDS[i]; });
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
    const a = spectrum.load(ivec2(tile.mul(n).add(column), row));
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
    const n = this.size, pixel = ivec2(screenCoordinate), maps = inputs?.map(t => texture(t));
    const tile = pixel.x.div(n), { first, angle } = stockham(horizontal ? pixel.x.sub(tile.mul(n)) : pixel.y, radix, span);
    const spectrum = texture(this.spectrum), wavenumber = uniformArray(this.cascades.map(c => 2 * Math.PI / c.size), 'float').element(tile) as unknown as Float;
    const sums: [Vec4, Vec4] = [vec4(0), vec4(0)];
    for (let r = 0; r < radix; r++) {
      const index = first.add(r * n / radix);
      const values = maps ? maps.map(map => map.load(horizontal ? ivec2(tile.mul(n).add(index), pixel.y) : ivec2(pixel.x, index)) as unknown as Vec4)
        : this.evolve(spectrum, index, pixel.y, tile, wavenumber);
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
      ab = ab.add(rotate(maps[0].load(at) as unknown as Vec4, c, s));
      cd = cd.add(rotate(maps[1].load(at) as unknown as Vec4, c, s));
    }
    const jacobian = cd.z.add(1).mul(cd.w.add(1)).sub(ab.w.mul(ab.w));
    const downwind = cd.x.mul(this.wind.x).add(cd.y.mul(this.wind.y));
    // Crest foam where this cascade's surface folds; windward foam on steep downwind faces.
    const injection = this.crest.mul(float(1).sub(smoothstep(CREST_FULL, CREST_START, jacobian)))
      .add(this.windward.mul(smoothstep(FACE_START, FACE_FULL, downwind.negate())));
    const previous = this.layered(this.previousExtras.load(pixel), this.layer).y;
    const foam = select(this.elapsed.greaterThan(0), max(previous.mul(exp(this.elapsed.negate().div(this.decay))), injection), previous);
    return mrt({
      displacement: vec4(ab.xyz, 0),
      derivatives: cd,
      extras: vec4(ab.w, foam, cd.x.mul(cd.x).add(cd.y.mul(cd.y)), 0),
    });
  }

  private sample(field: typeof FIELDS[number], xz: Node<'vec2'>, cascade: number, level?: Float): Vec4 {
    const node = this.layered(this.maps[field].sample(xz.div(this.cascades[cascade].size).add(.5 / this.size)), int(cascade));
    return (level ? node.level(level) : node) as unknown as Vec4;
  }

  displacement(xz: Node<'vec2'>, spacing?: Float): Node<'vec3'> {
    return this.cascades.reduce<Node<'vec3'>>((sum, cascade, i) => {
      if (!spacing) return sum.add(this.sample('displacement', xz, i, float(0)).xyz);
      // The mip whose texel matches the vertex spacing; the cascade fades out between four and two
      // vertices per its longest wave, where the mesh can no longer carry any of it.
      const level = clamp(log2(spacing.mul(this.size / cascade.size)), 0, Math.log2(this.size));
      const fade = float(1).sub(smoothstep(this.longest[i] / 4, this.longest[i] / 2, spacing));
      return sum.add(this.sample('displacement', xz, i, level).xyz.mul(fade));
    }, vec3(0));
  }

  surface(xz: Node<'vec2'>): WaveSurfaceSample {
    let slope: Node<'vec2'> = vec2(0), strain: Node<'vec3'> = vec3(0), foam: Float = float(0), variance: Float = this.tail;
    this.cascades.forEach((_, i) => {
      const derivatives = this.sample('derivatives', xz, i), extras = this.sample('extras', xz, i);
      slope = slope.add(derivatives.xy);
      strain = strain.add(vec3(derivatives.zw, extras.x));
      foam = foam.add(extras.y);
      variance = variance.add(max(extras.z.sub(derivatives.x.mul(derivatives.x)).sub(derivatives.y.mul(derivatives.y)), 0));
    });
    // World slope of the displaced surface: the grid slope through the inverse transpose of the
    // horizontal map's Jacobian [[1 + ∂Dx/∂x, ∂Dx/∂z], [∂Dx/∂z, 1 + ∂Dz/∂z]].
    const xx = strain.x.add(1), zz = strain.y.add(1), cross = strain.z;
    const jacobian = xx.mul(zz).sub(cross.mul(cross));
    const world = vec2(zz.mul(slope.x).sub(cross.mul(slope.y)), xx.mul(slope.y).sub(cross.mul(slope.x))).div(max(jacobian, MIN_JACOBIAN));
    return { slope: world, jacobian, foam, slopeVariance: variance };
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
      });
      this.spectrum.needsUpdate = true;
      this.maxHeight = spectrum.maxHeight; this.maxHorizontalDisplacement = spectrum.maxHorizontalDisplacement;
      this.tail.value = spectrum.tailSlopeVariance;
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
        // Mipmaps once per update, after the last layer: generation covers every layer. A target's
        // first draw keeps them on so the texture is created with its chain. (Not initRenderTarget():
        // on the WebGL fallback it caches a layer's framebuffer under another layer's key.)
        for (const t of output.textures) t.generateMipmaps = c === this.cascades.length - 1 || !this.allocated[next];
        this.layer.value = c;
        renderer.setRenderTarget(output, c);
        this.finalPass.render(renderer);
      });
      this.allocated[next] = true;
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
