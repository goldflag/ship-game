import * as THREE from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { wrapAngle } from './geometry';
import { updateMountCarriers } from './mountFrames';
import { ShipInspection } from './ShipInspection';
import type { InspectionMode } from '../ships/inspection';
import { ShipImpactMarks } from './ShipImpactMarks';
import { PreparedPoseGroup } from './FrameScene';
import { ShipPoseMatrices } from './ShipPoseMatrices';
import { ShipRigView } from './ShipRigView';
import type { Combatant } from '../game/session/elements';
import { ShipJoints } from './shipJoints';

/** Renderer adapter: the ship's drawn pose, rig, inspection and impact marks. Simulation geometry and
 * transforms come from the same definition. The construction presentation recipe hashes this module's
 * imports, so aiming and checks that never change a drawn frame live in `ShipView` instead. */
export class ShipRenderView {
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
  private previousMounts: Combatant['mounts'];
  protected renderedMounts: Combatant['mounts'];
  private previousLaunchers: number[];
  protected renderedLaunchers: NonNullable<Combatant['torpedoLaunchers']>;
  /** The model's moving joints; the construction export poses the same class. */
  protected readonly joints: ShipJoints;
  get internals() { return this.inspection.root; }
  private surfaces: { material: THREE.MeshStandardMaterial | THREE.MeshStandardNodeMaterial; opacity: number; transparent: boolean; depthWrite: boolean }[] = [];
  private inspecting = false;
  /** Surface and moving-joint world matrices for rendering; the fleet's batches defer the ones they draw. */
  readonly poseMatrices: ShipPoseMatrices;
  constructor(readonly model: THREE.Group, readonly definition: ShipDefinition, readonly actor: Combatant, reversedDepthBuffer = false) {
    this.motionSource = actor.motion;
    this.damageSource = actor.damage;
    this.motion = { ...actor.motion };
    this.previousMotion = { ...actor.motion };
    this.previousMounts = actor.mounts.map(m => ({ ...m }));
    this.renderedMounts = actor.mounts.map(m => ({ ...m }));
    this.renderedLaunchers = (definition.torpedoLaunchers ?? []).map(l => ({
      id: l.id, train: actor.torpedoLaunchers?.find(state => state.id === l.id)?.train ?? 0,
    }));
    this.previousLaunchers = this.renderedLaunchers.map(l => l.train);
    this.root.name = actor.motion.id;
    this.inspection = new ShipInspection(definition);
    // Preserve GLTF material sharing within a hull, with separate inspection state per ship.
    const materials = new Map<THREE.Material, THREE.Material>();
    model.traverse(o => {
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
    const joints = this.joints = new ShipJoints(model, definition);
    this.rig = new ShipRigView(definition, joints.nodes, actor.motion.id);
    // Only these bound joints change local transforms during play. Retain every
    // assembly/socket node, but compose its fixed local matrix once at loading.
    const moving = new Set<THREE.Object3D>([
      ...joints.mounts.flatMap(b => [b.yaw, ...b.elevation, ...b.recoil]),
      ...joints.launchers, ...joints.appendages.map(a => a.node), ...this.rig.radars.map(r => r.node),
    ]);
    model.traverse(o => { if (!moving.has(o) && !o.animations.length) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this.root.add(model, this.internals, this.rig.root);
    // Recoil slides a barrel from its rest position by up to its travel; every other joint only turns.
    const travel = new Map(joints.mounts.flatMap(b => b.recoil.map(n => [n, Math.abs(b.recoilM) + Math.abs(n.position.z)] as const)));
    this.poseMatrices = new ShipPoseMatrices(this.root, model, moving, travel);
    this.impactMarks = new ShipImpactMarks(this.root, model, new Map(definition.mounts.map((m, i) => [m.id, joints.mounts[i].yaw])), reversedDepthBuffer);
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
    for (const mark of this.impactMarks.renderMeshes) { if (mark.parent) this.poseMatrices.ensureObject(mark.parent); mark.updateMatrixWorld(true); }
  }

  /** Capture before every fixed tick, including all ticks in a catch-up frame. */
  capturePreviousPose(): void {
    this.motionSource = this.actor.motion;
    Object.assign(this.previousMotion, this.actor.motion);
    this.previousMounts.forEach((m, i) => Object.assign(m, this.actor.mounts[i]));
    this.previousLaunchers = this.renderedLaunchers.map(l => this.actor.torpedoLaunchers?.find(state => state.id === l.id)?.train ?? 0);
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
    const t = THREE.MathUtils.clamp(alpha, 0, 1), motion = this.motion, mounts = this.renderedMounts;
    mounts.forEach((m, i) => {
      const currentMount = this.actor.mounts[i], previousMount = this.previousMounts[i];
      Object.assign(m, currentMount);
      // Mount train is a bounded interval; wrapping would cross forbidden arcs.
      for (const key of ['train', 'elevation', 'recoil'] as const) {
        // A gun can be disabled after it trained in the current tick. Stop at
        // the authoritative angle immediately instead of finishing that turn
        // across later display frames. Recoil may still settle independently.
        const stopped = key !== 'recoil' && (currentMount.hp <= 0 || currentMount.status === 'disabled' || this.actor.damage.sunk);
        m[key] = stopped ? currentMount[key] : THREE.MathUtils.lerp(previousMount[key], currentMount[key], t);
      }
    });
    updateMountCarriers(this.definition, mounts);
    // Recoil runs from 0 to 1; anything beyond would slide a barrel past the travel its pose bounds allow.
    if (mounts.some(m => !(m.recoil >= -1e-9 && m.recoil <= 1 + 1e-9))) this.poseMatrices.bounded = false;
    this.renderedLaunchers.forEach((launcher, i) => {
      const train = this.actor.torpedoLaunchers?.find(state => state.id === launcher.id)?.train ?? 0;
      const previous = this.previousLaunchers[i] ?? train;
      // Wire snapshots can reorder banks; bounded travel must also stay inside its stops.
      launcher.train = this.definition.torpedoLaunchers![i].traverseLimitsDeg
        ? THREE.MathUtils.lerp(previous, train, t) : previous + wrapAngle(train - previous) * t;
    });
    this.joints.pose(mounts, this.renderedLaunchers, motion, this.actor.submarine?.planes ?? 0);
    this.updateInspection();
  }
  private updateInspection(): void {
    // Hidden inspection reads nothing; skip building its view of the actor.
    if (this.inspection.root.visible) this.inspection.update({ ...this.actor, motion: this.motion, mounts: this.renderedMounts });
  }
}
