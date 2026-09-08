import * as THREE from 'three/webgpu';
import { attribute, mix, positionLocal, uv, vec3 } from 'three/tsl';
import type { Shell } from '../simulation/damage';
import { ExpandableInstances } from './ExpandableInstances';

const LIFE = 1.25, SAMPLE_INTERVAL = .05, CAPACITY = 1024;
type Sample = { position: THREE.Vector3; age: number };
type Trail = { shell: Shell; samples: Sample[]; head: THREE.Vector3; velocity: THREE.Vector3; headAge: number; age: number };

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
  private readonly basis = new THREE.Matrix4();
  private readonly dummy = new THREE.Object3D();
  private count = 0;

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (const name of ['tailOpacity', 'headOpacity', 'tailWidth', 'headWidth']) geometry.setAttribute(name,
      new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage));
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
      if (shell.bomb || shell.lodged || shell.waterDragPerSecond !== undefined) continue;
      let trail = this.trails.get(shell.id);
      if (!trail || trail.shell !== shell || shell.age < trail.samples.at(-1)!.age) {
        // Only backfill the launch tick; never invent a long straight path when
        // the renderer first encounters an already flying/deflected shell.
        const age = Math.min(shell.age, 1 / 60);
        const position = new THREE.Vector3(...shell.position).addScaledVector(new THREE.Vector3(...shell.velocity), -age);
        trail = { shell, samples: [{ position, age: shell.age - age }], head: new THREE.Vector3(...shell.position),
          velocity: new THREE.Vector3(...shell.velocity).normalize(), headAge: shell.age, age: shell.age };
        this.trails.set(shell.id, trail);
      }
      // Keep the last observed corner on a ricochet even between sample times.
      this.direction.fromArray(shell.velocity).normalize();
      if (trail.velocity.dot(this.direction) < .96 && trail.headAge > trail.samples.at(-1)!.age)
        trail.samples.push({ position: trail.head.clone(), age: trail.headAge });
      trail.velocity.copy(this.direction);
      trail.age = shell.age; trail.headAge = shell.age; trail.head.fromArray(shell.position);
      const last = trail.samples.at(-1)!;
      if (shell.age - last.age >= SAMPLE_INTERVAL) trail.samples.push({ position: trail.head.clone(), age: shell.age });
    }
    camera.getWorldPosition(this.cameraPosition);
    const perspective = camera.projectionMatrix.elements[11] === -1;
    const near = perspective ? (camera as THREE.PerspectiveCamera).near : 0;
    this.count = 0;
    for (const [id, trail] of this.trails) {
      const cutoff = trail.age - LIFE;
      while (trail.samples.length > 96 || (trail.samples.length > 1 && trail.samples[1].age <= cutoff)) trail.samples.shift();
      const endAge = trail.headAge;
      if (endAge <= cutoff) { this.trails.delete(id); continue; }
      for (let i = 0; i < trail.samples.length; i++) {
        const a = trail.samples[i], b = trail.samples[i + 1];
        const end = b?.position ?? trail.head;
        let age = b?.age ?? endAge;
        if (age <= cutoff) continue;
        let startAge = Math.max(a.age, cutoff);
        this.start.copy(a.position).lerp(end, age > a.age ? (startAge - a.age) / (age - a.age) : 0);
        this.end.copy(end);
        let tailDepth = perspective ? -this.normal.copy(this.start).applyMatrix4(camera.matrixWorldInverse).z : 1;
        let headDepth = perspective ? -this.normal.copy(this.end).applyMatrix4(camera.matrixWorldInverse).z : 1;
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
        this.direction.divideScalar(length);
        this.dummy.position.copy(this.start).addScaledVector(this.direction, length / 2);
        this.normal.subVectors(this.cameraPosition, this.dummy.position).normalize();
        this.across.crossVectors(this.direction, this.normal);
        if (this.across.lengthSq() < 1e-8) {
          this.normal.set(Math.abs(this.direction.x) > .9 ? 0 : 1, Math.abs(this.direction.x) > .9 ? 1 : 0, 0);
          this.across.crossVectors(this.direction, this.normal);
        }
        this.across.normalize(); this.normal.crossVectors(this.across, this.direction).normalize();
        this.basis.makeBasis(this.across, this.direction, this.normal);
        this.dummy.quaternion.setFromRotationMatrix(this.basis);
        const caliber = Math.sqrt(trail.shell.caliberM / .38);
        // Size each endpoint by projected depth. A physical minimum or one
        // midpoint width makes near ribbons fat and forced the old 65 m hide.
        const width = (depth: number) => Math.min(10, 2 * depth / camera.projectionMatrix.elements[5] * .0032) * caliber;
        this.mesh.setScalarAttributeAt('tailWidth', this.count, width(tailDepth));
        this.mesh.setScalarAttributeAt('headWidth', this.count, width(headDepth));
        this.dummy.scale.set(1, length, 1);
        this.dummy.updateMatrix(); this.mesh.setMatrixAt(this.count, this.dummy.matrix);
        const opacity = (sampleAge: number) => .48 * caliber * THREE.MathUtils.smoothstep(1 - (trail.age - sampleAge) / LIFE, 0, 1);
        this.mesh.setScalarAttributeAt('tailOpacity', this.count, opacity(startAge));
        this.mesh.setScalarAttributeAt('headOpacity', this.count, opacity(age));
        this.count++;
      }
    }
    this.mesh.publish(this.count);
  }

  diagnostics() { return { histories: this.trails.size, segments: this.count }; }
  reset(): void { this.trails.clear(); this.count = 0; this.mesh.publish(0); }
  dispose(): void { this.reset(); this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
