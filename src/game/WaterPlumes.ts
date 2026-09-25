import * as THREE from 'three/webgpu';
import { sortDescending, sortKeys } from './instancePose';
import { effectUploads } from './InstanceUploads';
import { attribute, cameraPosition, float, positionWorld, smoothstep, texture, uniform, uv, vec4 } from 'three/tsl';

const SEGMENTS = 18;
const VERTICES = (SEGMENTS + 1) * 2;
const GRAVITY = 9.81;
const DRAG = .12;
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
// The sheet's row profile is fixed; age only changes its travel, opening and fade.
const ROWS = Array.from({ length: SEGMENTS + 1 }, (_, row) => {
  const along = row / SEGMENTS;
  return { along, radius: .12 + .88 * along * along, alpha: 1 - smooth(.83, 1, along),
    red: .63 + .32 * along, green: .76 + .22 * along, blue: .81 + .19 * along };
});

interface WaterSheet {
  origin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  cosine: number;
  sine: number;
  bends: Float64Array;
  widths: Float64Array;
  up: number;
  out: number;
  width: number;
  leanX: number;
  leanZ: number;
  seed: number;
  crown: boolean;
  distance: number;
  /** Which launch the sheet holds: every launch has its own. */
  launch: number;
}

/** A bounded batch of curved water sheets, each spanning a range of launch
 * velocities. Gravity pulls the lower water back first, then the tips. These
 * are world-space surfaces: they never turn toward the camera or flip at apex.
 * Visual launch speeds/widths are authored, not a hydrodynamic solve. */
export class WaterPlumes {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly sheets: WaterSheet[];
  private readonly active: WaterSheet[] = [];
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly opacity: THREE.BufferAttribute;
  private readonly sun = new THREE.Vector3(-.55, .74, -.39).normalize();
  private readonly sunDirection = uniform(this.sun.clone());
  private readonly illumination = uniform(1);
  private readonly center = new THREE.Vector3();
  private cursor = 0;
  private launches = 0;
  /** Moves with every change of the sun's direction, which the sheets' colours read. */
  private sunVersion = 0;
  /** What each drawn slot's vertices hold: the launch, the age its shape and opacity were written at, and the sun its colours were.
   * A slot that still holds the same sheet at the same age writes and uploads nothing again; a new sun only its colours. */
  private readonly slotLaunch: Float64Array;
  private readonly slotAge: Float64Array;
  private readonly slotSun: Float64Array;
  /** This publication's runs of slots to upload ([start, end) pairs): shapes and opacities, and colours. */
  private readonly placed: number[] = [];
  private readonly painted: number[] = [];

  constructor(readonly capacity: number, map: THREE.DataTexture) {
    const geometry = new THREE.BufferGeometry();
    // Versioned uploads: publish() flags the live sheets' range. Dynamic usage would also send the whole
    // array again on every other pass that draws the mesh, and every frame while no sheet is live.
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3);
    this.opacity = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 2), 2);
    const coords = new Float32Array(capacity * VERTICES * 2), indices: number[] = [];
    for (let sheet = 0; sheet < capacity; sheet++) {
      for (let row = 0; row <= SEGMENTS; row++) for (let side = 0; side < 2; side++) {
        const index = sheet * VERTICES + row * 2 + side;
        coords[index * 2] = side; coords[index * 2 + 1] = row / SEGMENTS;
      }
      for (let row = 0; row < SEGMENTS; row++) {
        const index = sheet * VERTICES + row * 2;
        indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
      }
    }
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setAttribute('waterOpacity', this.opacity);
    geometry.setAttribute('uv', new THREE.BufferAttribute(coords, 2));
    geometry.setIndex(indices); geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.forceSinglePass = true;
    const water = texture(map, uv()), state = attribute<'vec2'>('waterOpacity', 'vec2');
    // Lengthwise filaments tear into holes as aerated sheets thin. Normal alpha
    // blending keeps the shaded water blue-gray instead of making it glow.
    // Looking toward the sun, thin water passes light forward and its torn edges shine.
    const backlight = positionWorld.sub(cameraPosition).normalize().dot(this.sunDirection).max(0).pow(6)
      .mul(float(1).sub(water.a.mul(.6))).mul(.9);
    material.colorNode = vec4(attribute<'vec3'>('color', 'vec3').mul(water.rgb).mul(backlight.add(1)).mul(this.illumination), 1);
    material.opacityNode = water.a.mul(state.x).mul(smoothstep(state.y.sub(.12), state.y.add(.12), water.r));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Ballistic water sheets';
    this.mesh.frustumCulled = false;
    this.sheets = Array.from({ length: capacity }, () => ({ origin: new THREE.Vector3(), age: 0, life: 0,
      scale: 1, cosine: 1, sine: 0, bends: new Float64Array(SEGMENTS + 1), widths: new Float64Array(SEGMENTS + 1),
      up: 0, out: 0, width: 1, leanX: 0, leanZ: 0, seed: 0, crown: false, distance: 0, launch: 0 }));
    this.slotLaunch = new Float64Array(capacity).fill(-1); this.slotAge = new Float64Array(capacity); this.slotSun = new Float64Array(capacity);
  }

  emit(origin: THREE.Vector3, scale: number, direction: THREE.Vector3, random: () => number): void {
    const rootScale = Math.sqrt(scale);
    const steepness = Math.min(1, Math.abs(direction.y));
    const lift = .8 + .2 * Math.sqrt(steepness);
    const lean = (2 + 5 * (1 - steepness)) * rootScale;
    const rotation = random() * Math.PI * 2;
    for (let i = 0; i < 24; i++) {
      const sheet = this.sheets[this.cursor++ % this.capacity];
      const crown = i >= 14, count = crown ? 10 : 14;
      sheet.launch = ++this.launches;
      sheet.origin.copy(origin); sheet.scale = scale; sheet.crown = crown;
      sheet.age = -random() * (crown ? .025 : .085);
      const angle = rotation + ((crown ? i - 14 : i) + random() * .65) / count * Math.PI * 2;
      sheet.cosine = Math.cos(angle); sheet.sine = Math.sin(angle);
      sheet.up = (crown ? 8 + random() * 6 : 28 + random() * 13) * rootScale * lift;
      sheet.out = (crown ? 9 + random() * 9 : 1.2 + random() * 3.4) * rootScale;
      sheet.width = (crown ? 4 + random() * 3 : 2.7 + random() * 2.3) * scale;
      sheet.leanX = direction.x * lean; sheet.leanZ = direction.z * lean;
      sheet.seed = random() * Math.PI * 2;
      // Cache launch-specific folds in double precision and preserve the
      // original multiplication order when animating their opening below.
      for (let row = 0; row <= SEGMENTS; row++) {
        const along = ROWS[row].along;
        sheet.bends[row] = Math.sin(along * 19 + sheet.seed) * Math.sin(along * 7 + sheet.seed);
        const folds = .64 + .5 * Math.sin(along * 12 + sheet.seed) ** 2;
        sheet.widths[row] = sheet.width * folds * (1 - (sheet.crown ? .78 : .4) * along);
      }
      // Bound the full return to sea; drag makes the real flight shorter.
      sheet.life = sheet.up * 2 / GRAVITY + .15;
    }
  }

  setSun(direction: THREE.Vector3, intensity = 1): void {
    if (!this.sun.equals(direction)) this.sunVersion++;
    this.sun.copy(direction); this.sunDirection.value.copy(direction); this.illumination.value = intensity;
  }

  advance(dt: number): void {
    for (const sheet of this.sheets) if (sheet.age < sheet.life) sheet.age += dt;
  }

  publish(camera: THREE.Camera): void {
    this.active.length = 0;
    const keys = sortKeys(this.capacity);
    let finite = true;
    for (const sheet of this.sheets) {
      if (sheet.age < 0 || sheet.age >= sheet.life) continue;
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        // Cull only when the entire launch envelope is outside the view.
        // Visible sheets retain the original silhouette at every zoom level.
        this.center.copy(sheet.origin); this.center.y += 24 * sheet.scale;
        this.center.applyMatrix4(camera.matrixWorldInverse);
        const radius = 65 * Math.max(sheet.scale, Math.sqrt(sheet.scale)), depth = -this.center.z;
        const projection = camera.projectionMatrix.elements;
        if (depth + radius < .1 || Math.abs(this.center.x) > Math.max(depth, 0) / projection[0] + radius * 2
          || Math.abs(this.center.y) > Math.max(depth, 0) / projection[5] + radius * 2) continue;
      }
      const travel = -Math.expm1(-DRAG * sheet.age) / DRAG;
      const fall = GRAVITY / DRAG * (sheet.age - travel);
      if (sheet.up * travel - fall <= 0) continue;
      sheet.distance = sheet.origin.distanceToSquared(camera.position);
      if (!Number.isFinite(sheet.distance)) finite = false;
      keys[this.active.length] = sheet.distance;
      this.active.push(sheet);
    }
    // Back to front, in the order a stable sort by distance gives (see sortDescending).
    let order: Uint32Array | undefined;
    if (finite) order = sortDescending(this.active.length); else this.active.sort((a, b) => b.distance - a.distance);
    // Straight into the vertex arrays: what setXYZ/setXY store, without a call per vertex.
    const positions = this.position.array as Float32Array, colors = this.color.array as Float32Array, opacities = this.opacity.array as Float32Array;
    // A slot's vertices are known only while every range flagged for them has reached the GPU: ranges three has not consumed (the
    // mesh was not drawn, or its buffers were made whole from the arrays) put every slot back to be written.
    const versioned = effectUploads.versioned, placed = this.placed, painted = this.painted;
    if (!versioned || this.position.updateRanges.length || this.color.updateRanges.length || this.opacity.updateRanges.length) this.slotLaunch.fill(-1);
    placed.length = 0; painted.length = 0;
    for (let index = 0; index < this.active.length; index++) {
      const sheet = this.active[order ? order[index] : index], age = sheet.age;
      // The same sheet at the same age has the same shape and opacity, and under the same sun the same colours: the values written
      // before are the ones this would write.
      const same = this.slotLaunch[index] === sheet.launch, place = !same || this.slotAge[index] !== age, paint = !same || this.slotSun[index] !== this.sunVersion;
      if (!place && !paint) continue;
      this.slotLaunch[index] = sheet.launch;
      if (place) { this.slotAge[index] = age; addRun(placed, index); }
      if (paint) { this.slotSun[index] = this.sunVersion; addRun(painted, index); }
      const travel = -Math.expm1(-DRAG * age) / DRAG;
      const fall = GRAVITY / DRAG * (age - travel);
      const { cosine, sine } = sheet;
      const opening = 1 - Math.exp(-age * 38);
      const breakup = smooth(.65, 4.2 * Math.sqrt(sheet.scale), age);
      const fade = (1 - smooth(sheet.life * .55, sheet.life, age)) * opening;
      // Aerated water is brilliant where its outer face turns to the sun and
      // blue-gray in the column's own shadow; a high sun lights every side alike.
      const horizontal = Math.hypot(this.sun.x, this.sun.z);
      const facing = horizontal > 1e-4 ? (cosine * this.sun.x + sine * this.sun.z) / horizontal : 0;
      const lit = .5 + .5 * facing * Math.min(1, horizontal * 1.5);
      const sunlight = .5 + .2 * this.sun.y + .38 * lit, shade = .9 + .1 * lit;
      const bending = .45 + .35 * Math.min(age, 2);
      for (let row = 0; row <= SEGMENTS; row++) {
        const profile = ROWS[row], along = profile.along;
        if (paint) {
          // Dense lower water carries the sea's blue shadow; aerated tips scatter
          // more sky light. The shared sun follows time of day and battle weather.
          const red = profile.red * sunlight * shade, green = profile.green * sunlight * (.5 + .5 * shade), blue = profile.blue * sunlight;
          for (let side = 0, v3 = (index * VERTICES + row * 2) * 3; side < 2; side++, v3 += 3) { colors[v3] = red; colors[v3 + 1] = green; colors[v3 + 2] = blue; }
        }
        if (!place) continue;
        const height = sheet.up * along * travel - fall;
        const radius = sheet.scale * .35 + sheet.out * travel * profile.radius;
        const bend = sheet.bends[row] * bending * sheet.scale * opening;
        const width = sheet.widths[row] * opening * (1 + age * .13);
        const centerX = sheet.origin.x + cosine * radius + sheet.leanX * travel * along;
        const centerZ = sheet.origin.z + sine * radius + sheet.leanZ * travel * along;
        const alpha = fade * smooth(0, .65 * sheet.scale, height) * profile.alpha;
        const y = sheet.origin.y + Math.max(-.5, height), opacity = alpha * .82, tear = .38 + breakup * .34 + along * .05;
        for (let side = 0; side < 2; side++) {
          const vertex = index * VERTICES + row * 2 + side, v3 = vertex * 3, v2 = vertex * 2;
          const lateral = (side - .5) * width + bend;
          positions[v3] = centerX - sine * lateral; positions[v3 + 1] = y; positions[v3 + 2] = centerZ + cosine * lateral;
          opacities[v2] = opacity; opacities[v2 + 1] = tear;
        }
      }
    }
    this.mesh.geometry.setDrawRange(0, this.active.length * SEGMENTS * 6);
    for (const buffer of [this.position, this.color, this.opacity]) {
      buffer.clearUpdateRanges();
      if (!versioned) {
        if (this.active.length) { buffer.addUpdateRange(0, this.active.length * VERTICES * buffer.itemSize); buffer.needsUpdate = true; }
        continue;
      }
      const runs = buffer === this.color ? painted : placed, floats = VERTICES * buffer.itemSize;
      for (let i = 0; i < runs.length; i += 2) buffer.addUpdateRange(runs[i] * floats, (runs[i + 1] - runs[i]) * floats);
      if (runs.length) buffer.needsUpdate = true;
    }
  }

  get count(): number { return this.active.length; }
  reset(): void {
    for (const sheet of this.sheets) { sheet.age = 0; sheet.life = 0; }
    this.cursor = 0; this.active.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/** Slots a few apart upload as one range: a few hundred bytes more rather than another write call. */
const RUN_GAP = 8;
/** Add `slot` to ascending [start, end) runs of slots. */
function addRun(runs: number[], slot: number): void {
  const last = runs.length - 1;
  if (last > 0 && slot - runs[last] <= RUN_GAP) runs[last] = slot + 1; else runs.push(slot, slot + 1);
}
