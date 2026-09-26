import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { sortDescending, sortKeys, writeInstancePose } from './instancePose';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Water-aligned sprites lie flat: a quarter turn about +X. */
const WATER_FACING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** How a slot ranks for reuse: a spent particle first, then the largest share of its life spent. NaN never ranks, and a
 * live particle's infinite share stays below a spent one. */
const claimKey = (p: EffectParticle) => {
  if (p.age >= p.life) return Infinity;
  const fraction = p.age / p.life;
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
export function effectTexture(kind: 'smoke' | 'flash' | 'glow' | 'flame' | 'foam' | 'tracer' | 'droplet'): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(u, v);
    const coarse = noise(u * 3.8 + 11, v * 3.8 + 31);
    const detail = noise(u * 12 + 71, v * 12 + 53) * .65 + noise(u * 29 + 9, v * 29 + 17) * .35;
    const density = smooth((1 - radius + (coarse - .5) * .5) * 2.8) * (.5 + detail * .5);
    let alpha: number, light: number;
    if (kind === 'droplet') {
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
  distance: number;
}

/** One instance batch per material; fixed storage and back-to-front alpha sorting. */
export class EffectParticlePool {
  readonly mesh: THREE.InstancedMesh<THREE.InstancedBufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly particles: EffectParticle[];
  private readonly active: EffectParticle[] = [];
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly sphere?: THREE.InstancedBufferAttribute;
  private readonly volume?: THREE.InstancedBufferAttribute;
  private readonly tint?: THREE.InstancedBufferAttribute;
  private readonly progress?: THREE.InstancedBufferAttribute;
  // Instance poses do not need a scene object's synchronized Euler rotation or
  // world-matrix propagation: publish() composes them straight into the buffers.
  private readonly orientation = new THREE.Quaternion();
  private readonly facing = new THREE.Matrix4();
  private readonly up = THREE.Object3D.DEFAULT_UP.clone();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private cursor = 0;
  private emitted = 0;

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
    // The map already contributes its alpha through materialColor. A volume material brings its own opacity.
    if (!volumeMaterial?.opacityNode) material.opacityNode = attribute('effectOpacity', 'float');
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
    this.particles = Array.from({ length: capacity }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(),
      color: new THREE.Color(), age: 0, life: 0, size: 1, growth: 0, growthDecay: 0, diffusion: 0,
      heat: 0, cooling: 1, density: 4, dissipationTime: 0, volumeAspect: 1, volumeYaw: 0, volumeAxisY: 0,
      seed: 0, opacity: 1, drag: 0, gravity: 0,
      wind: 0, angle: 0, spin: 0, stretch: 1, fadeIn: 0, align: 'billboard', waterline: false, surfaceY: 0, distance: 0 }));
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

  emit(position: THREE.Vector3, sourceId?: string): EffectParticle {
    if (this.density < 1) {
      // A fixed-stride sequence thins every effect evenly, without a random stream.
      this.densityPhase += this.density;
      if (this.densityPhase < 1) return this.scratch ??= { ...this.particles[0], position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color() };
      this.densityPhase -= 1;
    }
    const p = this.claim();
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

  /** The next free slot in ring order. A full pool gives up the particle nearest the end of its
   * life, so a burst of short gunfire never cuts a long-lived plume short. */
  private claim(): EffectParticle {
    const capacity = this.capacity, particles = this.particles;
    if (this.claimsValid && this.claimed >= 0) this.updateClaim(this.claimed);
    // The ring usually offers a free slot within a few probes. Past them the tree answers what probing the whole ring
    // would: the first spent slot in ring order, else the first with the largest share of its life spent.
    let chosen = this.cursor % capacity, spent = -Infinity, free = false;
    const probes = Math.min(capacity, 32);
    for (let probe = 0; probe < probes; probe++) {
      const index = (this.cursor + probe) % capacity, p = particles[index];
      if (p.age >= p.life) { chosen = index; free = true; break; }
      const fraction = p.age / p.life;
      if (fraction > spent) { spent = fraction; chosen = index; }
    }
    if (!free && probes < capacity) chosen = this.search();
    this.cursor = chosen + 1;
    this.claimed = chosen;
    return particles[chosen];
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
    for (let i = 0; i < this.capacity; i++) tree[leaves + i] = claimKey(this.particles[i]);
    for (let i = leaves - 1; i >= 1; i--) { const a = tree[i * 2], b = tree[i * 2 + 1]; tree[i] = a >= b ? a : b; }
    this.claimsValid = true;
  }

  private updateClaim(index: number): void {
    const tree = this.claims!;
    let i = index + this.claimLeaves;
    tree[i] = claimKey(this.particles[index]);
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
    this.claimsValid = false;
    for (const p of this.particles) {
      if (p.age >= p.life) continue;
      const previousAge = p.age;
      p.age += dt;
      if (p.age < 0 || p.age >= p.life) continue;
      const step = Math.min(dt, p.age); // A delayed spray starts partway through the frame.
      if (step > 0) {
        const decay = Math.exp(-p.drag * step);
        const travel = p.drag > .0001 ? (1 - decay) / p.drag : step;
        // Integrate gravity with drag analytically, so spray apex/fall is frame-rate independent.
        const terminal = p.drag > .0001 ? p.gravity / p.drag : 0;
        p.position.x += p.velocity.x * travel + wind.x * p.wind * step;
        p.position.z += p.velocity.z * travel + wind.z * p.wind * step;
        p.position.y += p.drag > .0001 ? (p.velocity.y + terminal) * travel - terminal * step
          : p.velocity.y * step - .5 * p.gravity * step * step;
        p.velocity.x *= decay; p.velocity.z *= decay;
        p.velocity.y = p.drag > .0001 ? (p.velocity.y + terminal) * decay - terminal : p.velocity.y - p.gravity * step;
        p.angle += p.spin * step;
        if (p.waterline && p.position.y < p.surfaceY + .2 && previousAge >= 0) { p.age = p.life; continue; }
      }
    }
  }

  /** Build the sorted instance buffers once, after all emissions for this frame. Poses go straight into the instance
   * arrays through three's own arithmetic (the quaternion product, then `Matrix4.compose`), so every float is the same. */
  publish(camera: THREE.Camera, hiddenSourceId?: string): void {
    const active = this.active, particles = this.particles;
    active.length = 0;
    const cameraRotation = camera.quaternion, qx = cameraRotation.x, qy = cameraRotation.y, qz = cameraRotation.z, qw = cameraRotation.w;
    // The camera's inverse rotation, as Quaternion.invert() makes it.
    const ix = qx * -1, iy = qy * -1, iz = qz * -1, iw = qw;
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
    // Most particles share a stretch, and so the Math.hypot of their bounding sphere.
    let boundStretch = NaN, boundScale = NaN, finite = true;
    const keys = sortKeys(this.capacity);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.age < 0 || p.age >= p.life) continue;
      // Hidden smoke still ages and drifts, so leaving optics restores its current state.
      if (hiddenSourceId !== undefined && p.sourceId === hiddenSourceId) continue;
      // A gas puff faded to nothing would still fill its whole quad.
      if (volumes && p.opacity * (1 - smooth((p.age / p.life - .18) / .82)) < .004) continue;
      const position = p.position, x = position.x, y = position.y, z = position.z;
      if (cull) {
        // Linear growth bounds the decaying expansion. Include the full rotated
        // quad and stretch; particles outside still age and drift in advance().
        const size = Math.max(.01, p.size + Math.max(0, p.growth) * p.age + Math.max(0, p.diffusion) * p.age);
        if (p.stretch !== boundStretch) { boundStretch = p.stretch; boundScale = Math.hypot(1, p.stretch); }
        const reach = -(size * .5 * boundScale);
        // A gas puff's sprite is pulled toward the camera and the gas material
        // clears a puff around the lens, so only the four side planes reject
        // its bounding sphere; depth against the scene is the material's.
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
        const depth = -vz, radius = p.size + p.growth * p.age;
        if (depth + radius < .1 || Math.abs(vx) > Math.max(0, depth) / projection[0] + radius
          || Math.abs(vy) > Math.max(0, depth) / projection[5] + radius
          || radius * projection[5] / Math.max(1, depth) < .0007) continue;
      }
      const dx = x - cx, dy = y - cy, dz = z - cz, distance = dx * dx + dy * dy + dz * dz;
      p.distance = distance;
      if (!Number.isFinite(distance)) finite = false;
      keys[active.length] = distance;
      active.push(p);
    }
    const count = active.length;
    // Back to front; distances a radix order could rank differently keep the comparison sort.
    let order: Uint32Array | undefined;
    if (!this.additive) {
      if (finite) order = sortDescending(count);
      else active.sort((a, b) => b.distance - a.distance);
    }
    const matrices = this.mesh.instanceMatrix.array as Float32Array, colors = this.mesh.instanceColor!;
    const colorArray = colors.array as Float32Array, colorStride = colors.itemSize, alphas = this.alpha.array as Float32Array;
    const sphere = this.sphere?.array as Float32Array | undefined, volume = this.volume?.array as Float32Array;
    const tint = this.tint?.array as Float32Array, progress = this.progress?.array as Float32Array;
    const facing = volumes && perspective;
    for (let index = 0; index < count; index++) {
      const p = active[order ? order[index] : index];
      const t = p.age / p.life;
      const fade = (1 - smooth((t - .18) / .82)) * (p.fadeIn > 0 ? smooth(p.age / p.fadeIn) : 1);
      const expansion = p.growthDecay > 0 ? (1 - Math.exp(-p.age * p.growthDecay)) / p.growthDecay : p.age;
      const size = Math.max(.01, p.size + p.growth * expansion + p.diffusion * p.age);
      let px = p.position.x, py = p.position.y, pz = p.position.z, ox: number, oy: number, oz: number, ow: number, sx: number, sy: number;
      if (facing) {
        // A puff is a sprite facing the camera from its centre (the frame the gas material rebuilds), drawn half its
        // radius nearer the camera so the deck or hull it rises from does not cut it through the middle. Scaled to
        // keep the puff's angular size where it is drawn.
        const orientation = this.orientation, distance = Math.sqrt(p.distance), radius = size / 2;
        orientation.setFromRotationMatrix(this.facing.lookAt(cameraPosition, p.position, this.up));
        const pull = distance > 1e-6 ? Math.min(radius * .5, Math.max(0, distance - (camera as THREE.PerspectiveCamera).near * 2)) : 0;
        if (pull > 0) {
          const k = pull / distance;
          px -= (px - cameraPosition.x) * k; py -= (py - cameraPosition.y) * k; pz -= (pz - cameraPosition.z) * k;
        }
        sx = sy = size * (distance > 1e-6 ? (distance - pull) / distance : 1);
        ox = orientation.x; oy = orientation.y; oz = orientation.z; ow = orientation.w;
      } else {
        let angle = p.angle, stretch = p.stretch, ax = qx, ay = qy, az = qz, aw = qw;
        if (p.align === 'water') { ax = WATER_FACING.x; ay = WATER_FACING.y; az = WATER_FACING.z; aw = WATER_FACING.w; }
        else if (p.align === 'velocity' || p.align === 'streak') {
          // The velocity in camera space, as Vector3.applyQuaternion turns it.
          const velocity = p.velocity, vx = velocity.x, vy = velocity.y, vz = velocity.z;
          const tx = 2 * (iy * vz - iz * vy), ty = 2 * (iz * vx - ix * vz), tz = 2 * (ix * vy - iy * vx);
          const dx = vx + iw * tx + iy * tz - iz * ty, dy = vy + iw * ty + iz * tx - ix * tz;
          angle = Math.atan2(-dx, dy);
          const speed = Math.max(.01, Math.sqrt(vx * vx + vy * vy + vz * vz)), across = Math.hypot(dx, dy) / speed;
          // An exposure smear grows with speed and foreshortens; the drop itself stays round.
          if (p.align === 'streak') stretch = 1 + (stretch - 1) * Math.min(1, speed / STREAK_SPEED) * across;
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
      writeInstancePose(matrices, index * 16, px, py, pz, ox, oy, oz, ow, sx, sy, 1);
      // Component writes suit both packed vertex RGB and aligned WebGPU storage
      // colors; InstancedMesh.setColorAt assumes a three-float stride.
      const color = p.color, c = index * colorStride;
      colorArray[c] = color.r; colorArray[c + 1] = color.g; colorArray[c + 2] = color.b;
      alphas[index] = p.opacity * fade;
      if (sphere) {
        const v = index * 4;
        sphere[v] = p.position.x; sphere[v + 1] = p.position.y; sphere[v + 2] = p.position.z; sphere[v + 3] = size / 2;
        volume[v] = p.age; volume[v + 1] = p.seed; volume[v + 2] = p.heat * (1 - smooth(p.age / p.cooling)); volume[v + 3] = p.density;
        // The narrow jet gradually opens into billows; freeze its launch axis
        // instead of snapping it toward gravity as the initial velocity decays.
        tint[v] = color.r; tint[v + 1] = color.g; tint[v + 2] = color.b; tint[v + 3] = 1 + (p.volumeAspect - 1) * Math.exp(-p.age * .7);
        // Ease into thinning after the flash; approach empty gas continuously,
        // well before storage expires. The same clock freezes on pause.
        const dispersal = p.dissipationTime > 0 ? Math.max(0, p.age - p.cooling) / p.dissipationTime : 0;
        progress[v] = t; progress[v + 1] = 1 - Math.exp(-dispersal * dispersal); progress[v + 2] = p.volumeYaw; progress[v + 3] = p.volumeAxisY;
      }
    }
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

  get count(): number { return this.active.length; }
  reset(): void {
    for (const p of this.particles) { p.age = 0; p.life = 0; }
    this.active.length = 0; this.cursor = 0; this.emitted = 0; this.filled = 0; this.claimsValid = false; this.claimed = -1;
    this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
    this.alpha.array.fill(0); this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.array.fill(0); this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
