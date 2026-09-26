import * as THREE from 'three/webgpu';
import { sortDescending, sortKeys } from './instancePose';

/** One particle of a ship fire: a flame tongue or a puff of its smoke column. */
export interface FireParticle {
  /** Hull the particle belongs to, so optics on that hull can leave it out. */
  sourceId?: string;
  /** Spawn point; vertical motion is analytic from here, so it is frame-rate independent. */
  readonly origin: THREE.Vector3;
  readonly position: THREE.Vector3;
  /** Horizontal launch velocity (inherited hull motion and scatter), decaying with `drag`. */
  readonly drift: THREE.Vector3;
  drag: number;
  age: number;
  life: number;
  /** Buoyant climb: `rise` m/s at the source easing over `riseTime` s to `lift` m/s. */
  rise: number;
  riseTime: number;
  lift: number;
  /** Wind carried at the source; it grows to the full multiple by `shearHeight` metres of climb. */
  shear: number;
  shearHeight: number;
  /** Smoke radius or flame height in metres, and how it grows. */
  size: number;
  growth: number;
  growthDecay: number;
  diffusion: number;
  /** Flame width as a fraction of its height. */
  aspect: number;
  seed: number;
  opacity: number;
  /** Thinning as the puff spreads: opacity × (initial ÷ current size)^thin, floored at 35 %. */
  thin: number;
  fadeIn: number;
  readonly albedo: THREE.Color;
  /** Flame temperature, or smoke underglow from the fire below; cools over `cool` seconds. */
  glow: number;
  cool: number;
  /** Gas only: burning gas (0 none … 2 white-hot) that cools to smoke over `cooling` seconds, as the gas atlas draws it. */
  heat: number;
  cooling: number;
}

/** `flame` tongues, `smoke` puffs shaded as spheres by their own material, or `gas` puffs that relight the gas atlas. */
export type FireBatchMode = 'flame' | 'smoke' | 'gas';
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

/** A fixed-capacity instanced batch for fire flames or fire smoke.
 *
 * Particles live in world space. Flames stand upright on the world axis and turn only in azimuth
 * toward the camera (full billboards when looking straight down); smoke puffs face the camera and
 * are shaded as spheres by their material; gas puffs face the camera from their centres, the frame the
 * gas atlas is relit in. Per-instance data: `fireCenter` (centre, radius or half height), `fireState`
 * (seed, life fraction, glow, opacity), `fireColor` (albedo, age in s) and `fireHeat` (a gas puff's
 * burning gas). */
export class FireBatch {
  readonly mesh: THREE.InstancedMesh<THREE.InstancedBufferGeometry, THREE.Material>;
  private readonly particles: FireParticle[];
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private readonly heat: THREE.InstancedBufferAttribute;
  private readonly order: number[] = [];
  private readonly depth: Float32Array;
  private readonly sorted: Uint32Array;
  private readonly extents: Float32Array;
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere();
  private readonly toCamera = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private cursor = 0;
  private emitted = 0;
  private live = 0;
  private coverage = 0;
  /** Fraction of requested emissions that enter the batch (the combat effects setting). */
  density = 1;
  private densityPhase = 0;
  private scratch?: FireParticle;

  constructor(readonly capacity: number, material: THREE.Material, readonly mode: FireBatchMode) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.instanceCount = 0;
    const vec4 = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.center = vec4(); this.state = vec4(); this.color = vec4();
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('fireCenter', this.center);
    geometry.setAttribute('fireState', this.state);
    geometry.setAttribute('fireColor', this.color);
    geometry.setAttribute('fireHeat', this.heat);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Three sizes the matrix buffer from the capacity at compilation; instanceCount draws the live part.
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.depth = new Float32Array(capacity);
    this.sorted = new Uint32Array(capacity);
    this.extents = new Float32Array(capacity);
    this.particles = Array.from({ length: capacity }, () => ({
      origin: new THREE.Vector3(), position: new THREE.Vector3(), drift: new THREE.Vector3(), drag: 0, age: 0, life: 0,
      rise: 0, riseTime: 1, lift: 0, shear: 0, shearHeight: 1, size: 1, growth: 0, growthDecay: 0, diffusion: 0, aspect: 1,
      seed: 0, opacity: 1, thin: 0, fadeIn: 0, albedo: new THREE.Color(), glow: 0, cool: 1, heat: 0, cooling: 1 }));
  }

  /** A reset particle at `position`. Thinned requests get a detached scratch particle, so callers
   * keep one emission path at every density. A full batch gives up the most-spent particle of the
   * next few slots, so a burst of short flames never cuts a long smoke column short. */
  emit(position: THREE.Vector3, sourceId?: string): FireParticle {
    if (this.density < 1) {
      this.densityPhase += this.density;
      if (this.densityPhase < 1) return this.scratch ??= { ...this.particles[0], origin: new THREE.Vector3(), position: new THREE.Vector3(), drift: new THREE.Vector3(), albedo: new THREE.Color() };
      this.densityPhase -= 1;
    }
    // Ring order finds a free slot at once in steady state; a full batch looks a bounded way ahead.
    let chosen = this.cursor % this.capacity, spent = -Infinity;
    for (let probe = 0, reach = Math.min(this.capacity, 96); probe < reach; probe++) {
      const index = (this.cursor + probe) % this.capacity, candidate = this.particles[index];
      if (candidate.age >= candidate.life) { chosen = index; break; }
      const fraction = candidate.age / candidate.life;
      if (fraction > spent) { spent = fraction; chosen = index; }
    }
    this.cursor = chosen + 1;
    const p = this.particles[chosen];
    p.sourceId = sourceId; p.origin.copy(position); p.position.copy(position); p.drift.set(0, 0, 0);
    p.drag = 0; p.age = 0; p.life = 1; p.rise = 0; p.riseTime = 1; p.lift = 0; p.shear = 0; p.shearHeight = 1;
    p.size = 1; p.growth = 0; p.growthDecay = 0; p.diffusion = 0; p.aspect = 1;
    p.seed = (++this.emitted * .61803398875 % 1) * 100; p.opacity = 1; p.thin = 0; p.fadeIn = 0; p.albedo.setRGB(1, 1, 1);
    p.glow = 0; p.cool = 1; p.heat = 0; p.cooling = 1;
    return p;
  }

  /** Age and move every particle; the same dt at any frame rate gives the same climb. */
  advance(dt: number, wind: THREE.Vector3): void {
    if (dt <= 0) return;
    for (const p of this.particles) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age < 0 || p.age >= p.life) continue;
      const step = Math.min(dt, p.age);
      const climb = p.rise * p.riseTime * (1 - Math.exp(-p.age / p.riseTime)) + p.lift * p.age;
      p.position.y = p.origin.y + climb;
      const decay = Math.exp(-p.drag * p.age);
      const carried = p.shear * (.35 + .65 * Math.min(1, Math.max(0, climb) / p.shearHeight));
      p.position.x += (p.drift.x * decay + wind.x * carried) * step;
      p.position.z += (p.drift.z * decay + wind.z * carried) * step;
    }
  }

  /** Radius of a smoke puff, or height of a flame tongue, at its current age. */
  static extent(p: FireParticle): number {
    const expansion = p.growthDecay > 0 ? (1 - Math.exp(-p.age * p.growthDecay)) / p.growthDecay : p.age;
    return Math.max(.01, p.size + p.growth * expansion + p.diffusion * p.age);
  }

  /** Sort the visible particles back to front and write the instance buffers for this frame. */
  publish(camera: THREE.Camera, hiddenSourceId?: string): void {
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    camera.getWorldPosition(this.cameraPosition);
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    if (perspective) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    this.order.length = 0;
    const e = camera.projectionMatrix.elements;
    this.coverage = 0;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.age < 0 || p.age >= p.life) continue;
      if (hiddenSourceId !== undefined && p.sourceId === hiddenSourceId) continue;
      // A puff faded to nothing would still fill its whole quad.
      if (this.mode !== 'flame' && p.opacity * (1 - smooth((p.age / p.life - .45) / .55)) < .01) continue;
      const extent = FireBatch.extent(p);
      if (perspective) {
        this.bounds.center.copy(p.position);
        if (this.mode === 'flame') this.bounds.center.y += extent * .5;
        this.bounds.radius = extent * (this.mode === 'flame' ? .75 : 1.45);
        if (!this.frustum.intersectsSphere(this.bounds)) continue;
      }
      const distanceSq = p.position.distanceToSquared(this.cameraPosition);
      this.depth[i] = distanceSq; this.extents[i] = extent;
      // Screens' worth of quad area drawn: the overdraw that sets this batch's fill cost.
      if (perspective) {
        const area = this.mode === 'flame' ? extent * extent * p.aspect : 4 * extent * extent;
        this.coverage += Math.min(4, area * e[0] * e[5] / (4 * Math.max(distanceSq, extent * extent * .25)));
      }
      this.order.push(i);
    }
    // Back to front, in the order a stable sort by depth gives (see sortDescending).
    const keys = sortKeys(this.order.length);
    let finite = true;
    for (let k = 0; k < this.order.length; k++) { keys[k] = this.depth[this.order[k]]; if (!Number.isFinite(keys[k])) finite = false; }
    if (finite) {
      const sorted = sortDescending(this.order.length), indices = this.sorted;
      for (let k = 0; k < this.order.length; k++) indices[k] = this.order[sorted[k]];
      for (let k = 0; k < this.order.length; k++) this.order[k] = indices[k];
    } else this.order.sort((a, b) => this.depth[b] - this.depth[a]);
    // One shared basis per frame. Flames: upright on the world axis, facing the camera in azimuth,
    // easing toward a full billboard when looking steeply down so no tongue collapses to a line.
    if (this.mode === 'flame') {
      this.toCamera.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
      const steep = smooth((Math.abs(this.toCamera.y) - .72) / .24);
      this.normal.set(this.toCamera.x, 0, this.toCamera.z);
      if (this.normal.lengthSq() < 1e-6) this.normal.copy(this.cameraUp).negate().setY(0);
      this.normal.normalize().lerp(this.toCamera, steep).normalize();
      this.up.copy(UP).lerp(this.cameraUp, steep).normalize();
      this.right.crossVectors(this.up, this.normal).normalize();
      this.up.crossVectors(this.normal, this.right);
    } else if (this.mode === 'smoke') {
      this.right.copy(this.cameraRight); this.up.copy(this.cameraUp);
      this.normal.crossVectors(this.right, this.up);
    }
    const matrices = this.mesh.instanceMatrix.array as Float32Array, near = perspective ? (camera as THREE.PerspectiveCamera).near : 0;
    const center = this.center.array as Float32Array, state = this.state.array as Float32Array, color = this.color.array as Float32Array;
    const heat = this.heat.array as Float32Array;
    for (let slot = 0; slot < this.order.length; slot++) {
      const index = this.order[slot], p = this.particles[index], t = p.age / p.life, extent = this.extents[index];
      const fade = (p.fadeIn > 0 ? smooth(p.age / p.fadeIn) : 1) * (1 - smooth((t - .45) / .55))
        * (p.thin > 0 ? Math.max(.35, Math.min(1, (p.size / extent) ** p.thin)) : 1)
        // A puff around the camera would fill the screen with one flat layer: clear it as the lens enters (the gas material does its own).
        * (this.mode === 'smoke' ? smooth((Math.sqrt(this.depth[index]) - extent * .7) / (extent * 1.6)) : 1);
      const m = slot * 16;
      let cx = p.position.x, cy = p.position.y, cz = p.position.z, sx: number, sy: number;
      if (this.mode === 'flame') {
        const height = extent * (.55 + .9 * t) * (1 - t * t);
        sy = height; sx = height * p.aspect * (1 - .45 * t);
        cx += this.up.x * sy * .5; cy += this.up.y * sy * .5; cz += this.up.z * sy * .5;
        center[slot * 4 + 3] = sy * .5;
      } else if (this.mode === 'smoke') {
        sx = sy = extent * 2;
        center[slot * 4 + 3] = extent;
      } else {
        // Gas puffs face the camera from their centres, turned about the world's up (the frame the gas material relights
        // them in), drawn half a radius nearer the camera so the deck they rise from does not cut them.
        const distance = Math.sqrt(this.depth[index]);
        this.normal.subVectors(this.cameraPosition, p.position).divideScalar(Math.max(distance, 1e-6));
        this.right.crossVectors(UP, this.normal);
        if (this.right.lengthSq() < 1e-8) this.right.copy(this.cameraRight); else this.right.normalize();
        this.up.crossVectors(this.normal, this.right);
        const pull = Math.min(extent * .5, Math.max(0, distance - near * 2));
        cx += this.normal.x * pull; cy += this.normal.y * pull; cz += this.normal.z * pull;
        sx = sy = extent * 2 * (distance > 1e-6 ? (distance - pull) / distance : 1);
        center[slot * 4 + 3] = extent;
      }
      matrices[m] = this.right.x * sx; matrices[m + 1] = this.right.y * sx; matrices[m + 2] = this.right.z * sx; matrices[m + 3] = 0;
      matrices[m + 4] = this.up.x * sy; matrices[m + 5] = this.up.y * sy; matrices[m + 6] = this.up.z * sy; matrices[m + 7] = 0;
      matrices[m + 8] = this.normal.x; matrices[m + 9] = this.normal.y; matrices[m + 10] = this.normal.z; matrices[m + 11] = 0;
      matrices[m + 12] = cx; matrices[m + 13] = cy; matrices[m + 14] = cz; matrices[m + 15] = 1;
      center[slot * 4] = p.position.x; center[slot * 4 + 1] = p.position.y; center[slot * 4 + 2] = p.position.z;
      state[slot * 4] = p.seed; state[slot * 4 + 1] = t;
      state[slot * 4 + 2] = p.glow * Math.exp(-p.age / p.cool); state[slot * 4 + 3] = p.opacity * fade;
      heat[slot] = p.heat > 0 ? p.heat * (1 - smooth(p.age / p.cooling)) : 0;
      color[slot * 4] = p.albedo.r; color[slot * 4 + 1] = p.albedo.g; color[slot * 4 + 2] = p.albedo.b; color[slot * 4 + 3] = p.age;
    }
    this.live = this.order.length;
    matrices.fill(0, this.live * 16);
    state.fill(0, this.live * 4);
    this.mesh.geometry.instanceCount = this.live;
    this.mesh.visible = this.live > 0;
    if (!this.live) return;
    for (const buffer of [this.mesh.instanceMatrix, this.center, this.state, this.color, this.heat]) {
      buffer.clearUpdateRanges();
      buffer.addUpdateRange(0, this.live * buffer.itemSize);
      buffer.needsUpdate = true;
    }
  }

  /** Particles drawn by the last publish. */
  get count(): number { return this.live; }
  /** Screen areas of quads drawn by the last publish (1 = the whole viewport once). */
  get fill(): number { return this.coverage; }
  /** Particles still alive, drawn or not. */
  get alive(): number { let n = 0; for (const p of this.particles) if (p.age < p.life) n++; return n; }
  reset(): void {
    for (const p of this.particles) { p.age = 0; p.life = 0; }
    this.cursor = 0; this.emitted = 0; this.live = 0; this.densityPhase = 0;
    this.mesh.geometry.instanceCount = 0; this.mesh.visible = false;
    (this.mesh.instanceMatrix.array as Float32Array).fill(0); this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
