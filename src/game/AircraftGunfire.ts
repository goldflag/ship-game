import type { BattleSession } from './session/BattleSession';
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { CombatEvent } from '../simulation/combat';
import type { Vec3 } from '../ships/blueprint';
import { FIXED_DT } from '../simulation/ship';
import { ballisticStep } from '../simulation/ballistics';
import { effectTexture } from './EffectParticles';
import { ExpandableInstances } from './ExpandableInstances';

const CAPACITY = 512;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const AA_SIDES = [0], FIGHTER_SIDES = [-1, 1];
interface TracerBurst {
  tick: number;
  aa: boolean;
  airburst: boolean;
  life: number;
  drag: number;
  caliberScale: number;
  exposure: number;
  shots: { delay: number; origin: Vec3; velocity: Vec3 }[];
}
/** Short moving exposures of a burst; event snapshots keep shots independent of later target motion. */
export class AircraftGunfire {
  readonly root = new THREE.Group();
  private readonly tracerMap = effectTexture('tracer');
  private readonly flashMap = effectTexture('flash');
  private readonly ribbons = this.batch('Aircraft tracer envelopes', this.tracerMap, '#ffae50', 2.5);
  private readonly cores = this.batch('Aircraft tracer cores', this.tracerMap, '#fff1c9', 4);
  private readonly tips = this.batch('Aircraft tracer tips', this.flashMap, '#ffd79a', 3);
  private readonly muzzles = this.batch('Aircraft gun flashes', this.flashMap, '#ffe2aa', 3);
  private readonly position = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly pose = new THREE.Quaternion();
  private readonly attitude = new THREE.Euler();
  private readonly eventOrigin = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere();
  private count = 0;
  private readonly active = new Map<number, TracerBurst>();
  private sequence = 0;
  private damage?: BattleSession['player']['damage'];
  constructor(private readonly cullOffscreen = false) {
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
    mesh.setMatrixAt(index, this.matrix.compose(this.position, this.orientation, this.scale));
    mesh.setScalarAttributeAt('tracerOpacity', index, opacity);
  }
  private prepare(event: CombatEvent): TracerBurst {
    const data = event.aircraft!, attitude = data.attitude;
    const aa = data.tracerSpeed !== undefined, speed = data.tracerSpeed ?? 720;
    this.pose.setFromEuler(this.attitude.set(attitude?.pitch ?? 0, -(attitude?.heading ?? 0), attitude?.bank ?? 0, 'YXZ'));
    this.eventOrigin.fromArray(event.position);
    const range = this.direction.fromArray(data.target!).sub(this.eventOrigin).length();
    if (data.direction) this.direction.fromArray(data.direction); else this.direction.normalize();
    // Light AA keeps flying beyond the sampled target, then burns out gradually.
    // Heavy AA terminates exactly at the CPU's sampled burst time and position.
    const life = data.airburst?.flightTime ?? (aa ? Math.max(3, range / speed + 1) : Math.min(.95, (range + 100) / speed));
    const caliber = data.caliberM ?? data.airburst?.caliberM ?? .02;
    const caliberScale = aa ? Math.sqrt(caliber / .105) : 1;
    const shots: TracerBurst['shots'] = [];
    // Event launch snapshots are immutable. Compute each delayed muzzle pose,
    // inherited velocity and fixed dispersion once, retaining double precision.
    for (let round = 0; round < (aa ? 1 : 3); round++) for (const side of aa ? AA_SIDES : FIGHTER_SIDES) {
      const delay = aa ? 0 : round * .095 + (side > 0 ? .018 : 0);
      this.origin.set(side * 2.4, aa ? 0 : -.25, aa ? 0 : -1.15).applyQuaternion(this.pose).add(this.eventOrigin);
      if (data.velocity) this.velocity.fromArray(data.velocity); else this.velocity.set(0, 0, 0);
      this.origin.addScaledVector(this.velocity, delay);
      this.velocity.addScaledVector(this.direction, speed);
      if (!aa) {
        this.velocity.x += Math.sin(event.sequence * 7 + round * 3 + side) * 1.4;
        this.velocity.y += Math.cos(event.sequence * 3 + round + side) * 1.1;
      }
      shots.push({ delay, origin: this.origin.toArray(), velocity: this.velocity.toArray() });
    }
    return { tick: event.tick, aa, airburst: !!data.airburst, life, drag: data.dragPerSecond ?? 0, caliberScale,
      exposure: aa ? .022 * THREE.MathUtils.clamp(caliberScale, .55, 1.2) : .022, shots };
  }
  update(sim: BattleSession, camera: THREE.Camera) {
    let count = 0, flashes = 0;
    const cull = this.cullOffscreen && (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    if (cull) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    const now = (sim.tick - 1 + sim.interpolationAlpha) * FIXED_DT;
    // Reset replaces damage state even when a new battle catches up to the same tick.
    if (this.damage !== sim.player.damage) { this.active.clear(); this.sequence = 0; this.damage = sim.player.damage; }
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind === 'aircraft-fire' && event.aircraft?.target) this.active.set(event.sequence, this.prepare(event));
    }
    for (const [id, burst] of this.active) {
      const age = now - burst.tick * FIXED_DT;
      const { aa, life, caliberScale, exposure } = burst;
      if (age > life + (aa ? 0 : .208)) { this.active.delete(id); continue; }
      if (age < 0) continue;
      for (const launch of burst.shots) {
        const flight = age - launch.delay;
        if (flight < 0 || flight > life) continue;
        if (flight < .038) {
          this.position.fromArray(launch.origin).addScaledVector(this.velocity.fromArray(launch.velocity), flight * .08);
          this.orientation.copy(camera.quaternion); this.scale.setScalar(.7);
          if (!cull || this.frustum.intersectsSphere(this.bounds.set(this.position, .5))) this.write(this.muzzles, flashes++, 1 - flight / .038);
        }
        const shot = ballisticStep(launch.origin, launch.velocity, flight, burst.drag);
        this.position.fromArray(shot.position);
        this.velocity.fromArray(shot.velocity);
        if (this.position.y < 0) continue;
        const opacity = burst.airburst ? 1 : THREE.MathUtils.smoothstep(life - flight, 0, aa ? .65 : .12);
        this.normal.copy(this.position).applyMatrix4(camera.matrixWorldInverse);
        const depth = camera.projectionMatrix.elements[11] === -1 ? Math.max(.1, -this.normal.z) : 1;
        const viewHeight = 2 * depth / camera.projectionMatrix.elements[5];
        const width = Math.max(.12, Math.min(2.4, viewHeight * .0012)) * caliberScale * (aa ? .95 : 1);
        const length = this.velocity.length() * Math.min(exposure, flight);
        // The sphere around the tip encloses the entire trailing ribbon and
        // its billboard tip. Keep the event alive so camera re-entry samples
        // the current trajectory, even after the history ring evicts the shot.
        if (cull && !this.frustum.intersectsSphere(this.bounds.set(this.position, length + width * 2))) continue;
        this.orientation.copy(camera.quaternion); this.scale.setScalar(width * (aa ? 1.5 : 2.2));
        this.write(this.tips, count, opacity * (aa ? .35 : .65));
        this.velocity.normalize(); this.position.addScaledVector(this.velocity, -length / 2);
        this.normal.subVectors(camera.position, this.position).normalize();
        this.across.crossVectors(this.velocity, this.normal);
        if (this.across.lengthSq() < 1e-8) this.across.crossVectors(this.velocity, Math.abs(this.velocity.y) < .9 ? UP : RIGHT);
        this.across.normalize(); this.normal.crossVectors(this.across, this.velocity).normalize();
        this.basis.makeBasis(this.across, this.velocity, this.normal);
        this.orientation.setFromRotationMatrix(this.basis);
        this.scale.set(width * (aa ? 2.3 : 2.6), length, 1); this.write(this.ribbons, count, opacity * (aa ? .55 : .65));
        this.scale.x = width * (aa ? .85 : .65); this.write(this.cores, count++, opacity);
      }
    }
    this.count = count;
    for (const mesh of [this.ribbons, this.cores, this.tips, this.muzzles]) {
      const used = mesh === this.muzzles ? flashes : count;
      mesh.publish(used);
    }
  }
  reset(): void {
    this.active.clear(); this.sequence = 0; this.count = 0; this.damage = undefined;
    for (const mesh of [this.ribbons, this.cores, this.tips, this.muzzles]) mesh.publish(0);
  }
  diagnostics() { return this.count; }
  dispose() {
    for (const mesh of [this.ribbons, this.cores, this.tips, this.muzzles]) { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
    this.tracerMap.dispose(); this.flashMap.dispose(); this.root.removeFromParent();
  }
}
