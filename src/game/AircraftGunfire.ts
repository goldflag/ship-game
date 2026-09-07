import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { CombatEvent, CombatSimulation } from '../simulation/combat';
import { FIXED_DT } from '../simulation/ship';
import { ballisticStep } from '../simulation/ballistics';
import { effectTexture } from './EffectParticles';
import { ExpandableInstances } from './ExpandableInstances';

const CAPACITY = 512;
const UP = new THREE.Vector3(0, 1, 0);
/** Short moving exposures of a burst; event snapshots keep shots independent of later target motion. */
export class AircraftGunfire {
  readonly root = new THREE.Group();
  private readonly tracerMap = effectTexture('tracer');
  private readonly flashMap = effectTexture('flash');
  private readonly ribbons = this.batch('Aircraft tracer envelopes', this.tracerMap, '#ffae50', 2.5);
  private readonly cores = this.batch('Aircraft tracer cores', this.tracerMap, '#fff1c9', 4);
  private readonly tips = this.batch('Aircraft tracer tips', this.flashMap, '#ffd79a', 3);
  private readonly muzzles = this.batch('Aircraft gun flashes', this.flashMap, '#ffe2aa', 3);
  private readonly dummy = new THREE.Object3D();
  private readonly pose = new THREE.Quaternion();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private count = 0;
  private readonly active = new Map<number, CombatEvent>();
  private sequence = 0;
  private damage?: CombatSimulation['player']['damage'];
  constructor() {
    this.root.name = 'Aircraft gunfire';
    this.root.add(this.ribbons, this.cores, this.tips, this.muzzles);
  }
  private batch(name: string, map: THREE.DataTexture, color: string, intensity: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('tracerOpacity', new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicNodeMaterial({ map, color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: true, alphaTest: .02, side: THREE.DoubleSide });
    material.opacityNode = attribute('tracerOpacity', 'float'); material.forceSinglePass = true;
    const mesh = new ExpandableInstances(geometry, material, CAPACITY);
    mesh.name = name; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceMatrix.array.fill(0);
    return mesh;
  }
  private write(mesh: ExpandableInstances<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>, index: number, opacity: number) {
    this.dummy.updateMatrix(); mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.setScalarAttributeAt('tracerOpacity', index, opacity);
  }
  update(sim: CombatSimulation, camera: THREE.Camera) {
    let count = 0, flashes = 0;
    const now = (sim.tick - 1 + sim.interpolationAlpha) * FIXED_DT;
    // Reset replaces damage state even when a new battle catches up to the same tick.
    if (this.damage !== sim.player.damage) { this.active.clear(); this.sequence = 0; this.damage = sim.player.damage; }
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind === 'aircraft-fire' && event.aircraft?.target) this.active.set(event.sequence, event);
    }
    for (const [id, event] of this.active) {
      const age = now - event.tick * FIXED_DT;
      const data = event.aircraft!, attitude = data.attitude;
      const aa = data.tracerSpeed !== undefined, speed = data.tracerSpeed ?? 720;
      this.pose.setFromEuler(new THREE.Euler(attitude?.pitch ?? 0, -(attitude?.heading ?? 0), attitude?.bank ?? 0, 'YXZ'));
      const range = this.direction.fromArray(data.target!).sub(new THREE.Vector3(...event.position)).length();
      this.direction.fromArray(data.direction ?? this.direction.normalize().toArray());
      // Light AA keeps flying beyond the sampled target, then burns out gradually.
      // Heavy AA terminates exactly at the CPU's sampled burst time and position.
      const life = data.airburst?.flightTime ?? (aa ? Math.max(3, range / speed + 1) : Math.min(.95, (range + 100) / speed));
      if (age > life + (aa ? 0 : .208)) { this.active.delete(id); continue; }
      if (age < 0) continue;
      for (let round = 0; round < (aa ? 1 : 3); round++) for (const side of aa ? [0] : [-1, 1]) {
        const delay = aa ? 0 : round * .095 + (side > 0 ? .018 : 0), flight = age - delay;
        if (flight < 0 || flight > life) continue;
        this.origin.set(side * 2.4, aa ? 0 : -.25, aa ? 0 : -1.15).applyQuaternion(this.pose).add(new THREE.Vector3(...event.position));
        this.velocity.fromArray(data.velocity ?? [0, 0, 0]);
        this.origin.addScaledVector(this.velocity, delay);
        this.velocity.addScaledVector(this.direction, speed);
        // Tiny fixed dispersion separates the streams without homing or random frame flicker.
        if (!aa) {
          this.velocity.x += Math.sin(event.sequence * 7 + round * 3 + side) * 1.4;
          this.velocity.y += Math.cos(event.sequence * 3 + round + side) * 1.1;
        }
        if (flight < .038) {
          this.dummy.position.copy(this.origin).addScaledVector(this.velocity, flight * .08);
          this.dummy.quaternion.copy(camera.quaternion); this.dummy.scale.setScalar(.7);
          this.write(this.muzzles, flashes++, 1 - flight / .038);
        }
        const shot = ballisticStep(this.origin.toArray(), this.velocity.toArray(), flight, data.dragPerSecond ?? 0);
        this.dummy.position.fromArray(shot.position);
        this.velocity.fromArray(shot.velocity);
        if (this.dummy.position.y < 0) continue;
        const opacity = data.airburst ? 1 : THREE.MathUtils.smoothstep(life - flight, 0, aa ? .65 : .12);
        this.normal.copy(this.dummy.position).applyMatrix4(camera.matrixWorldInverse);
        const depth = camera.projectionMatrix.elements[11] === -1 ? Math.max(.1, -this.normal.z) : 1;
        const viewHeight = 2 * depth / camera.projectionMatrix.elements[5];
        const width = Math.max(.12, Math.min(2.4, viewHeight * .0012));
        this.dummy.quaternion.copy(camera.quaternion); this.dummy.scale.setScalar(width * 2.2);
        this.write(this.tips, count, opacity * .65);
        const length = this.velocity.length() * Math.min(.022, flight);
        this.velocity.normalize(); this.dummy.position.addScaledVector(this.velocity, -length / 2);
        this.normal.subVectors(camera.position, this.dummy.position).normalize();
        this.across.crossVectors(this.velocity, this.normal);
        if (this.across.lengthSq() < 1e-8) this.across.crossVectors(this.velocity, Math.abs(this.velocity.y) < .9 ? UP : new THREE.Vector3(1, 0, 0));
        this.across.normalize(); this.normal.crossVectors(this.across, this.velocity).normalize();
        this.basis.makeBasis(this.across, this.velocity, this.normal);
        this.dummy.quaternion.setFromRotationMatrix(this.basis);
        this.dummy.scale.set(width * 2.6, length, 1); this.write(this.ribbons, count, opacity * .65);
        this.dummy.scale.x = width * .65; this.write(this.cores, count++, opacity);
      }
    }
    this.count = count;
    for (const mesh of [this.ribbons, this.cores, this.tips, this.muzzles]) {
      const used = mesh === this.muzzles ? flashes : count;
      mesh.publish(used);
    }
  }
  diagnostics() { return this.count; }
  dispose() {
    for (const mesh of [this.ribbons, this.cores, this.tips, this.muzzles]) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
    this.tracerMap.dispose(); this.flashMap.dispose(); this.root.removeFromParent();
  }
}
