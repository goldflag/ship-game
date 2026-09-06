import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const RIGHT = new THREE.Vector3(1, 0, 0);
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
export function effectTexture(kind: 'smoke' | 'flash' | 'foam'): THREE.DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const radius = Math.hypot(u, v);
    const coarse = noise(u * 3.8 + 11, v * 3.8 + 31);
    const detail = noise(u * 12 + 71, v * 12 + 53) * .65 + noise(u * 29 + 9, v * 29 + 17) * .35;
    const density = smooth((1 - radius + (coarse - .5) * .5) * 2.8) * (.5 + detail * .5);
    let alpha: number, light: number;
    if (kind === 'foam') {
      const ring = Math.exp(-(((radius - .69 + (coarse - .5) * .11) / .13) ** 2));
      alpha = ring * (.22 + detail * .78) * smooth((1 - radius) * 9);
      light = .8 + detail * .2;
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
  seed: number;
  opacity: number;
  drag: number;
  gravity: number;
  wind: number;
  angle: number;
  spin: number;
  stretch: number;
  fadeIn: number;
  align: 'billboard' | 'velocity' | 'water';
  waterline: boolean;
  distance: number;
}

/** One instance batch per material; fixed storage and back-to-front alpha sorting. */
export class EffectParticlePool {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly particles: EffectParticle[];
  private readonly active: EffectParticle[] = [];
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly sphere?: THREE.InstancedBufferAttribute;
  private readonly volume?: THREE.InstancedBufferAttribute;
  private readonly tint?: THREE.InstancedBufferAttribute;
  private readonly progress?: THREE.InstancedBufferAttribute;
  private readonly dummy = new THREE.Object3D();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly turn = new THREE.Quaternion();
  private readonly cameraInverse = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private cursor = 0;

  constructor(readonly capacity: number, map: THREE.DataTexture, private additive = false,
    volumeMaterial?: THREE.MeshBasicNodeMaterial) {
    const geometry = new THREE.PlaneGeometry(1, 1);
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
      this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.progress = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
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
    // Keep capacity fixed; dormant instances have zero scale/alpha and no fragments.
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.frustumCulled = false;
    this.particles = Array.from({ length: capacity }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(),
      color: new THREE.Color(), age: 0, life: 0, size: 1, growth: 0, growthDecay: 0, diffusion: 0,
      heat: 0, cooling: 1, density: 4, seed: 0, opacity: 1, drag: 0, gravity: 0,
      wind: 0, angle: 0, spin: 0, stretch: 1, fadeIn: 0, align: 'billboard', waterline: false, distance: 0 }));
  }

  emit(position: THREE.Vector3, sourceId?: string): EffectParticle {
    const p = this.particles[this.cursor++ % this.capacity];
    p.position.copy(position); p.velocity.set(0, 0, 0); p.color.setRGB(1, 1, 1);
    p.age = 0; p.life = 1; p.size = 1; p.growth = 0; p.opacity = 1;
    p.growthDecay = 0; p.diffusion = 0; p.heat = 0; p.cooling = 1; p.density = 4;
    p.seed = (this.cursor * .61803398875 % 1) * 100;
    p.drag = 0; p.gravity = 0; p.wind = 0; p.angle = 0; p.spin = 0;
    p.stretch = 1; p.fadeIn = 0; p.align = 'billboard'; p.waterline = false;
    p.sourceId = sourceId;
    return p;
  }

  update(dt: number, camera: THREE.Camera, wind: THREE.Vector3, hiddenSourceId?: string): void {
    this.active.length = 0;
    this.cameraInverse.copy(camera.quaternion).invert();
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
        if (p.waterline && p.position.y < .2 && previousAge >= 0) { p.age = p.life; continue; }
      }
      // Hidden smoke still ages and drifts, so leaving optics restores its current state.
      if (hiddenSourceId !== undefined && p.sourceId === hiddenSourceId) continue;
      p.distance = p.position.distanceToSquared(camera.position);
      this.active.push(p);
    }
    if (!this.additive) this.active.sort((a, b) => b.distance - a.distance);
    this.active.forEach((p, index) => {
      const t = p.age / p.life;
      const fade = (1 - smooth((t - .18) / .82)) * (p.fadeIn > 0 ? smooth(p.age / p.fadeIn) : 1);
      const expansion = p.growthDecay > 0 ? (1 - Math.exp(-p.age * p.growthDecay)) / p.growthDecay : p.age;
      const size = Math.max(.01, p.size + p.growth * expansion + p.diffusion * p.age);
      this.dummy.position.copy(p.position);
      let angle = p.angle;
      let stretch = p.stretch;
      if (p.align === 'water') {
        this.dummy.quaternion.setFromAxisAngle(RIGHT, -Math.PI / 2);
      } else {
        this.dummy.quaternion.copy(camera.quaternion);
        if (p.align === 'velocity') {
          this.direction.copy(p.velocity).applyQuaternion(this.cameraInverse);
          angle = Math.atan2(-this.direction.x, this.direction.y);
          stretch *= Math.max(.35, Math.hypot(this.direction.x, this.direction.y) / Math.max(.01, p.velocity.length()));
        }
      }
      this.turn.setFromAxisAngle(this.axis, angle);
      this.dummy.quaternion.multiply(this.turn);
      this.dummy.scale.set(size, size * stretch, 1);
      if (this.sphere && (camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const radiusSq = size * size / 4;
        if (p.distance > radiusSq * 1.01) {
          // A sphere's perspective silhouette extends beyond a diameter-sized
          // billboard. Face its center and bound the camera's tangent cone.
          this.dummy.lookAt(camera.position);
          const span = size * Math.sqrt(p.distance / (p.distance - radiusSq));
          this.dummy.scale.set(span, span, 1);
        } else {
          // Inside the volume, every screen ray may intersect gas. Cover the
          // viewport at a valid clip depth; the shader still uses the real sphere.
          this.dummy.quaternion.copy(camera.quaternion);
          this.dummy.position.set(0, 0, 0).unproject(camera);
          this.direction.set(1, 1, 0).unproject(camera).sub(this.dummy.position).applyQuaternion(this.cameraInverse);
          this.dummy.scale.set(Math.abs(this.direction.x) * 2, Math.abs(this.direction.y) * 2, 1);
        }
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
      this.mesh.setColorAt(index, p.color);
      this.alpha.setX(index, p.opacity * fade);
      if (this.sphere && this.volume && this.tint) {
        this.sphere.setXYZW(index, p.position.x, p.position.y, p.position.z, size / 2);
        this.volume.setXYZW(index, p.age, p.seed, p.heat * (1 - smooth(p.age / p.cooling)), p.density);
        this.tint.setXYZ(index, p.color.r, p.color.g, p.color.b);
        this.progress!.setX(index, t);
      }
    });
    this.alpha.array.fill(0, this.active.length);
    this.mesh.instanceMatrix.array.fill(0, this.active.length * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.alpha.needsUpdate = true;
    for (const buffer of [this.sphere, this.volume, this.tint, this.progress]) if (buffer) buffer.needsUpdate = true;
  }

  get count(): number { return this.active.length; }
  reset(): void {
    for (const p of this.particles) { p.age = 0; p.life = 0; }
    this.active.length = 0; this.cursor = 0;
    this.alpha.array.fill(0); this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.array.fill(0); this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
