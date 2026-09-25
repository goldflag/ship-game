import type { BattleSession } from './session/BattleSession';
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { Vec3 } from '../ships/blueprint';
import { FIXED_DT } from './session/motion';
import { GRAVITY, ballisticStepInto, travelFactor } from './ballistics';
import { SHELL_PACE } from '../ships/mobility';
import { effectTexture } from './EffectParticles';
import { ExpandableInstances } from './ExpandableInstances';
import { writeInstancePose } from './instancePose';
import type { CombatEvent } from '../game/session/elements';

const CAPACITY = 512;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const AA_SIDES = [0], FIGHTER_SIDES = [-1, 1];
interface TracerBurst {
  /** The firing event's sequence, which keys the burst. */
  sequence: number;
  tick: number;
  aa: boolean;
  airburst: boolean;
  life: number;
  drag: number;
  /** Physical shell seconds per battle second: ship AA fire runs at shell pace. */
  pace: number;
  caliberScale: number;
  exposure: number;
  shots: { delay: number; origin: Vec3; velocity: Vec3 }[];
  /** A sphere (x, y, z, radius) holding every muzzle flash and tracer sphere the burst's culling tests over its whole life. */
  bound: [number, number, number, number];
}
/** A sphere around everything the culling tests for a burst whose shots fly `seconds` of shell time: each shot lies on
 * origin + velocity × travelFactor + (0, -drop, 0), with the travel factor at most the time and the drop at most a vacuum's,
 * so inside the box that segment sweeps down; the tracer's own sphere (its length, at most the fastest a shell can fly
 * over one exposure, and twice its widest width) and the muzzle flash's (half a metre, a few metres out) are added, with a
 * metre to spare for rounding. */
export function burstBound(shots: readonly { origin: Vec3; velocity: Vec3 }[], seconds: number, drag: number, pace: number, exposure: number, widthScale: number): [number, number, number, number] {
  // A negative drag would drop a shell further than a vacuum does: no bound then.
  if (!(drag >= 0)) return [0, 0, 0, Infinity];
  const fall = GRAVITY * seconds * seconds / 2;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, fastest = 0;
  for (const { origin, velocity } of shots) {
    const travel = Math.max(0, travelFactor(seconds, drag)), speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const endX = origin[0] + velocity[0] * travel, endY = origin[1] + velocity[1] * travel, endZ = origin[2] + velocity[2] * travel;
    minX = Math.min(minX, origin[0], endX); maxX = Math.max(maxX, origin[0], endX);
    minY = Math.min(minY, origin[1] - fall, endY - fall); maxY = Math.max(maxY, origin[1], endY);
    minZ = Math.min(minZ, origin[2], endZ); maxZ = Math.max(maxZ, origin[2], endZ);
    fastest = Math.max(fastest, speed);
  }
  const tracer = (fastest + GRAVITY * seconds) * pace * exposure + 2 * 2.4 * widthScale, muzzle = .5 + fastest * .08 * .038;
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + Math.max(tracer, muzzle) + 1;
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, radius * (1 + 1e-9)];
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
  private readonly orientation = new THREE.Quaternion();
  private readonly pose = new THREE.Quaternion();
  private readonly attitude = new THREE.Euler();
  private readonly eventOrigin = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  /** The frustum's planes as (normal, constant) quadruples, read without a Plane and Vector3 per test. */
  private readonly planes = new Float64Array(24);
  private readonly projection = new THREE.Matrix4();
  private readonly step = new Float64Array(6);
  private count = 0;
  /** Cull whole bursts by their bounds before their shots' own tests (off: every shot is tested, with the same result). */
  bounds = true;
  private readonly active = new Map<number, TracerBurst>();
  private sequence = 0;
  private damage?: BattleSession['player']['damage'];
  constructor(private readonly cullOffscreen = false) {
    this.root.name = 'Aircraft gunfire';
    this.root.add(this.ribbons, this.cores, this.tips, this.muzzles);
  }
  private batch(name: string, map: THREE.DataTexture, color: string, intensity: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('tracerOpacity', new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1));
    const material = new THREE.MeshBasicNodeMaterial({ map, color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: true, alphaTest: .02, side: THREE.DoubleSide });
    material.opacityNode = attribute('tracerOpacity', 'float'); material.forceSinglePass = true;
    const mesh = new ExpandableInstances(geometry, material, CAPACITY);
    mesh.name = name; mesh.frustumCulled = false;
    mesh.instanceMatrix.array.fill(0);
    return mesh;
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
    const pace = aa ? SHELL_PACE : 1;
    const life = data.airburst?.flightTime ?? (aa ? Math.max(3, range / speed / pace + 1) : Math.min(.95, (range + 100) / speed));
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
    const exposure = aa ? .022 * THREE.MathUtils.clamp(caliberScale, .55, 1.2) : .022;
    return { sequence: event.sequence, tick: event.tick, aa, airburst: !!data.airburst, life, drag: data.dragPerSecond ?? 0, pace, caliberScale, exposure, shots,
      bound: burstBound(shots, life * pace, data.dragPerSecond ?? 0, pace, exposure, caliberScale * (aa ? .95 : 1)) };
  }
  /** Whether a sphere is at least partly inside the culling frustum: Frustum.intersectsSphere without the Sphere, each
   * plane's distance summed as Plane.distanceToPoint sums it. */
  private inView(x: number, y: number, z: number, radius: number): boolean {
    const p = this.planes, reach = -radius;
    return !(p[0] * x + p[1] * y + p[2] * z + p[3] < reach || p[4] * x + p[5] * y + p[6] * z + p[7] < reach
      || p[8] * x + p[9] * y + p[10] * z + p[11] < reach || p[12] * x + p[13] * y + p[14] * z + p[15] < reach
      || p[16] * x + p[17] * y + p[18] * z + p[19] < reach || p[20] * x + p[21] * y + p[22] * z + p[23] < reach);
  }
  /** One billboard or ribbon: its pose composed straight into the batch, and its opacity. */
  private place(mesh: ExpandableInstances<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>, index: number, px: number, py: number, pz: number,
    x: number, y: number, z: number, w: number, sx: number, sy: number, sz: number, opacity: number) {
    const page = mesh.page(index), slot = index % CAPACITY;
    writeInstancePose(page.instanceMatrix.array as Float32Array, slot * 16, px, py, pz, x, y, z, w, sx, sy, sz);
    (page.geometry.attributes.tracerOpacity.array as Float32Array)[slot] = opacity;
  }
  /** Tracer poses use three's vector arithmetic written out in place (normalize, cross, the ballistic step), operation for
   * operation, so every float matches the Vector3/Matrix4 path without its per-shot objects. */
  update(sim: BattleSession, camera: THREE.Camera) {
    let count = 0, flashes = 0;
    const cull = this.cullOffscreen && (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    if (cull) {
      this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
      for (let i = 0; i < 6; i++) {
        const { normal, constant } = this.frustum.planes[i];
        this.planes[i * 4] = normal.x; this.planes[i * 4 + 1] = normal.y; this.planes[i * 4 + 2] = normal.z; this.planes[i * 4 + 3] = constant;
      }
    }
    const now = (sim.tick - 1 + sim.interpolationAlpha) * FIXED_DT;
    // Reset replaces damage state even when a new battle catches up to the same tick.
    if (this.damage !== sim.player.damage) { this.active.clear(); this.sequence = 0; this.damage = sim.player.damage; }
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind === 'aircraft-fire' && event.aircraft?.target) this.active.set(event.sequence, this.prepare(event));
    }
    const view = camera.matrixWorldInverse.elements, projection = camera.projectionMatrix.elements, perspective = projection[11] === -1;
    const rotation = camera.quaternion, qx = rotation.x, qy = rotation.y, qz = rotation.z, qw = rotation.w;
    const eye = camera.position, step = this.step, basis = this.basis, orientation = this.orientation;
    for (const burst of this.active.values()) {
      const age = now - burst.tick * FIXED_DT;
      const { aa, life, caliberScale, exposure } = burst;
      if (age > life + (aa ? 0 : .208)) { this.active.delete(burst.sequence); continue; }
      if (age < 0) continue;
      // A burst wholly outside the view places nothing: every test below would cull each of its shots.
      if (cull && this.bounds && !this.inView(burst.bound[0], burst.bound[1], burst.bound[2], burst.bound[3])) continue;
      for (const launch of burst.shots) {
        const flight = age - launch.delay;
        if (flight < 0 || flight > life) continue;
        if (flight < .038) {
          const origin = launch.origin, velocity = launch.velocity, s = flight * .08;
          const x = origin[0] + velocity[0] * s, y = origin[1] + velocity[1] * s, z = origin[2] + velocity[2] * s;
          if (!cull || this.inView(x, y, z, .5)) this.place(this.muzzles, flashes++, x, y, z, qx, qy, qz, qw, .7, .7, .7, 1 - flight / .038);
        }
        ballisticStepInto(step, launch.origin, launch.velocity, flight * burst.pace, burst.drag);
        let px = step[0], py = step[1], pz = step[2], vx = step[3], vy = step[4], vz = step[5];
        if (py < 0) continue;
        const opacity = burst.airburst ? 1 : THREE.MathUtils.smoothstep(life - flight, 0, aa ? .65 : .12);
        // The view-space depth, as Vector3.applyMatrix4 computes it.
        const w = 1 / (view[3] * px + view[7] * py + view[11] * pz + view[15]);
        const depth = perspective ? Math.max(.1, -((view[2] * px + view[6] * py + view[10] * pz + view[14]) * w)) : 1;
        const viewHeight = 2 * depth / projection[5];
        const width = Math.max(.12, Math.min(2.4, viewHeight * .0012)) * caliberScale * (aa ? .95 : 1);
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz), length = speed * burst.pace * Math.min(exposure, flight);
        // The sphere around the tip encloses the entire trailing ribbon and
        // its billboard tip. Keep the event alive so camera re-entry samples
        // the current trajectory, even after the history ring evicts the shot.
        if (cull && !this.inView(px, py, pz, length + width * 2)) continue;
        const tip = width * (aa ? 1.5 : 2.2);
        this.place(this.tips, count, px, py, pz, qx, qy, qz, qw, tip, tip, tip, opacity * (aa ? .35 : .65));
        // The ribbon's axis: the flight direction, the midpoint half a length back, and the side facing the camera.
        const unit = 1 / (speed || 1), back = -length / 2;
        vx *= unit; vy *= unit; vz *= unit;
        px += vx * back; py += vy * back; pz += vz * back;
        let nx = eye.x - px, ny = eye.y - py, nz = eye.z - pz;
        const toEye = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        nx *= toEye; ny *= toEye; nz *= toEye;
        let ax = vy * nz - vz * ny, ay = vz * nx - vx * nz, az = vx * ny - vy * nx;
        if (ax * ax + ay * ay + az * az < 1e-8) {
          const side = Math.abs(vy) < .9 ? UP : RIGHT;
          ax = vy * side.z - vz * side.y; ay = vz * side.x - vx * side.z; az = vx * side.y - vy * side.x;
        }
        const across = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
        ax *= across; ay *= across; az *= across;
        nx = ay * vz - az * vy; ny = az * vx - ax * vz; nz = ax * vy - ay * vx;
        const facing = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        nx *= facing; ny *= facing; nz *= facing;
        // Matrix4.makeBasis(across, velocity, normal), then its rotation.
        orientation.setFromRotationMatrix(basis.set(ax, vx, nx, 0, ay, vy, ny, 0, az, vz, nz, 0, 0, 0, 0, 1));
        const { x, y, z, w: ow } = orientation;
        this.place(this.ribbons, count, px, py, pz, x, y, z, ow, width * (aa ? 2.3 : 2.6), length, 1, opacity * (aa ? .55 : .65));
        this.place(this.cores, count++, px, py, pz, x, y, z, ow, width * (aa ? .85 : .65), length, 1, opacity);
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
