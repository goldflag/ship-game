import { Color, FloatType, HalfFloatType, LinearFilter, MeshBasicNodeMaterial, NearestFilter, NoBlending, QuadMesh, RedFormat, RenderTarget, RGBAFormat, Vector2, Vector4,
  type Node, type Object3D, type TextureNode, type WebGPURenderer } from 'three/webgpu';
import { Fn, Loop, clamp, dot, exp, float, floor, fract, int, ivec2, max, min, mix, normalize, screenCoordinate, select, smoothstep, sqrt, texture, uniform, uniformArray,
  vec2, vec3, vec4 } from 'three/tsl';
import type { WakeFieldApi, WakeGeneratorOptions, WakeSampler } from '../contracts';
import { dispersionPyramid, type KernelTap } from './kernel';
import { MAX_GENERATORS, WakeGenerators, type WakeEmission } from './generators';

/** Fixed simulation step (s). Frames accumulate time and run whole steps; the sampler blends the last two. */
const STEP = 1 / 30;
/** Steps one frame may run; a longer stall drops the excess instead of catching up. */
const MAX_STEPS = 4;
const GRAVITY = 9.81;
/** The ocean's underwater bound relies on the wake never exceeding this (m). */
const MAX_HEIGHT = 8;
/** The coarsest pyramid level has this many cells per edge, so every tier covers the same wavelengths. */
const COARSEST_CELLS = 32;
/** Share of the field at each edge where extra damping absorbs outgoing waves instead of reflecting them. */
const SPONGE = .06;
const SPONGE_DAMPING = 1.5;
/** Share of the field at each edge over which the sampler fades to calm. */
const EDGE_FADE = .03;
/** Turbulent spreading of wake foam (m²/s), so an old trail is wider than a fresh one. */
const FOAM_SPREAD = 4;
/** Foam per second added where the steepness is twice the break threshold, before `foamStrength`. */
const BREAK_RATE = 1;
/** Footprints narrower than this many cells would alias on the grid. */
const MIN_RADIUS_CELLS = 1.5;

type Loader = (cell: Node<'ivec2'>) => Node<'vec4'>;

/** Clamped texel reads: the pyramid treats the sea beyond the field as continuing the edge value. */
const loader = (node: TextureNode, size: number): Loader => cell => node.load(ivec2(clamp(vec2(cell), 0, size - 1)));

/** Bilinear 2× upsample of a level onto the next finer grid, texel centre aligned: fine texel p lies at
 * coarse coordinate p/2 − 1/4. Matches the collapse the kernels were fitted for. */
function upsample(load: Loader, fine: Node<'ivec2'>): Node<'float'> {
  const coarse = vec2(fine).mul(.5).sub(.25), low = ivec2(floor(coarse)), t = fract(coarse);
  const row = (dy: number) => mix(load(low.add(ivec2(0, dy))).x, load(low.add(ivec2(1, dy))).x, t.x);
  return mix(row(0), row(1), t.y);
}

/** Σ w·u(cell + t), grouping taps of equal weight so each class costs one multiply. */
function convolve(taps: readonly KernelTap[], value: (cell: Node<'ivec2'>) => Node<'float'>, cell: Node<'ivec2'>): Node<'float'> {
  const classes = new Map<number, KernelTap[]>();
  for (const tap of taps) classes.set(tap.weight, [...classes.get(tap.weight) ?? [], tap]);
  const sum = float(0).toVar();
  for (const [weight, members] of classes) {
    let group: Node<'float'> = value(cell.add(ivec2(members[0].x, members[0].y)));
    for (const tap of members.slice(1)) group = group.add(value(cell.add(ivec2(tap.x, tap.y))));
    sum.addAssign(group.mul(weight));
  }
  return sum;
}

function floatTarget(size: number, format: typeof RedFormat | typeof RGBAFormat, type: typeof FloatType | typeof HalfFloatType = FloatType): RenderTarget {
  const filter = type === FloatType ? NearestFilter : LinearFilter;
  return new RenderTarget(size, size, { format, type, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
}

function pass(fragment: Node<'vec4'>): QuadMesh & { material: MeshBasicNodeMaterial } {
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  material.blending = NoBlending; material.toneMapped = false; material.fog = false;
  material.fragmentNode = fragment;
  return new QuadMesh(material) as QuadMesh & { material: MeshBasicNodeMaterial };
}

/** A dispersive height field in the spirit of iWave, centred on a movable anchor. See `README.md`. */
export class WakeField implements WakeFieldApi {
  friction = .065;
  foamStrength = 1.2;
  foamBreakThreshold = .09;
  foamLifetime = 9;
  readonly sampler: WakeSampler;

  private readonly generators = new WakeGenerators();
  private readonly emissions: WakeEmission[] = [];
  /** State (h, h of the previous step, foam, hull pressure head for the next step), ping-pong. */
  private readonly state: [RenderTarget, RenderTarget];
  /** Sampled view of a state: (h, ∂h/∂x, ∂h/∂z, foam) in half float, filterable; previous and current. */
  private readonly display: [RenderTarget, RenderTarget];
  private readonly reduced: RenderTarget[] = [];
  private readonly collapsed: RenderTarget[] = [];
  private readonly passes: { target: () => RenderTarget; quad: ReturnType<typeof pass> }[] = [];
  private readonly stateNode: TextureNode;
  private readonly nextStateNode: TextureNode;
  private readonly currentDisplay: TextureNode;
  private readonly previousDisplay: TextureNode;
  private current = 0;
  private accumulator = 0;
  private active = true;
  private size = 1536;
  /** Field centre requested by `setCenter`, and the whole-cell centre the state content is laid out on. */
  private readonly center = new Vector2();
  private readonly cell = { x: 0, z: 0 };
  private readonly savedClear = new Color();
  private readonly uniforms = {
    cellSize: uniform(1), worldSize: uniform(1), shift: uniform(new Vector2(), 'ivec2'),
    acceleration: uniform(0), damping: uniform(0), foamDecay: uniform(1), foamDiffusion: uniform(0), foamStrength: uniform(0), foamThreshold: uniform(1),
    minRadius: uniform(1), count: uniform(0, 'int'), fraction: uniform(1), gain: uniform(1),
    origin: uniform(new Vector2()), previousOrigin: uniform(new Vector2()),
  };
  /** Per generator and step: swept segment (x0, z0, x1, z1) relative to the field centre, and (radius, depth, gate, 0). */
  private readonly segments = Array.from({ length: MAX_GENERATORS }, () => new Vector4());
  private readonly shapes = Array.from({ length: MAX_GENERATORS }, () => new Vector4());
  private readonly segmentArray = uniformArray<'vec4'>(this.segments, 'vec4');
  private readonly shapeArray = uniformArray<'vec4'>(this.shapes, 'vec4');

  constructor(private readonly renderer: WebGPURenderer, readonly resolution: number) {
    const n = resolution, levels = Math.max(1, Math.round(Math.log2(n / COARSEST_CELLS)));
    const pyramid = dispersionPyramid(levels);
    this.state = [floatTarget(n, RGBAFormat), floatTarget(n, RGBAFormat)];
    this.display = [floatTarget(n, RGBAFormat, HalfFloatType), floatTarget(n, RGBAFormat, HalfFloatType)];
    for (let level = 1; level <= levels; level++) {
      this.reduced[level] = floatTarget(n >> level, RedFormat);
      this.collapsed[level] = floatTarget(n >> level, RedFormat);
    }
    this.stateNode = texture(this.state[0].texture);
    this.nextStateNode = texture(this.state[1].texture);
    this.currentDisplay = texture(this.display[0].texture);
    this.previousDisplay = texture(this.display[1].texture);
    const cell = ivec2(screenCoordinate.xy);
    const u = this.uniforms;

    // Reduce: [1 3 3 1]/8 per axis, from (h + pressure head) at the field's grid down to the coarsest level.
    const binomial = [1, 3, 3, 1];
    for (let level = 1; level <= levels; level++) {
      const source = level === 1 ? loader(this.stateNode, n) : loader(texture(this.reduced[level - 1].texture), n >> (level - 1));
      const value = (p: Node<'ivec2'>) => { const texel = source(p); return level === 1 ? texel.x.add(texel.w) : texel.x; };
      const target = this.reduced[level];
      this.passes.push({ target: () => target, quad: pass(Fn(() => {
        const base = cell.mul(2).sub(1), sum = float(0).toVar();
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) sum.addAssign(value(base.add(ivec2(a, b))).mul(binomial[a] * binomial[b] / 64));
        return vec4(sum, 0, 0, 1);
      })()) });
    }
    // Collapse, coarsest first: each level's kernel plus the upsampled result of the level below it.
    for (let level = levels; level >= 1; level--) {
      const load = loader(texture(this.reduced[level].texture), n >> level), taps = pyramid.levels[level];
      const coarser = level < levels ? loader(texture(this.collapsed[level + 1].texture), n >> (level + 1)) : undefined;
      const target = this.collapsed[level];
      this.passes.push({ target: () => target, quad: pass(Fn(() => {
        const sum = convolve(taps, p => load(p).x, cell);
        if (coarser) sum.addAssign(upsample(coarser, cell));
        return vec4(sum, 0, 0, 1);
      })()) });
    }
    // Step: leapfrog with velocity damping on ∂²h/∂t² + γ∂h/∂t = −g√(−∇²)(h + p/ρg), then foam and this
    // step's generator footprints. A hull is a moving pressure patch: at rest its head p/ρg = depth would
    // settle into a depression of that depth, and in motion it radiates the Kelvin pattern. Its head is
    // stored for the next step (one step late) so the operator can read it at every tap.
    // Reads the previous state shifted by whole cells.
    const state = loader(this.stateNode, n), top = loader(texture(this.collapsed[1].texture), n >> 1);
    this.passes.push({ target: () => this.state[1 - this.current], quad: pass(Fn(() => {
      const source = cell.add(u.shift);
      const inside = source.x.greaterThanEqual(0).and(source.y.greaterThanEqual(0)).and(source.x.lessThan(n)).and(source.y.lessThan(n));
      const center = state(source), h = center.x, previous = center.y, foam = center.z;
      const operator = convolve(pyramid.levels[0], p => { const texel = state(p); return texel.x.add(texel.w); }, source).add(upsample(top, source));
      const texel = vec2(cell), edge = min(min(texel.x, texel.y), float(n - 1).sub(max(texel.x, texel.y)));
      const sponge = float(1).sub(smoothstep(0, n * SPONGE, edge));
      const a = u.damping.add(sponge.mul(sponge).mul(SPONGE_DAMPING * STEP / 2));
      const height = clamp(h.mul(2).sub(float(1).sub(a).mul(previous)).sub(u.acceleration.mul(operator)).div(a.add(1)), -MAX_HEIGHT, MAX_HEIGHT);
      const east = state(source.add(ivec2(1, 0))), west = state(source.add(ivec2(-1, 0)));
      const north = state(source.add(ivec2(0, 1))), south = state(source.add(ivec2(0, -1)));
      const slope = vec2(east.x.sub(west.x), north.x.sub(south.x)).div(u.cellSize.mul(2));
      const spread = east.z.add(west.z).add(north.z).add(south.z).sub(foam.mul(4)).mul(u.foamDiffusion);
      const breaking = max(sqrt(dot(slope, slope)).sub(u.foamThreshold), 0).div(u.foamThreshold).mul(u.foamStrength.mul(BREAK_RATE * STEP));
      // Footprints are laid on the new grid, relative to its centre.
      const position = vec2(cell).add(.5 - n / 2).mul(u.cellSize);
      const head = float(0).toVar(), wash = float(0).toVar();
      Loop({ start: 0, end: u.count, type: 'int' }, ({ i }) => {
        const segment = this.segmentArray.element(i), shape = this.shapeArray.element(i);
        const along = segment.zw.sub(segment.xy), offset = position.sub(segment.xy);
        const t = clamp(dot(offset, along).div(max(dot(along, along), 1e-6)), 0, 1);
        const miss = offset.sub(along.mul(t)), radius = max(shape.x, u.minRadius);
        const footprint = exp(dot(miss, miss).div(radius.mul(radius)).mul(-2));
        head.addAssign(shape.y.mul(footprint));
        wash.assign(max(wash, shape.z.mul(footprint)));
      });
      const hull = wash.mul(u.foamStrength);
      const updated = vec4(height, h, max(foam.add(spread).mul(u.foamDecay).add(breaking), hull), head);
      return select(inside, updated, vec4(0, 0, hull, head));
    })()) });
    // Display: height, central-difference slope and foam of the new state, for filtered sampling.
    const next = loader(this.nextStateNode, n);
    this.passes.push({ target: () => this.display[1 - this.current], quad: pass(Fn(() => {
      const center = next(cell);
      const slope = vec2(next(cell.add(ivec2(1, 0))).x.sub(next(cell.add(ivec2(-1, 0))).x), next(cell.add(ivec2(0, 1))).x.sub(next(cell.add(ivec2(0, -1))).x))
        .div(u.cellSize.mul(2));
      return vec4(center.x, slope, center.z);
    })()) });
    this.sampler = this.createSampler();
    this.restart();
  }

  get enabled(): boolean { return this.active; }
  set enabled(value: boolean) {
    if (value === this.active) return;
    this.active = value;
    this.reset();
  }

  get worldSize(): number { return this.size; }
  set worldSize(value: number) {
    if (value === this.size) return;
    this.size = value;
    this.reset();
  }

  setCenter(x: number, z: number): void { this.center.set(x, z); }
  addGenerator(object: Object3D, options?: WakeGeneratorOptions): number { return this.generators.add(object, options); }
  updateGenerator(id: number, options: WakeGeneratorOptions): boolean { return this.generators.update(id, options); }
  removeGenerator(id: number): boolean { return this.generators.remove(id); }

  reset(): void {
    this.restart();
    const renderer = this.renderer, target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClear);
    try {
      renderer.setClearColor(0, 0);
      for (const clear of [...this.state, ...this.display]) { renderer.setRenderTarget(clear); renderer.clear(); }
    } finally { renderer.setRenderTarget(target); renderer.setClearColor(this.savedClear, alpha); }
  }

  /** Everything `reset` does except clearing the targets (new targets start zeroed). */
  private restart(): void {
    this.generators.restart();
    this.accumulator = 0;
    const u = this.uniforms, cellSize = this.size / this.resolution;
    this.cell.x = Math.round(this.center.x / cellSize); this.cell.z = Math.round(this.center.y / cellSize);
    u.cellSize.value = cellSize; u.worldSize.value = this.size;
    u.origin.value.set(this.cell.x * cellSize, this.cell.z * cellSize);
    u.previousOrigin.value.copy(u.origin.value);
    u.fraction.value = 1;
    u.gain.value = this.active ? 1 : 0;
  }

  step(renderer: WebGPURenderer, dt: number): void {
    if (!this.active || !(dt > 0)) return;
    this.generators.beginFrame();
    const before = this.accumulator;
    this.accumulator += dt;
    const steps = Math.min(Math.floor(this.accumulator / STEP), MAX_STEPS);
    if (steps === MAX_STEPS) this.accumulator = Math.min(this.accumulator, MAX_STEPS * STEP);
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      for (let s = 1; s <= steps; s++) this.advance(renderer, Math.min((s * STEP - before) / dt, 1));
    } finally { renderer.setRenderTarget(target); renderer.autoClear = autoClear; }
    this.accumulator -= steps * STEP;
    this.uniforms.fraction.value = Math.min(this.accumulator / STEP, 1);
  }

  /** One fixed step ending at `fraction` of the current frame. */
  private advance(renderer: WebGPURenderer, fraction: number): void {
    const u = this.uniforms, cellSize = this.size / this.resolution;
    const x = Math.round(this.center.x / cellSize), z = Math.round(this.center.y / cellSize);
    u.shift.value.x = x - this.cell.x; u.shift.value.y = z - this.cell.z;
    this.cell.x = x; this.cell.z = z;
    u.previousOrigin.value.copy(u.origin.value);
    u.origin.value.set(x * cellSize, z * cellSize);
    u.cellSize.value = cellSize; u.worldSize.value = this.size;
    u.acceleration.value = GRAVITY * STEP * STEP / cellSize;
    u.damping.value = Math.max(this.friction, 0) * STEP / 2;
    u.foamDecay.value = Math.exp(-STEP / Math.max(this.foamLifetime, 1e-3));
    u.foamDiffusion.value = Math.min(FOAM_SPREAD * STEP / (cellSize * cellSize), .2);
    u.foamStrength.value = Math.max(this.foamStrength, 0);
    u.foamThreshold.value = Math.max(this.foamBreakThreshold, 1e-4);
    u.minRadius.value = MIN_RADIUS_CELLS * cellSize;
    this.generators.step(fraction, STEP, this.emissions);
    u.count.value = this.emissions.length;
    this.emissions.forEach((e, i) => {
      this.segments[i].set(e.x0 - u.origin.value.x, e.z0 - u.origin.value.y, e.x1 - u.origin.value.x, e.z1 - u.origin.value.y);
      this.shapes[i].set(e.radius, e.depth, e.gate, 0);
    });
    this.stateNode.value = this.state[this.current].texture;
    this.nextStateNode.value = this.state[1 - this.current].texture;
    for (const { target, quad } of this.passes) { renderer.setRenderTarget(target()); quad.render(renderer); }
    this.current = 1 - this.current;
    this.currentDisplay.value = this.display[this.current].texture;
    this.previousDisplay.value = this.display[1 - this.current].texture;
  }

  private createSampler(): WakeSampler {
    const u = this.uniforms;
    /** Both displays at a world point, blended by the step fraction; calm outside the field. */
    const read = (x: Node<'float'>, z: Node<'float'>) => {
      const at = (display: TextureNode, origin: Node<'vec2'>) => {
        const uv = vec2(x, z).sub(origin).div(u.worldSize).add(.5);
        const fade = smoothstep(0, EDGE_FADE, uv.x).mul(smoothstep(0, EDGE_FADE, uv.x.oneMinus()))
          .mul(smoothstep(0, EDGE_FADE, uv.y)).mul(smoothstep(0, EDGE_FADE, uv.y.oneMinus()));
        return display.sample(uv).mul(fade);
      };
      return mix(at(this.previousDisplay, u.previousOrigin), at(this.currentDisplay, u.origin), u.fraction).mul(u.gain);
    };
    return {
      height: (x, z) => read(x, z).x,
      normal: (x, z) => { const slope = read(x, z).yz; return normalize(vec3(slope.x.negate(), 1, slope.y.negate())); },
      foam: (x, z) => max(read(x, z).w, 0),
    };
  }

  dispose(): void {
    for (const target of [...this.state, ...this.display, ...this.reduced.slice(1), ...this.collapsed.slice(1)]) target.dispose();
    for (const { quad } of this.passes) quad.material.dispose();
  }
}
