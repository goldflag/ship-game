import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { sortDescending, sortKeys, writeInstancePose } from './instancePose';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Water-aligned sprites lie flat: a quarter turn about +X. */
const WATER_FACING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** How a slot ranks for reuse: a spent particle first, then the largest share of its life spent. NaN never ranks, and a
 * live particle's infinite share stays below a spent one. */
const claimKey = (age: number, life: number) => {
  if (age >= life) return Infinity;
  const fraction = age / life;
  return fraction !== fraction ? -Infinity : fraction === Infinity ? Number.MAX_VALUE : fraction;
};
/** Speed (m/s) at which a `streak` particle reaches its full smear. */
const STREAK_SPEED = 20;
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), fx),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

/** Original, deterministic density textures. No downloads or canvas/readback needed. */
export function effectTexture(kind: 'smoke' | 'flash' | 'glow' | 'flame' | 'foam' | 'tracer' | 'droplet' | 'water'): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(u, v);
    const coarse = noise(u * 3.8 + 11, v * 3.8 + 31);
    const detail = noise(u * 12 + 71, v * 12 + 53) * .65 + noise(u * 29 + 9, v * 29 + 17) * .35;
    const density = smooth((1 - radius + (coarse - .5) * .5) * 2.8) * (.5 + detail * .5);
    let alpha: number, light: number;
    if (kind === 'water') {
      // Stretched turbulent filaments, with a ragged wet edge. A water sheet
      // must read lengthwise, rather than as another round smoke lobe.
      const strands = noise(u * 13 + 21, v * 6 + 7);
      const fine = noise(u * 39 + 5, v * 23 + 17);
      const edge = 1 - Math.abs(u) + (noise(u * 4 + 9, v * 8 + 3) - .5) * .38;
      alpha = smooth(edge * 5) * (.3 + strands * .5 + fine * .2);
      light = .52 + strands * .32 + fine * .16;
    } else if (kind === 'droplet') {
      alpha = smooth((1 - radius) * 3.5) * (.6 + detail * .4);
      light = clamp(.68 + v * .16 + coarse * .2);
    } else if (kind === 'tracer') {
      // +Y is the shell tip. The hot center narrows and fades toward the tail.
      const along = (v + 1) / 2, width = .12 + along * .7;
      alpha = Math.exp(-((u / width) ** 2) * 4) * smooth(along * 1.3) * smooth((1 - along) * 18);
      light = 1;
    } else if (kind === 'foam') {
      const ring = Math.exp(-(((radius - .69 + (coarse - .5) * .11) / .13) ** 2));
      alpha = ring * (.22 + detail * .78) * smooth((1 - radius) * 9);
      light = .8 + detail * .2;
    } else if (kind === 'flame') {
      // Original upright flame: a broad hot foot and torn, narrowing tongues.
      const along = (v + 1) / 2;
      const bend = Math.sin(along * 8) * .16 * along;
      const width = .65 * (1 - along) + .03;
      const edge = 1 - Math.abs(u - bend) / width + (coarse - .5) * .8;
      alpha = smooth(edge * 2) * smooth(along * 12) * smooth((1 - along) * 6) * (.65 + detail * .35);
      light = 1;
    } else if (kind === 'glow') {
      // A steady, smooth halo, without the turbulent rim of a muzzle flash.
      alpha = Math.exp(-radius * radius * 7) * smooth((1 - radius) * 4);
      light = 1;
    } else if (kind === 'flash') {
      alpha = Math.exp(-radius * radius * 5) * smooth((1 - radius) * 5) * (.55 + density * .45);
      light = 1;
    } else {
      alpha = density * smooth((1 - radius) * 5);
      // A lit upper edge and uneven interior give each lobe depth in daylight.
      light = clamp(.48 + coarse * .34 + detail * .22 + v * .12);
    }
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(light * 255);
    if (kind === 'flame') {
      const along = (v + 1) / 2;
      pixels[i + 1] = Math.round(255 * (.3 + (1 - along) * .65));
      pixels[i + 2] = Math.round(255 * .3 * (1 - along) ** 3);
    }
    pixels[i + 3] = Math.round(alpha * 255);
  }
  const map = new THREE.DataTexture(pixels, size, size);
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true;
  return map;
}

export interface EffectParticle {
  sourceId?: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  age: number;
  life: number;
  size: number;
  growth: number;
  growthDecay: number;
  diffusion: number;
  heat: number;
  cooling: number;
  density: number;
  /** Time scale for thinning after cooling; zero keeps the recipe's density. */
  dissipationTime: number;
  /** Major/minor radius ratio and fixed world direction of an elongated volume.
   * The major radius stays inside the existing sphere/billboard bound. */
  volumeAspect: number;
  volumeYaw: number;
  volumeAxisY: number;
  seed: number;
  opacity: number;
  drag: number;
  gravity: number;
  wind: number;
  angle: number;
  spin: number;
  stretch: number;
  fadeIn: number;
  /** `streak` smears like `velocity` in proportion to speed, so a drop rounds out at its apex. */
  align: 'billboard' | 'velocity' | 'streak' | 'water';
  waterline: boolean;
  surfaceY: number;
}

/** `align` as the pools store it; anything but the three named alignments draws as a billboard. */
const BILLBOARD = 0, VELOCITY = 1, STREAK = 2, WATER = 3;
const ALIGNS = ['billboard', 'velocity', 'streak', 'water'] as const;
const alignCode = (align: string) => align === 'water' ? WATER : align === 'velocity' ? VELOCITY : align === 'streak' ? STREAK : BILLBOARD;
const WATER_X = WATER_FACING.x, WATER_Y = WATER_FACING.y, WATER_Z = WATER_FACING.z, WATER_W = WATER_FACING.w;
/** Floats of one published instance in the shared record scratch: pose, colour, opacity, then the volume's four vec4s. */
const SPRITE_RECORD = 20, VOLUME_RECORD = 36;
let records = new Float32Array(0), recordWords = new Uint32Array(0);
const wordViews = new WeakMap<Float32Array, Uint32Array>();
/** The bits of a float attribute's array, for copying published floats exactly. */
const wordsOf = (array: Float32Array) => {
  let words = wordViews.get(array);
  if (!words) { words = new Uint32Array(array.buffer, array.byteOffset, array.length); wordViews.set(array, words); }
  return words;
};

/** One instance batch per material; fixed storage and back-to-front alpha sorting.
 *
 * Every particle field lives in a typed array indexed by slot. `emit` hands out one staging record per pool: the emitter
 * fills it, and the pool writes it into its slot before anything else reads the arrays (the next `emit`, `advance`,
 * `publish` or `reset`). The record stays tied to that slot until the next `emit`, and `advance` writes the slot's motion
 * back into it, so the particle `emit` returned last reads and changes its slot as a particle object did. */
export class EffectParticlePool {
  readonly mesh: THREE.InstancedMesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly sphere?: THREE.InstancedBufferAttribute;
  private readonly volume?: THREE.InstancedBufferAttribute;
  private readonly tint?: THREE.InstancedBufferAttribute;
  private readonly progress?: THREE.InstancedBufferAttribute;
  // Particle fields by slot: xyz triples for position, velocity and colour, one value per slot for the rest.
  private readonly positions: Float64Array;
  private readonly velocities: Float64Array;
  private readonly colors: Float64Array;
  private readonly ages: Float64Array;
  private readonly lives: Float64Array;
  private readonly sizes: Float64Array;
  private readonly growths: Float64Array;
  private readonly growthDecays: Float64Array;
  private readonly diffusions: Float64Array;
  private readonly heats: Float64Array;
  private readonly coolings: Float64Array;
  private readonly densities: Float64Array;
  private readonly dissipationTimes: Float64Array;
  private readonly volumeAspects: Float64Array;
  private readonly volumeYaws: Float64Array;
  private readonly volumeAxesY: Float64Array;
  private readonly seeds: Float64Array;
  private readonly opacities: Float64Array;
  private readonly drags: Float64Array;
  private readonly gravities: Float64Array;
  private readonly winds: Float64Array;
  private readonly angles: Float64Array;
  private readonly spins: Float64Array;
  private readonly stretches: Float64Array;
  private readonly fadeIns: Float64Array;
  private readonly surfaceYs: Float64Array;
  /** `Math.hypot(1, stretch)`, the reach of the stretched quad's corner, worked out once per particle for culling. */
  private readonly corners: Float64Array;
  private readonly aligns: Uint8Array;
  private readonly waterlines: Uint8Array;
  private readonly sources: (string | undefined)[];
  /** The record `emit` hands out, and the slot it belongs to (-1 before the first emit). */
  private readonly staging: EffectParticle;
  private bound = -1;
  /** A non-finite distance's comparison-sort order. */
  private fallback?: Uint32Array;
  // Instance poses do not need a scene object's synchronized Euler rotation or
  // world-matrix propagation: publish() composes them straight into the buffers.
  private readonly target = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly facing = new THREE.Matrix4();
  private readonly up = THREE.Object3D.DEFAULT_UP.clone();
  private readonly cameraInverse = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private cursor = 0;
  private emitted = 0;
  private drawn = 0;

  constructor(readonly capacity: number, map: THREE.DataTexture, private additive = false,
    volumeMaterial?: THREE.MeshBasicNodeMaterial, private cullFineWater = false, private cullOffscreen = false) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index; geometry.attributes = plane.attributes;
    geometry.instanceCount = 0;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('effectOpacity', this.alpha);
    const material = volumeMaterial ?? new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    material.forceSinglePass = true;
    // The map already contributes its alpha through materialColor.
    material.opacityNode = attribute('effectOpacity', 'float');
    if (volumeMaterial) {
      this.sphere = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      this.volume = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      // Pack shape and lifetime together to stay within WebGPU's
      // eight vertex-buffer limit for the volume's instanced plane.
      this.progress = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('effectSphere', this.sphere);
      geometry.setAttribute('effectVolume', this.volume);
      geometry.setAttribute('effectTint', this.tint);
      geometry.setAttribute('effectProgress', this.progress);
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate before first compilation, including when all particles are inactive.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    // Three r185 sizes the matrix shader buffer from mesh.count at compilation.
    // Keep shader capacity fixed; geometry.instanceCount controls the live draw.
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.frustumCulled = false;
    this.live = new Int32Array(Math.ceil(capacity / 32));
    // An unused slot holds what a fresh particle object held: spent (age 0, life 0), unit size, white.
    const values = (value = 0) => new Float64Array(capacity).fill(value);
    this.positions = new Float64Array(capacity * 3); this.velocities = new Float64Array(capacity * 3); this.colors = new Float64Array(capacity * 3).fill(1);
    this.ages = values(); this.lives = values(); this.sizes = values(1); this.growths = values(); this.growthDecays = values(); this.diffusions = values();
    this.heats = values(); this.coolings = values(1); this.densities = values(4); this.dissipationTimes = values(); this.volumeAspects = values(1);
    this.volumeYaws = values(); this.volumeAxesY = values(); this.seeds = values(); this.opacities = values(1); this.drags = values(); this.gravities = values();
    this.winds = values(); this.angles = values(); this.spins = values(); this.stretches = values(1); this.fadeIns = values(); this.surfaceYs = values();
    this.corners = values(Math.hypot(1, 1));
    this.aligns = new Uint8Array(capacity); this.waterlines = new Uint8Array(capacity); this.sources = new Array<string | undefined>(capacity).fill(undefined);
    this.staging = this.particle(0);
  }

  /** Fraction of requested particles that enter the pool. Skipped requests receive a
   * detached scratch particle so callers keep their emission code unchanged. */
  density = 1;
  private densityPhase = 0;
  private scratch?: EffectParticle;
  /** Instances whose buffer slots may hold a pose: every slot past it is already cleared. */
  private filled = 0;
  /** A max tree over every slot's claim key (`claimKey`), built when a full pool is first searched after `advance`. */
  private claims?: Float64Array;
  private claimLeaves = 0;
  private claimsValid = false;
  /** The slot claimed last. Its caller sets it up after `emit` returns (every emitter finishes one particle before it emits
   * the next), so its key is refreshed on the next claim. */
  private claimed = -1;
  /** One bit per slot that may hold a live particle: set when the slot is claimed, cleared once `advance` finds its particle
   * spent (age >= life), which only a new claim undoes. Both passes visit the set bits in slot order, as they visited every
   * slot, and skip the rest, which the full scan skipped too. */
  private readonly live: Int32Array;

  /** A new particle at `position`. The record returned is the pool's staging record: fill it before the next `emit`. */
  emit(position: THREE.Vector3, sourceId?: string): EffectParticle {
    if (this.density < 1) {
      // A fixed-stride sequence thins every effect evenly, without a random stream.
      this.densityPhase += this.density;
      if (this.densityPhase < 1) return this.scratch ??= { ...this.particle(0), position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color() };
      this.densityPhase -= 1;
    }
    this.commit();
    this.bound = this.claim();
    const p = this.staging;
    p.position.copy(position); p.velocity.set(0, 0, 0); p.color.setRGB(1, 1, 1);
    p.age = 0; p.life = 1; p.size = 1; p.growth = 0; p.opacity = 1;
    p.growthDecay = 0; p.diffusion = 0; p.heat = 0; p.cooling = 1; p.density = 4; p.dissipationTime = 0;
    p.volumeAspect = 1; p.volumeYaw = 0; p.volumeAxisY = 0;
    p.seed = (++this.emitted * .61803398875 % 1) * 100;
    p.drag = 0; p.gravity = 0; p.wind = 0; p.angle = 0; p.spin = 0;
    p.stretch = 1; p.fadeIn = 0; p.align = 'billboard'; p.waterline = false; p.surfaceY = 0;
    p.sourceId = sourceId;
    return p;
  }

  /** A detached copy of slot `index`'s particle. */
  particle(index: number): EffectParticle {
    this.commit();
    const i3 = index * 3;
    return { position: new THREE.Vector3(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]),
      velocity: new THREE.Vector3(this.velocities[i3], this.velocities[i3 + 1], this.velocities[i3 + 2]),
      color: new THREE.Color(this.colors[i3], this.colors[i3 + 1], this.colors[i3 + 2]),
      age: this.ages[index], life: this.lives[index], size: this.sizes[index], growth: this.growths[index], growthDecay: this.growthDecays[index],
      diffusion: this.diffusions[index], heat: this.heats[index], cooling: this.coolings[index], density: this.densities[index],
      dissipationTime: this.dissipationTimes[index], volumeAspect: this.volumeAspects[index], volumeYaw: this.volumeYaws[index],
      volumeAxisY: this.volumeAxesY[index], seed: this.seeds[index], opacity: this.opacities[index], drag: this.drags[index],
      gravity: this.gravities[index], wind: this.winds[index], angle: this.angles[index], spin: this.spins[index], stretch: this.stretches[index],
      fadeIn: this.fadeIns[index], align: ALIGNS[this.aligns[index]], waterline: this.waterlines[index] === 1, surfaceY: this.surfaceYs[index],
      sourceId: this.sources[index] };
  }

  /** Write the staging record into its slot. */
  private commit(): void {
    const i = this.bound;
    if (i < 0) return;
    const p = this.staging, i3 = i * 3, { position, velocity, color } = p;
    this.positions[i3] = position.x; this.positions[i3 + 1] = position.y; this.positions[i3 + 2] = position.z;
    this.velocities[i3] = velocity.x; this.velocities[i3 + 1] = velocity.y; this.velocities[i3 + 2] = velocity.z;
    this.colors[i3] = color.r; this.colors[i3 + 1] = color.g; this.colors[i3 + 2] = color.b;
    this.ages[i] = p.age; this.lives[i] = p.life; this.sizes[i] = p.size; this.growths[i] = p.growth; this.growthDecays[i] = p.growthDecay;
    this.diffusions[i] = p.diffusion; this.heats[i] = p.heat; this.coolings[i] = p.cooling; this.densities[i] = p.density;
    this.dissipationTimes[i] = p.dissipationTime; this.volumeAspects[i] = p.volumeAspect; this.volumeYaws[i] = p.volumeYaw;
    this.volumeAxesY[i] = p.volumeAxisY; this.seeds[i] = p.seed; this.opacities[i] = p.opacity; this.drags[i] = p.drag; this.gravities[i] = p.gravity;
    this.winds[i] = p.wind; this.angles[i] = p.angle; this.spins[i] = p.spin; this.fadeIns[i] = p.fadeIn; this.surfaceYs[i] = p.surfaceY;
    const stretch = p.stretch;
    if (!(this.stretches[i] === stretch)) this.corners[i] = Math.hypot(1, stretch);
    this.stretches[i] = stretch;
    this.aligns[i] = alignCode(p.align); this.waterlines[i] = p.waterline ? 1 : 0; this.sources[i] = p.sourceId;
  }

  /** The next free slot in ring order. A full pool gives up the particle nearest the end of its
   * life, so a burst of short gunfire never cuts a long-lived plume short. */
  private claim(): number {
    const capacity = this.capacity, ages = this.ages, lives = this.lives;
    if (this.claimsValid && this.claimed >= 0) this.updateClaim(this.claimed);
    // The ring usually offers a free slot within a few probes. Past them the tree answers what probing the whole ring
    // would: the first spent slot in ring order, else the first with the largest share of its life spent.
    let chosen = this.cursor % capacity, spent = -Infinity, free = false;
    const probes = Math.min(capacity, 32);
    for (let probe = 0; probe < probes; probe++) {
      const index = (this.cursor + probe) % capacity, age = ages[index], life = lives[index];
      if (age >= life) { chosen = index; free = true; break; }
      const fraction = age / life;
      if (fraction > spent) { spent = fraction; chosen = index; }
    }
    if (!free && probes < capacity) chosen = this.search();
    this.cursor = chosen + 1;
    this.claimed = chosen;
    this.live[chosen >> 5] |= 1 << (chosen & 31);
    return chosen;
  }

  /** Probing the whole ring from the cursor, as a query on the claim tree. */
  private search(): number {
    if (!this.claimsValid) this.buildClaims();
    const start = this.cursor % this.capacity;
    const ahead = this.claimMax(start, this.capacity), behind = start ? this.claimMax(0, start) : -Infinity;
    const best = ahead >= behind ? ahead : behind;
    // Nothing beats the probe's starting -Infinity: it keeps its first slot.
    if (best === -Infinity) return start;
    return this.firstClaim(ahead >= behind ? start : 0, best);
  }

  private buildClaims(): void {
    let leaves = this.claimLeaves;
    if (!this.claims) {
      leaves = 1; while (leaves < this.capacity) leaves *= 2;
      this.claimLeaves = leaves; this.claims = new Float64Array(leaves * 2).fill(-Infinity);
    }
    const tree = this.claims;
    const ages = this.ages, lives = this.lives;
    for (let i = 0; i < this.capacity; i++) tree[leaves + i] = claimKey(ages[i], lives[i]);
    for (let i = leaves - 1; i >= 1; i--) { const a = tree[i * 2], b = tree[i * 2 + 1]; tree[i] = a >= b ? a : b; }
    this.claimsValid = true;
  }

  private updateClaim(index: number): void {
    const tree = this.claims!;
    let i = index + this.claimLeaves;
    tree[i] = claimKey(this.ages[index], this.lives[index]);
    for (i >>= 1; i >= 1; i >>= 1) { const a = tree[i * 2], b = tree[i * 2 + 1]; tree[i] = a >= b ? a : b; }
  }

  /** Largest claim key over slots [from, to). */
  private claimMax(from: number, to: number): number {
    const tree = this.claims!;
    let best = -Infinity;
    for (let lo = from + this.claimLeaves, hi = to + this.claimLeaves; lo < hi; lo >>= 1, hi >>= 1) {
      if (lo & 1) { const key = tree[lo++]; if (key > best) best = key; }
      if (hi & 1) { const key = tree[--hi]; if (key > best) best = key; }
    }
    return best;
  }

  /** First slot at or after `from` whose key reaches `target`, the largest key of a range starting there. */
  private firstClaim(from: number, target: number): number {
    const tree = this.claims!, leaves = this.claimLeaves;
    let i = from + leaves;
    if (!(tree[i] >= target)) {
      for (;;) {
        while (i & 1) i >>= 1;
        if (i === 0) return from;
        i++;
        if (tree[i] >= target) break;
      }
      while (i < leaves) { i *= 2; if (!(tree[i] >= target)) i++; }
    }
    return i - leaves;
  }

  update(dt: number, camera: THREE.Camera, wind: THREE.Vector3, hiddenSourceId?: string): void {
    this.advance(dt, wind);
    this.publish(camera, hiddenSourceId);
  }

  /** Age existing particles before new events are emitted. */
  advance(dt: number, wind: THREE.Vector3): void {
    this.commit();
    this.claimsValid = false;
    const live = this.live, ages = this.ages, lives = this.lives, positions = this.positions, velocities = this.velocities, drags = this.drags;
    const gravities = this.gravities, winds = this.winds, angles = this.angles, spins = this.spins, waterlines = this.waterlines, surfaceYs = this.surfaceYs;
    const windX = wind.x, windZ = wind.z;
    // Most particles of a pool share their drag and the frame's step: their decay is worked out once.
    let memoDrag = NaN, memoStep = NaN, decay = 1, travel = 0;
    for (let word = 0; word < live.length; word++) for (let bits = live[word]; bits;) {
      const bit = bits & -bits, i = (word << 5) + 31 - Math.clz32(bit);
      bits ^= bit;
      const previousAge = ages[i], life = lives[i];
      if (previousAge >= life) { live[word] &= ~bit; continue; }
      const age = previousAge + dt;
      ages[i] = age;
      if (age < 0) continue;
      if (age >= life) { live[word] &= ~bit; continue; }
      const step = Math.min(dt, age); // A delayed spray starts partway through the frame.
      if (step > 0) {
        const drag = drags[i], gravity = gravities[i], i3 = i * 3;
        if (drag !== memoDrag || step !== memoStep) {
          memoDrag = drag; memoStep = step;
          decay = Math.exp(-drag * step);
          travel = drag > .0001 ? (1 - decay) / drag : step;
        }
        // Integrate gravity with drag analytically, so spray apex/fall is frame-rate independent.
        const terminal = drag > .0001 ? gravity / drag : 0, w = winds[i], vx = velocities[i3], vy = velocities[i3 + 1], vz = velocities[i3 + 2];
        positions[i3] += vx * travel + windX * w * step;
        positions[i3 + 2] += vz * travel + windZ * w * step;
        const y = positions[i3 + 1] += drag > .0001 ? (vy + terminal) * travel - terminal * step : vy * step - .5 * gravity * step * step;
        velocities[i3] = vx * decay; velocities[i3 + 2] = vz * decay;
        velocities[i3 + 1] = drag > .0001 ? (vy + terminal) * decay - terminal : vy - gravity * step;
        angles[i] += spins[i] * step;
        if (waterlines[i] && y < surfaceYs[i] + .2 && previousAge >= 0) { ages[i] = life; live[word] &= ~bit; continue; }
      }
    }
    // The staging record follows its slot's motion.
    const i = this.bound;
    if (i >= 0) {
      const p = this.staging, i3 = i * 3;
      p.age = ages[i]; p.angle = angles[i];
      p.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]); p.velocity.set(velocities[i3], velocities[i3 + 1], velocities[i3 + 2]);
    }
  }

  /** Build the sorted instance buffers once, after all emissions for this frame. Poses go straight into the instance
   * arrays through three's own arithmetic (the quaternion product, then `Matrix4.compose`), so every float is the same.
   * One pass in slot order culls, keys and composes each drawn particle into a record; the sort then moves whole records. */
  publish(camera: THREE.Camera, hiddenSourceId?: string): void {
    this.commit();
    const cameraRotation = camera.quaternion, qx = cameraRotation.x, qy = cameraRotation.y, qz = cameraRotation.z, qw = cameraRotation.w;
    // The camera's inverse rotation, as Quaternion.invert() makes it.
    const ix = qx * -1, iy = qy * -1, iz = qz * -1, iw = qw;
    this.cameraInverse.set(ix, iy, iz, iw);
    const perspective = !!(camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const cull = this.cullOffscreen && perspective, volumes = !!this.sphere, fineWater = this.cullFineWater && perspective;
    const cameraPosition = camera.position, cx = cameraPosition.x, cy = cameraPosition.y, cz = cameraPosition.z;
    const planes = this.frustum.planes;
    if (cull) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    // Plane.distanceToPoint(p) is normal.dot(p) + constant, summed in this order.
    const n0 = planes[0].normal, n1 = planes[1].normal, n2 = planes[2].normal, n3 = planes[3].normal, n4 = planes[4].normal, n5 = planes[5].normal;
    const n0x = n0.x, n0y = n0.y, n0z = n0.z, c0 = planes[0].constant, n1x = n1.x, n1y = n1.y, n1z = n1.z, c1 = planes[1].constant;
    const n2x = n2.x, n2y = n2.y, n2z = n2.z, c2 = planes[2].constant, n3x = n3.x, n3y = n3.y, n3z = n3.z, c3 = planes[3].constant;
    const n4x = n4.x, n4y = n4.y, n4z = n4.z, c4 = planes[4].constant, n5x = n5.x, n5y = n5.y, n5z = n5.z, c5 = planes[5].constant;
    const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements;
    const projectionX = projection[0], projectionY = projection[5];
    const ages = this.ages, lives = this.lives, sources = this.sources, positions = this.positions, velocities = this.velocities, colors = this.colors;
    const sizes = this.sizes, growths = this.growths, growthDecays = this.growthDecays, diffusions = this.diffusions, corners = this.corners;
    const opacities = this.opacities, fadeIns = this.fadeIns, angles = this.angles, stretches = this.stretches, aligns = this.aligns;
    const coolings = this.coolings, dissipationTimes = this.dissipationTimes, seeds = this.seeds, heats = this.heats, densities = this.densities;
    const volumeAspects = this.volumeAspects, volumeYaws = this.volumeYaws, volumeAxesY = this.volumeAxesY;
    const record = volumes ? VOLUME_RECORD : SPRITE_RECORD;
    if (records.length < this.capacity * record) { records = new Float32Array(this.capacity * record); recordWords = new Uint32Array(records.buffer); }
    const out = records, keys = sortKeys(this.capacity), live = this.live;
    const facing = volumes && perspective;
    let finite = true, count = 0;
    for (let word = 0; word < live.length; word++) for (let bits = live[word]; bits;) {
      const bit = bits & -bits, i = (word << 5) + 31 - Math.clz32(bit);
      bits ^= bit;
      const age = ages[i], life = lives[i];
      if (age < 0 || age >= life) continue;
      // Hidden smoke still ages and drifts, so leaving optics restores its current state.
      if (hiddenSourceId !== undefined && sources[i] === hiddenSourceId) continue;
      const i3 = i * 3, x = positions[i3], y = positions[i3 + 1], z = positions[i3 + 2];
      if (cull) {
        // Linear growth bounds the decaying expansion. Include the full rotated
        // quad and stretch; particles outside still age and drift in advance().
        const size = Math.max(.01, sizes[i] + Math.max(0, growths[i]) * age + Math.max(0, diffusions[i]) * age);
        const reach = -(size * .5 * corners[i]);
        // Volume rays start at the camera, including gas inside the near
        // plane. Only the four side planes can reject their bounding sphere;
        // the fragment shader owns depth clipping against the captured scene.
        if (n0x * x + n0y * y + n0z * z + c0 < reach || n1x * x + n1y * y + n1z * z + c1 < reach
          || n2x * x + n2y * y + n2z * z + c2 < reach || n3x * x + n3y * y + n3z * z + c3 < reach) continue;
        if (!volumes && (n4x * x + n4y * y + n4z * z + c4 < reach || n5x * x + n5y * y + n5z * z + c5 < reach)) continue;
      }
      if (fineWater) {
        // The view-space position, as Vector3.applyMatrix4 computes it.
        const w = 1 / (view[3] * x + view[7] * y + view[11] * z + view[15]);
        const vx = (view[0] * x + view[4] * y + view[8] * z + view[12]) * w;
        const vy = (view[1] * x + view[5] * y + view[9] * z + view[13]) * w;
        const vz = (view[2] * x + view[6] * y + view[10] * z + view[14]) * w;
        const depth = -vz, radius = sizes[i] + growths[i] * age;
        if (depth + radius < .1 || Math.abs(vx) > Math.max(0, depth) / projectionX + radius
          || Math.abs(vy) > Math.max(0, depth) / projectionY + radius
          || radius * projectionY / Math.max(1, depth) < .0007) continue;
      }
      const dx = x - cx, dy = y - cy, dz = z - cz, distance = dx * dx + dy * dy + dz * dz;
      if (!Number.isFinite(distance)) finite = false;
      keys[count] = distance;
      const o = count++ * record;
      const t = age / life, fadeIn = fadeIns[i];
      const fade = (1 - smooth((t - .18) / .82)) * (fadeIn > 0 ? smooth(age / fadeIn) : 1);
      const growthDecay = growthDecays[i];
      const expansion = growthDecay > 0 ? (1 - Math.exp(-age * growthDecay)) / growthDecay : age;
      const size = Math.max(.01, sizes[i] + growths[i] * expansion + diffusions[i] * age);
      let px = x, py = y, pz = z, ox: number, oy: number, oz: number, ow: number, sx: number, sy: number;
      if (facing) {
        const radiusSq = size * size / 4, orientation = this.orientation;
        if (distance > radiusSq * 1.01) {
          // A sphere's perspective silhouette extends beyond a diameter-sized
          // billboard. Face its center and bound the camera's tangent cone.
          orientation.setFromRotationMatrix(this.facing.lookAt(cameraPosition, this.target.set(x, y, z), this.up));
          sx = sy = size * Math.sqrt(distance / (distance - radiusSq));
        } else {
          // Inside the volume, every screen ray may intersect gas. Cover the
          // viewport at a valid clip depth; the shader still uses the real sphere.
          orientation.copy(cameraRotation);
          // Mid-clip depth stays inside the frustum with standard AND reversed
          // depth; zero lies on the far plane when reversed depth is active.
          const center = this.center.set(0, 0, .5).unproject(camera);
          px = center.x; py = center.y; pz = center.z;
          this.direction.set(1, 1, .5).unproject(camera).sub(center).applyQuaternion(this.cameraInverse);
          sx = Math.abs(this.direction.x) * 2; sy = Math.abs(this.direction.y) * 2;
        }
        ox = orientation.x; oy = orientation.y; oz = orientation.z; ow = orientation.w;
      } else {
        const align = aligns[i];
        let angle = angles[i], stretch = stretches[i], ax = qx, ay = qy, az = qz, aw = qw;
        if (align === WATER) { ax = WATER_X; ay = WATER_Y; az = WATER_Z; aw = WATER_W; }
        else if (align !== BILLBOARD) {
          // The velocity in camera space, as Vector3.applyQuaternion turns it.
          const vx = velocities[i3], vy = velocities[i3 + 1], vz = velocities[i3 + 2];
          const tx = 2 * (iy * vz - iz * vy), ty = 2 * (iz * vx - ix * vz), tz = 2 * (ix * vy - iy * vx);
          const dx = vx + iw * tx + iy * tz - iz * ty, dy = vy + iw * ty + iz * tx - ix * tz;
          angle = Math.atan2(-dx, dy);
          const speed = Math.max(.01, Math.sqrt(vx * vx + vy * vy + vz * vz)), across = Math.hypot(dx, dy) / speed;
          // An exposure smear grows with speed and foreshortens; the drop itself stays round.
          if (align === STREAK) stretch = 1 + (stretch - 1) * Math.min(1, speed / STREAK_SPEED) * across;
          else stretch *= Math.max(.35, across);
        }
        // Then the roll about the view axis: Quaternion.setFromAxisAngle((0, 0, 1), angle) and multiplyQuaternions.
        const half = angle / 2, s = Math.sin(half), bx = 0 * s, by = 0 * s, bz = 1 * s, bw = Math.cos(half);
        ox = ax * bw + aw * bx + ay * bz - az * by;
        oy = ay * bw + aw * by + az * bx - ax * bz;
        oz = az * bw + aw * bz + ax * by - ay * bx;
        ow = aw * bw - ax * bx - ay * by - az * bz;
        sx = size; sy = size * stretch;
      }
      writeInstancePose(out, o, px, py, pz, ox, oy, oz, ow, sx, sy, 1);
      const r = colors[i3], g = colors[i3 + 1], b = colors[i3 + 2];
      out[o + 16] = r; out[o + 17] = g; out[o + 18] = b;
      out[o + 19] = opacities[i] * fade;
      if (volumes) {
        const cooling = coolings[i], dissipationTime = dissipationTimes[i];
        out[o + 20] = x; out[o + 21] = y; out[o + 22] = z; out[o + 23] = size / 2;
        out[o + 24] = age; out[o + 25] = seeds[i]; out[o + 26] = heats[i] * (1 - smooth(age / cooling)); out[o + 27] = densities[i];
        // The narrow jet gradually opens into billows; freeze its launch axis
        // instead of snapping it toward gravity as the initial velocity decays.
        out[o + 28] = r; out[o + 29] = g; out[o + 30] = b; out[o + 31] = 1 + (volumeAspects[i] - 1) * Math.exp(-age * .7);
        // Ease into thinning after the flash; approach empty gas continuously,
        // well before storage expires. The same clock freezes on pause.
        const dispersal = dissipationTime > 0 ? Math.max(0, age - cooling) / dissipationTime : 0;
        out[o + 32] = t; out[o + 33] = 1 - Math.exp(-dispersal * dispersal); out[o + 34] = volumeYaws[i]; out[o + 35] = volumeAxesY[i];
      }
    }
    // Back to front; distances a radix order could rank differently keep the comparison sort.
    let order: Uint32Array | undefined;
    if (!this.additive) {
      if (finite) order = sortDescending(count);
      else {
        const list = Array.from({ length: count }, (_, index) => index).sort((a, b) => keys[b] - keys[a]);
        order = (this.fallback ??= new Uint32Array(this.capacity)); order.set(list);
      }
    }
    const matrices = this.mesh.instanceMatrix.array as Float32Array, colorAttribute = this.mesh.instanceColor!, colorStride = colorAttribute.itemSize;
    const matrixWords = wordsOf(matrices), colorWords = wordsOf(colorAttribute.array as Float32Array), alphas = this.alpha.array as Float32Array;
    const alphaWords = wordsOf(alphas), words = recordWords;
    // Component writes suit both packed vertex RGB and aligned WebGPU storage
    // colors; InstancedMesh.setColorAt assumes a three-float stride.
    for (let index = 0; index < count; index++) {
      const o = (order ? order[index] : index) * record, m = index * 16, c = index * colorStride;
      matrixWords[m] = words[o]; matrixWords[m + 1] = words[o + 1]; matrixWords[m + 2] = words[o + 2]; matrixWords[m + 3] = words[o + 3];
      matrixWords[m + 4] = words[o + 4]; matrixWords[m + 5] = words[o + 5]; matrixWords[m + 6] = words[o + 6]; matrixWords[m + 7] = words[o + 7];
      matrixWords[m + 8] = words[o + 8]; matrixWords[m + 9] = words[o + 9]; matrixWords[m + 10] = words[o + 10]; matrixWords[m + 11] = words[o + 11];
      matrixWords[m + 12] = words[o + 12]; matrixWords[m + 13] = words[o + 13]; matrixWords[m + 14] = words[o + 14]; matrixWords[m + 15] = words[o + 15];
      colorWords[c] = words[o + 16]; colorWords[c + 1] = words[o + 17]; colorWords[c + 2] = words[o + 18];
      alphaWords[index] = words[o + 19];
    }
    if (volumes) {
      const sphere = wordsOf(this.sphere!.array as Float32Array), volume = wordsOf(this.volume!.array as Float32Array);
      const tint = wordsOf(this.tint!.array as Float32Array), progress = wordsOf(this.progress!.array as Float32Array);
      for (let index = 0; index < count; index++) {
        const o = (order ? order[index] : index) * record + 20, v = index * 4;
        sphere[v] = words[o]; sphere[v + 1] = words[o + 1]; sphere[v + 2] = words[o + 2]; sphere[v + 3] = words[o + 3];
        volume[v] = words[o + 4]; volume[v + 1] = words[o + 5]; volume[v + 2] = words[o + 6]; volume[v + 3] = words[o + 7];
        tint[v] = words[o + 8]; tint[v + 1] = words[o + 9]; tint[v + 2] = words[o + 10]; tint[v + 3] = words[o + 11];
        progress[v] = words[o + 12]; progress[v + 1] = words[o + 13]; progress[v + 2] = words[o + 14]; progress[v + 3] = words[o + 15];
      }
    }
    this.drawn = count;
    // Slots past the live count stay cleared: only those the last publication used need clearing again.
    if (this.filled > count) { alphas.fill(0, count, this.filled); matrices.fill(0, count * 16, this.filled * 16); }
    this.filled = count;
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count) for (const buffer of [this.mesh.instanceMatrix, this.mesh.instanceColor, this.alpha, this.sphere, this.volume, this.tint, this.progress]) if (buffer) {
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, count * buffer.itemSize);
      buffer.needsUpdate = true;
    }
  }

  get count(): number { return this.drawn; }
  reset(): void {
    this.commit();
    this.ages.fill(0); this.lives.fill(0);
    if (this.bound >= 0) { this.staging.age = 0; this.staging.life = 0; }
    this.drawn = 0; this.cursor = 0; this.emitted = 0; this.filled = 0; this.claimsValid = false; this.claimed = -1; this.live.fill(0);
    this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
    this.alpha.array.fill(0); this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.array.fill(0); this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
