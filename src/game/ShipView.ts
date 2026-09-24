import * as THREE from 'three/webgpu';
import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { barrelIds } from '../ships/blueprint';
import { radians, wrapAngle } from './geometry';
import { updateMountCarriers } from './mountFrames';
import { ShipInspection } from './ShipInspection';
import type { InspectionMode } from '../ships/inspection';
import { ShipImpactMarks } from './ShipImpactMarks';
import { tubeLocalPosition } from './torpedoAim';
import { PreparedPoseGroup } from './FrameScene';
import { ShipPoseMatrices } from './ShipPoseMatrices';
import { ShipRigView } from './ShipRigView';
import { setJointsX, setJointY, turnFrom } from './jointTurns';
import { gunAimPoints } from './gunAim';
import type { Combatant } from '../game/session/elements';
import { muzzleWorld, shotDirection } from './mountGeometry';

/** Renderer adapter. Simulation geometry and transforms come from the same definition. */
export class ShipView {
  renderActive = true;
  readonly root = new PreparedPoseGroup();
  readonly inspection: ShipInspection;
  readonly motion: Combatant['motion'];
  /** The berth's presentation sea motion, added to the session pose. A battle leaves it unset. */
  seaOffset?: { heave: number; roll: number; pitch: number };
  readonly impactMarks: ShipImpactMarks;
  readonly rig: ShipRigView;
  /** Original template materials identify surfaces that can share a fleet draw. */
  readonly renderMeshes: { mesh: THREE.Mesh; material: THREE.Material }[] = [];
  private damageSource: Combatant['damage'];
  private previousMotion: Combatant['motion'];
  private motionSource: Combatant['motion'];
  /** The previous tick as articulation reads it: each mount's train, elevation and recoil, and each launcher's train. */
  private readonly priorMounts: Float64Array;
  private readonly priorLaunchers: Float64Array;
  private renderedMounts: Combatant['mounts'];
  private renderedLaunchers: NonNullable<Combatant['torpedoLaunchers']>;
  private launcherBindings: THREE.Object3D[];
  private tubeBindings: THREE.Object3D[];
  get internals() { return this.inspection.root; }
  /** Per mount: its joints, the fixed yaw of its bearing (less a construction joint's own) and its recoil travel. */
  private bindings: { yaw: THREE.Object3D; elevation: THREE.Object3D[]; recoil: THREE.Object3D[]; muzzles: THREE.Object3D[]; bearing: number; recoilM: number }[];
  private gunCovers: { mesh: THREE.Mesh; elevation: THREE.Object3D; angles: number[]; baseAngle: number }[] = [];
  private surfaces: { material: THREE.MeshStandardMaterial | THREE.MeshStandardNodeMaterial; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  private inspecting = false;
  /** Whether any mount rides another, so that articulation derives carrier frames. */
  private readonly carried: boolean;
  /** Each impact-mark mesh with the receiver it was on and that receiver's pose, as of `markVersion`. */
  private markPoses: { mark: THREE.Object3D; receiver: THREE.Object3D | null; pose: number }[] = [];
  private markVersion = -1;
  /** Surface and moving-joint world matrices for rendering; the fleet's batches defer the ones they draw. */
  readonly poseMatrices: ShipPoseMatrices;
  private appendages: { node: THREE.Object3D; base: THREE.Quaternion; kind: keyof NonNullable<ShipDefinition['submarine']>['appendages']; index: number }[] = [];
  constructor(readonly model: THREE.Group, readonly definition: ShipDefinition, readonly actor: Combatant, reversedDepthBuffer = false) {
    this.motionSource = actor.motion;
    this.damageSource = actor.damage;
    this.motion = { ...actor.motion };
    this.previousMotion = { ...actor.motion };
    this.priorMounts = new Float64Array(actor.mounts.length * 3);
    this.carried = definition.mounts.some(m => !!m.parentMountId);
    this.renderedMounts = actor.mounts.map(m => ({ ...m }));
    this.renderedLaunchers = (definition.torpedoLaunchers ?? []).map(l => ({
      id: l.id, train: actor.torpedoLaunchers?.find(state => state.id === l.id)?.train ?? 0,
    }));
    this.priorLaunchers = Float64Array.from(this.renderedLaunchers, l => l.train);
    this.captureMounts();
    this.root.name = actor.motion.id;
    this.inspection = new ShipInspection(definition);
    const nodes = new Map<string, THREE.Object3D>();
    // Preserve GLTF material sharing within a hull, with separate inspection state per ship.
    const materials = new Map<THREE.Material, THREE.Material>();
    model.traverse(o => {
      if (o.userData.nodeId) nodes.set(o.userData.nodeId, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (!Array.isArray(o.material)) this.renderMeshes.push({ mesh: o, material: o.material });
        const copy = (m: THREE.Material) => {
          const cached = materials.get(m);
          if (cached) return cached;
          const material = m.clone();
          materials.set(m, material);
          if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshStandardNodeMaterial) {
            if (material.map) material.map.anisotropy = 8;
            this.surfaces.push({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
          }
          return material;
        };
        o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
      }
    });
    const node = (id: string) => { const n = nodes.get(id); if (!n) throw new Error(`Ship export is missing ${id}. Rebuild with bun run ship:build ${definition.id}`); return n; };
    this.bindings = definition.mounts.map(m => {
      const yaw = node(`${m.id}.yaw`);
      return { yaw, elevation: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.elevation`)), recoil: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.recoil`)),
        muzzles: barrelIds(m.weapon).map(side => node(`${m.id}.${side}.muzzle`)), bearing: radians(m.bearingDeg - (yaw.userData.constructionBearingDeg ?? 0)), recoilM: m.weapon.recoilM };
    });
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !o.userData.gunCoverElevationId) return;
      const angles: number[] = o.userData.gunCoverAngles;
      const baseAngle: number = o.userData.gunCoverBaseAngle ?? 0;
      if (!Array.isArray(angles) || !angles.length || angles.length !== o.morphTargetInfluences?.length ||
          !Number.isFinite(baseAngle) || angles.some((a, i) => !Number.isFinite(a) || a <= (angles[i - 1] ?? baseAngle))) {
        throw new Error(`Ship export has invalid gun-cover shapes on ${o.name}. Rebuild with bun run ship:build ${definition.id}`);
      }
      this.gunCovers.push({ mesh: o, elevation: node(o.userData.gunCoverElevationId), angles, baseAngle });
    });
    this.launcherBindings = (definition.torpedoLaunchers ?? []).map(l => node(`${l.id}.yaw`));
    this.tubeBindings = (definition.torpedoTubes ?? []).map(t => node(`${t.id}.muzzle`));
    if (definition.submarine) for (const kind of ['bowPlanes', 'sternPlanes', 'rudders', 'propellers'] as const) {
      this.appendages.push(...definition.submarine.appendages[kind].map((id, index) => ({ node: node(id), base: node(id).quaternion.clone(), kind, index })));
    }
    if (definition.construction) for (const instance of definition.construction.equipment) {
      for (const [suffix, kind] of [['spin', 'propellers'], ['yaw', 'rudders']] as const) {
        const bound = nodes.get(`${instance.id}.${suffix}`);
        if (bound && (kind !== 'rudders' || bound.userData.constructionEquipmentKind === 'rudder')) this.appendages.push({ node: bound, base: bound.quaternion.clone(), kind, index: this.appendages.length });
      }
    }
    this.rig = new ShipRigView(definition, nodes, actor.motion.id);
    // Only these bound joints change local transforms during play. Retain every
    // assembly/socket node, but compose its fixed local matrix once at loading.
    const moving = new Set<THREE.Object3D>([
      ...this.bindings.flatMap(b => [b.yaw, ...b.elevation, ...b.recoil]),
      ...this.launcherBindings, ...this.appendages.map(a => a.node), ...this.rig.radars.map(r => r.node),
    ]);
    model.traverse(o => { if (!moving.has(o) && !o.animations.length) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this.root.add(model, this.internals, this.rig.root);
    // Recoil slides a barrel from its rest position by up to its travel; every other joint only turns.
    const travel = new Map(this.bindings.flatMap(b => b.recoil.map(n => [n, Math.abs(b.recoilM) + Math.abs(n.position.z)] as const)));
    this.poseMatrices = new ShipPoseMatrices(this.root, model, moving, travel);
    this.impactMarks = new ShipImpactMarks(this.root, model, new Map(definition.mounts.map((m, i) => [m.id, this.bindings[i].yaw])), reversedDepthBuffer);
    this.update();
  }
  inspect(enabled: boolean): void { this.setInspection(enabled ? 'all' : 'exterior'); }
  setInspection(mode: InspectionMode | 'all' | 'damage', selected?: string | readonly string[]): void {
    this.inspection.setMode(mode, selected);
    const enabled = mode !== 'exterior';
    this.rig.root.visible = !enabled;
    this.impactMarks.setVisible(!enabled);
    if (this.inspecting !== enabled) {
      this.inspecting = enabled;
      this.surfaces.forEach(({ material, opacity, transparent, depthWrite }) => {
        material.transparent = enabled || transparent; material.opacity = enabled ? .16 : opacity;
        material.depthWrite = enabled ? false : depthWrite; material.needsUpdate = true;
      });
    }
    this.updateInspection();
  }
  /** Prepare the matrices consumed by this frame's surface and aircraft draws. */
  updateRenderMatrices(): void {
    if (!this.renderActive) { this.root.updateWorldMatrix(true, false); return; }
    this.poseMatrices.update();
    this.rig.root.updateMatrixWorld(true);
    if (this.internals.visible) this.internals.updateMatrixWorld(true);
    const poses = this.poseMatrices;
    if (this.markVersion !== this.impactMarks.version) {
      this.markVersion = this.impactMarks.version;
      this.markPoses = Array.from(this.impactMarks.renderMeshes, mark => ({ mark, receiver: mark.parent, pose: mark.parent ? poses.indexOf(mark.parent) : -1 }));
    }
    for (let i = 0; i < this.markPoses.length; i++) {
      const { mark, receiver, pose } = this.markPoses[i];
      // A scar draws in its receiver's space: the receiver's pose first.
      if (mark.parent === receiver) poses.ensure(pose); else if (mark.parent) poses.ensureObject(mark.parent);
      mark.updateMatrixWorld(true);
    }
  }

  /** Read-only check of the loaded joints against the CPU poses sampled for this frame. */
  muzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.bindings.flatMap((binding, i) => binding.muzzles.map((node, barrel) => {
      const m = this.definition.mounts[i], state = this.renderedMounts[i];
      const expected = new THREE.Vector3(...muzzleWorld(m, state, barrel, this.motion));
      expected.addScaledVector(new THREE.Vector3(...shotDirection(m, state, this.motion)), -state.recoil * m.weapon.recoilM);
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    }));
  }
  torpedoMuzzleErrors(): number[] {
    this.root.updateMatrixWorld(true);
    return this.tubeBindings.map((node, i) => {
      const local = tubeLocalPosition({ definition: this.definition, torpedoLaunchers: this.renderedLaunchers }, this.definition.torpedoTubes![i]);
      const expected = this.root.localToWorld(new THREE.Vector3(...local));
      return node.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
    });
  }
  /** Capture before every fixed tick, including all ticks in a catch-up frame. */
  capturePreviousPose(): void {
    this.motionSource = this.actor.motion;
    Object.assign(this.previousMotion, this.actor.motion);
    this.captureMounts();
    const states = this.actor.torpedoLaunchers;
    for (let i = 0; i < this.renderedLaunchers.length; i++) {
      const id = this.renderedLaunchers[i].id;
      let train = 0;
      if (states) for (const state of states) if (state.id === id) { train = state.train ?? 0; break; }
      this.priorLaunchers[i] = train;
    }
  }
  /** Articulation interpolates only a mount's train, elevation and recoil from the previous tick; a mount missing from the
   * actor keeps what it had. */
  private captureMounts(): void {
    const mounts = this.actor.mounts, prior = this.priorMounts;
    for (let i = 0, o = 0; o < prior.length; i++, o += 3) {
      const mount = mounts[i];
      if (mount) { prior[o] = mount.train; prior[o + 1] = mount.elevation; prior[o + 2] = mount.recoil; }
    }
  }
  /** Teleports and port transitions must not interpolate across the old voyage. */
  snap(): void { this.capturePreviousPose(); this.rig.reset(); this.update(); }
  update(alpha = 1): void {
    this.updateMotion(alpha);
    this.updateArticulation(alpha);
  }
  /** Every hull keeps its interpolated motion, including offscreen carriers. */
  updateMotion(alpha = 1): void {
    if (this.damageSource !== this.actor.damage) {
      this.impactMarks.clear(); this.rig.reset(); this.damageSource = this.actor.damage;
    }
    if (this.motionSource !== this.actor.motion) this.capturePreviousPose();
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    const current = this.actor.motion, previous = this.previousMotion;
    const motion = this.motion;
    Object.assign(motion, current);
    for (const key of ['x', 'y', 'z', 'roll', 'pitch', 'speed', 'swaySpeed'] as const) {
      motion[key] = THREE.MathUtils.lerp(previous[key], current[key], t);
    }
    // Trajectory previews inherit velocity at the same display time as the hull.
    for (const key of ['verticalSpeed', 'driftX', 'driftZ'] as const) {
      motion[key] = THREE.MathUtils.lerp(previous[key] ?? 0, current[key] ?? 0, t);
    }
    motion.heading = previous.heading + wrapAngle(current.heading - previous.heading) * t;
    if (this.seaOffset) { motion.y += this.seaOffset.heave; motion.roll += this.seaOffset.roll; motion.pitch += this.seaOffset.pitch; }
    this.root.position.set(motion.x, motion.y, motion.z);
    this.root.rotation.set(motion.pitch, -motion.heading, motion.roll, 'YXZ');
  }
  /** Re-entry uses the latest pair of CPU snapshots, never an old visual pose. */
  updateArticulation(alpha = 1): void {
    const t = THREE.MathUtils.clamp(alpha, 0, 1), motion = this.motion, mounts = this.renderedMounts, current = this.actor.mounts, prior = this.priorMounts;
    for (let i = 0, o = 0; i < mounts.length; i++, o += 3) {
      const m = mounts[i], currentMount = current[i];
      Object.assign(m, currentMount);
      // Mount train is a bounded interval; wrapping would cross forbidden arcs.
      // A gun can be disabled after it trained in the current tick. Stop at
      // the authoritative angle immediately instead of finishing that turn
      // across later display frames. Recoil may still settle independently.
      const stopped = currentMount.hp <= 0 || currentMount.status === 'disabled' || this.actor.damage.sunk;
      m.train = stopped ? currentMount.train : THREE.MathUtils.lerp(prior[o], currentMount.train, t);
      m.elevation = stopped ? currentMount.elevation : THREE.MathUtils.lerp(prior[o + 1], currentMount.elevation, t);
      m.recoil = THREE.MathUtils.lerp(prior[o + 2], currentMount.recoil, t);
    }
    // A hull mount has no carrier: `updateMountCarriers` would only delete one, and none has one to delete.
    if (this.carried) updateMountCarriers(this.definition, mounts);
    else for (let i = 0; i < this.definition.mounts.length; i++) if ('carrier' in mounts[i]) delete mounts[i].carrier;
    for (let i = 0; i < this.bindings.length; i++) {
      const b = this.bindings[i], mount = mounts[i];
      // A 180° imported quaternion can decompose into nonzero X/Z Euler angles.
      // Replace the complete joint rotation instead of retaining those alternate axes.
      setJointY(b.yaw, -(b.bearing + mount.train));
      setJointsX(b.elevation, mount.elevation);
      for (let k = 0; k < b.recoil.length; k++) b.recoil[k].position.z = mount.recoil * b.recoilM;
      // Recoil runs from 0 to 1; anything beyond would slide a barrel past the travel its pose bounds allow.
      if (!(mount.recoil >= -1e-9 && mount.recoil <= 1 + 1e-9)) this.poseMatrices.bounded = false;
    }
    // Cloth is visual-only: the same interpolated gun angle drives its shapes.
    // Fixed seams stay on the gunhouse or carriage; moving seams follow pitch.
    for (const { mesh, elevation, angles, baseAngle } of this.gunCovers) {
      const degrees = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(elevation.rotation.x), baseAngle, angles.at(-1)!);
      const weights = mesh.morphTargetInfluences!;
      weights.fill(0);
      const upper = angles.findIndex(a => a >= degrees), lowerAngle = angles[upper - 1] ?? baseAngle;
      const fraction = (degrees - lowerAngle) / (angles[upper] - lowerAngle);
      weights[upper] = fraction;
      if (upper > 0) weights[upper - 1] = 1 - fraction;
    }
    this.launcherBindings.forEach((node, i) => {
      const launcher = this.renderedLaunchers[i];
      const train = this.actor.torpedoLaunchers?.find(state => state.id === launcher.id)?.train ?? 0;
      const previous = this.priorLaunchers[i];
      // Wire snapshots can reorder banks; bounded travel must also stay inside its stops.
      launcher.train = this.definition.torpedoLaunchers![i].traverseLimitsDeg
        ? THREE.MathUtils.lerp(previous, train, t) : previous + wrapAngle(train - previous) * t;
      setJointY(node, -this.renderedLaunchers[i].train + radians(node.userData.constructionBearingDeg ?? 0));
    });
    // Each appendage turns from its rest quaternion about its own Y (rudders), Z (propellers) or X (planes).
    for (const { node, base, kind, index } of this.appendages) {
      if (kind === 'rudders') turnFrom(node, base, 0, 1, 0, -motion.rudder * radians(35));
      else if (kind === 'propellers') turnFrom(node, base, 0, 0, 1, motion.distance * (index % 2 ? -1 : 1) * Math.sign(motion.speed) * 1.8);
      else turnFrom(node, base, 1, 0, 0, (this.actor.submarine?.planes ?? 0) * radians(kind === 'bowPlanes' ? -20 : 20));
    }
    this.updateInspection();
  }
  /** Match the displayed barrels; readiness remains from the authoritative tick. */
  gunAimPoints(battery: Battery, aim: Vec3, weaponGroupId?: string) {
    return gunAimPoints({ ...this.actor, motion: this.motion, mounts: this.renderedMounts }, this.definition, battery, aim, weaponGroupId);
  }
  private updateInspection(): void {
    // Hidden inspection reads nothing; skip building its view of the actor.
    if (this.inspection.root.visible) this.inspection.update({ ...this.actor, motion: this.motion, mounts: this.renderedMounts });
  }
}
