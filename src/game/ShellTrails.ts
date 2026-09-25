import * as THREE from 'three/webgpu';
import { attribute, mix, positionLocal, uv, vec3 } from 'three/tsl';
import { ExpandableInstances } from './ExpandableInstances';
import type { Shell } from '../game/session/elements';

const LIFE = 1.25, SAMPLE_INTERVAL = .1, CAPACITY = 1024;
// Cosmetic work stays bounded even during very dense salvos. Physical rounds
// are rendered separately and never dropped by this budget.
const MAX_SEGMENTS = 8192, MAX_SAMPLES = 32;
type Sample = { position: THREE.Vector3; age: number };
type Trail = { ownerId: string; caliber: number; samples: Sample[]; first: number; size: number;
  head: THREE.Vector3; velocity: THREE.Vector3; headAge: number; age: number };

function sampleAt(trail: Trail, index: number): Sample { return trail.samples[(trail.first + index) % MAX_SAMPLES]; }
function append(trail: Trail, position: THREE.Vector3, age: number): void {
  if (trail.size === MAX_SAMPLES) { trail.first = (trail.first + 1) % MAX_SAMPLES; trail.size--; }
  const index = (trail.first + trail.size++) % MAX_SAMPLES;
  const sample = trail.samples[index] ??= { position: new THREE.Vector3(), age: 0 };
  sample.position.copy(position); sample.age = age;
}

class TrailMaterial extends THREE.MeshBasicNodeMaterial {
  override setupPosition(builder: THREE.NodeBuilder) {
    const width = mix(attribute('tailWidth', 'float'), attribute('headWidth', 'float'), uv().y);
    // Width belongs to the original quad's X axis. positionNode runs after
    // instancing in Three r185 and would scale the translated world position.
    positionLocal.assign(vec3(positionLocal.x.mul(width), positionLocal.y, positionLocal.z));
    return super.setupPosition(builder);
  }
}

/** Short, bounded histories of CPU positions. No ballistic or hit decisions. */
export class ShellTrails {
  readonly mesh: ExpandableInstances<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  private readonly trails = new Map<number, Trail>();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere();
  private count = 0;

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (const name of ['tailOpacity', 'headOpacity', 'tailWidth', 'headWidth']) geometry.setAttribute(name,
      new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1));
    const material = new TrailMaterial({ color: '#e2ddd0', transparent: true,
      // The sea postprocess needs depth from visible trail pixels, as for tips.
      depthWrite: true, alphaTest: .008, side: THREE.DoubleSide });
    const crossAxis = uv().x.sub(.5).mul(2);
    const crossSection = crossAxis.mul(crossAxis).mul(-7).exp();
    material.opacityNode = mix(attribute('tailOpacity', 'float'), attribute('headOpacity', 'float'), uv().y).mul(crossSection);
    material.forceSinglePass = true;
    this.mesh = new ExpandableInstances(geometry, material, CAPACITY);
    this.mesh.name = 'Shell vapor trails';
  }

  update(shells: readonly Shell[], dt: number, camera: THREE.Camera): void {
    for (const trail of this.trails.values()) trail.age += dt;
    for (const shell of shells) {
      if (shell.bomb || shell.waterDragPerSecond !== undefined) continue;
      let trail = this.trails.get(shell.id);
      // Worker/network snapshots replace objects. IDs and monotonically
      // increasing flight age identify a shot, not JavaScript object identity.
      if (!trail || trail.ownerId !== shell.ownerId || shell.age < trail.headAge) {
        // Only backfill the launch tick; never invent a long straight path when
        // the renderer first encounters an already flying/deflected shell.
        const age = Math.min(shell.age, 1 / 60);
        const position = new THREE.Vector3(...shell.position).addScaledVector(new THREE.Vector3(...shell.velocity), -age);
        trail = { ownerId: shell.ownerId, caliber: Math.sqrt(shell.caliberM / .38),
          samples: [], first: 0, size: 0, head: new THREE.Vector3(...shell.position),
          velocity: new THREE.Vector3(...shell.velocity).normalize(), headAge: shell.age, age: shell.age };
        append(trail, position, shell.age - age);
        this.trails.set(shell.id, trail);
      }
      // Keep the last observed corner on a ricochet even between sample times.
      this.direction.fromArray(shell.velocity).normalize();
      if (trail.velocity.dot(this.direction) < .96 && trail.headAge > sampleAt(trail, trail.size - 1).age)
        append(trail, trail.head, trail.headAge);
      trail.velocity.copy(this.direction);
      trail.age = shell.age; trail.headAge = shell.age; trail.head.fromArray(shell.position);
      const last = sampleAt(trail, trail.size - 1);
      if (shell.age - last.age >= SAMPLE_INTERVAL) append(trail, trail.head, shell.age);
    }
    camera.getWorldPosition(this.cameraPosition);
    const perspective = camera.projectionMatrix.elements[11] === -1;
    const near = perspective ? (camera as THREE.PerspectiveCamera).near : 0;
    const cull = perspective || (camera as THREE.OrthographicCamera).isOrthographicCamera;
    if (cull) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const widthScale = .0064 / camera.projectionMatrix.elements[5], view = camera.matrixWorldInverse.elements;
    // Depth in front of the camera: -z of Vector3.applyMatrix4(matrixWorldInverse), the same operations.
    const depthOf = (p: THREE.Vector3) => -((view[2] * p.x + view[6] * p.y + view[10] * p.z + view[14]) * (1 / (view[3] * p.x + view[7] * p.y + view[11] * p.z + view[15])));
    this.count = 0;
    for (const [id, trail] of this.trails) {
      const cutoff = trail.age - LIFE;
      while (trail.size > 1 && sampleAt(trail, 1).age <= cutoff) { trail.first = (trail.first + 1) % MAX_SAMPLES; trail.size--; }
      const endAge = trail.headAge;
      if (endAge <= cutoff) { this.trails.delete(id); continue; }
      for (let i = 0; i < trail.size && this.count < MAX_SEGMENTS; i++) {
        const a = sampleAt(trail, i), b = i + 1 < trail.size ? sampleAt(trail, i + 1) : undefined;
        const end = b?.position ?? trail.head;
        let age = b?.age ?? endAge;
        if (age <= cutoff) continue;
        let startAge = Math.max(a.age, cutoff);
        this.start.copy(a.position).lerp(end, age > a.age ? (startAge - a.age) / (age - a.age) : 0);
        this.end.copy(end);
        let tailDepth = perspective ? depthOf(this.start) : 1;
        let headDepth = perspective ? depthOf(this.end) : 1;
        if (tailDepth < near && headDepth < near) continue;
        // A followed trail passes beside and behind the camera. Clip before
        // widening it, so segments crossing the eye cannot fill the screen.
        if (tailDepth < near) {
          const t = (near - tailDepth) / (headDepth - tailDepth);
          this.start.lerp(this.end, t); startAge = THREE.MathUtils.lerp(startAge, age, t); tailDepth = near;
        } else if (headDepth < near) {
          const t = (near - headDepth) / (tailDepth - headDepth);
          this.end.lerp(this.start, t); age = THREE.MathUtils.lerp(age, startAge, t); headDepth = near;
        }
        const length = this.direction.subVectors(this.end, this.start).length();
        if (length < .001) continue;
        this.center.copy(this.start).addScaledVector(this.direction, .5);
        // Retain offscreen history, but skip its billboard work and GPU upload.
        // The radius includes the widest possible ribbon at either endpoint.
        if (cull && !this.frustum.intersectsSphere(this.bounds.set(this.center, length / 2 + 5 * trail.caliber))) continue;
        this.direction.divideScalar(length);
        this.normal.subVectors(this.cameraPosition, this.center).normalize();
        this.across.crossVectors(this.direction, this.normal);
        if (this.across.lengthSq() < 1e-8) {
          this.normal.set(Math.abs(this.direction.x) > .9 ? 0 : 1, Math.abs(this.direction.x) > .9 ? 1 : 0, 0);
          this.across.crossVectors(this.direction, this.normal);
        }
        this.across.normalize(); this.normal.crossVectors(this.across, this.direction).normalize();
        // Write the basis straight into the instance: Matrix4.makeBasis(across, direction, normal).setPosition(center),
        // with no quaternion, Object3D matrix update or per-frame sample/vector allocation.
        this.direction.multiplyScalar(length);
        const caliber = trail.caliber, page = this.mesh.page(this.count), slot = this.count % CAPACITY, attributes = page.geometry.attributes;
        const matrix = page.instanceMatrix.array as Float32Array, m = slot * 16, { across, direction, normal, center } = this;
        matrix[m] = across.x; matrix[m + 1] = across.y; matrix[m + 2] = across.z; matrix[m + 3] = 0;
        matrix[m + 4] = direction.x; matrix[m + 5] = direction.y; matrix[m + 6] = direction.z; matrix[m + 7] = 0;
        matrix[m + 8] = normal.x; matrix[m + 9] = normal.y; matrix[m + 10] = normal.z; matrix[m + 11] = 0;
        matrix[m + 12] = center.x; matrix[m + 13] = center.y; matrix[m + 14] = center.z; matrix[m + 15] = 1;
        // Size each endpoint by projected depth. A physical minimum or one
        // midpoint width makes near ribbons fat and forced the old 65 m hide.
        (attributes.tailWidth.array as Float32Array)[slot] = Math.min(10, tailDepth * widthScale) * caliber;
        (attributes.headWidth.array as Float32Array)[slot] = Math.min(10, headDepth * widthScale) * caliber;
        (attributes.tailOpacity.array as Float32Array)[slot] = .48 * caliber * THREE.MathUtils.smoothstep(1 - (trail.age - startAge) / LIFE, 0, 1);
        (attributes.headOpacity.array as Float32Array)[slot] = .48 * caliber * THREE.MathUtils.smoothstep(1 - (trail.age - age) / LIFE, 0, 1);
        this.count++;
      }
    }
    this.mesh.publish(this.count);
  }

  diagnostics() { return { histories: this.trails.size, segments: this.count }; }
  reset(): void { this.trails.clear(); this.count = 0; this.mesh.publish(0); }
  dispose(): void { this.reset(); this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
