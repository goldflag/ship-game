import * as THREE from 'three/webgpu';
import { attribute, smoothstep, texture, uv, vec4 } from 'three/tsl';

const SEGMENTS = 18;
const VERTICES = (SEGMENTS + 1) * 2;
const GRAVITY = 9.81;
const DRAG = .12;
const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);

interface WaterSheet {
  origin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  angle: number;
  up: number;
  out: number;
  width: number;
  leanX: number;
  leanZ: number;
  seed: number;
  crown: boolean;
  distance: number;
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
  private readonly light = new THREE.Color();
  private cursor = 0;

  constructor(readonly capacity: number, map: THREE.DataTexture) {
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.opacity = new THREE.BufferAttribute(new Float32Array(capacity * VERTICES * 2), 2).setUsage(THREE.DynamicDrawUsage);
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
    material.colorNode = vec4(attribute<'vec3'>('color', 'vec3').mul(water.rgb), 1);
    material.opacityNode = water.a.mul(state.x).mul(smoothstep(state.y.sub(.12), state.y.add(.12), water.r));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Ballistic water sheets';
    this.mesh.frustumCulled = false;
    this.sheets = Array.from({ length: capacity }, () => ({ origin: new THREE.Vector3(), age: 0, life: 0,
      scale: 1, angle: 0, up: 0, out: 0, width: 1, leanX: 0, leanZ: 0, seed: 0, crown: false, distance: 0 }));
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
      sheet.origin.copy(origin); sheet.scale = scale; sheet.crown = crown;
      sheet.age = -random() * (crown ? .025 : .085);
      sheet.angle = rotation + ((crown ? i - 14 : i) + random() * .65) / count * Math.PI * 2;
      sheet.up = (crown ? 8 + random() * 6 : 28 + random() * 13) * rootScale * lift;
      sheet.out = (crown ? 9 + random() * 9 : 1.2 + random() * 3.4) * rootScale;
      sheet.width = (crown ? 4 + random() * 3 : 2.7 + random() * 2.3) * scale;
      sheet.leanX = direction.x * lean; sheet.leanZ = direction.z * lean;
      sheet.seed = random() * Math.PI * 2;
      // Bound the full return to sea; drag makes the real flight shorter.
      sheet.life = sheet.up * 2 / GRAVITY + .15;
    }
  }

  setSun(direction: THREE.Vector3): void { this.sun.copy(direction); }

  advance(dt: number): void {
    for (const sheet of this.sheets) if (sheet.age < sheet.life) sheet.age += dt;
  }

  publish(camera: THREE.Camera): void {
    this.active.length = 0;
    for (const sheet of this.sheets) {
      if (sheet.age < 0 || sheet.age >= sheet.life) continue;
      const travel = -Math.expm1(-DRAG * sheet.age) / DRAG;
      const fall = GRAVITY / DRAG * (sheet.age - travel);
      if (sheet.up * travel - fall <= 0) continue;
      sheet.distance = sheet.origin.distanceToSquared(camera.position);
      this.active.push(sheet);
    }
    this.active.sort((a, b) => b.distance - a.distance);
    for (let index = 0; index < this.active.length; index++) {
      const sheet = this.active[index], age = sheet.age;
      const travel = -Math.expm1(-DRAG * age) / DRAG;
      const fall = GRAVITY / DRAG * (age - travel);
      const cosine = Math.cos(sheet.angle), sine = Math.sin(sheet.angle);
      const opening = 1 - Math.exp(-age * 38);
      const breakup = smooth(.65, 4.2 * Math.sqrt(sheet.scale), age);
      const fade = (1 - smooth(sheet.life * .55, sheet.life, age)) * opening;
      const sunlight = .66 + .22 * this.sun.y + .12 * (cosine * this.sun.x + sine * this.sun.z);
      for (let row = 0; row <= SEGMENTS; row++) {
        const along = row / SEGMENTS;
        const height = sheet.up * along * travel - fall;
        const radius = sheet.scale * .35 + sheet.out * travel * (.12 + .88 * along * along);
        const bend = Math.sin(along * 19 + sheet.seed) * Math.sin(along * 7 + sheet.seed)
          * (.45 + .35 * Math.min(age, 2)) * sheet.scale * opening;
        const folds = .64 + .5 * Math.sin(along * 12 + sheet.seed) ** 2;
        const width = sheet.width * folds * (1 - (sheet.crown ? .78 : .4) * along) * opening * (1 + age * .13);
        const centerX = sheet.origin.x + cosine * radius + sheet.leanX * travel * along;
        const centerZ = sheet.origin.z + sine * radius + sheet.leanZ * travel * along;
        const alpha = fade * smooth(0, .65 * sheet.scale, height) * (1 - smooth(.83, 1, along));
        // Dense lower water carries the sea's blue shadow; aerated tips scatter
        // more sky light. The shared sun follows time of day and battle weather.
        this.light.setRGB(.63 + .32 * along, .76 + .22 * along, .81 + .19 * along).multiplyScalar(sunlight);
        for (let side = 0; side < 2; side++) {
          const vertex = index * VERTICES + row * 2 + side;
          const lateral = (side - .5) * width + bend;
          this.position.setXYZ(vertex, centerX - sine * lateral, sheet.origin.y + Math.max(-.5, height), centerZ + cosine * lateral);
          this.color.setXYZ(vertex, this.light.r, this.light.g, this.light.b);
          this.opacity.setXY(vertex, alpha * .82, .38 + breakup * .34 + along * .05);
        }
      }
    }
    this.mesh.geometry.setDrawRange(0, this.active.length * SEGMENTS * 6);
    for (const buffer of [this.position, this.color, this.opacity]) {
      buffer.clearUpdateRanges();
      if (this.active.length) buffer.addUpdateRange(0, this.active.length * VERTICES * buffer.itemSize);
      buffer.needsUpdate = true;
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
