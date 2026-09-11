import * as THREE from 'three/webgpu';
import { barrelIds, type ShipDefinition } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';
import { radians } from '../simulation/geometry';
import { ObservedMotion } from './ObservedMotion';
import type { WakeShip } from './FleetWakeFoam';
import type { ObservedShip } from './session/BattleSession';

/** Joints of a recognition model that a report can move. A model built without a
 * joint keeps that joint still; the exterior is drawn regardless. */
interface Joints {
  mounts: { yaw?: THREE.Object3D; elevation: THREE.Object3D[]; recoil: THREE.Object3D[]; bearing: number; recoilM: number }[];
  launchers: (THREE.Object3D | undefined)[];
}
interface View {
  presetId: string; root: THREE.Group; top: number;
  definition?: ShipDefinition; joints: Joints;
  /** Smoothed gun attitudes, `[train, elevation, recoil]` per mount, and launcher trains. */
  mounts: [number, number, number][]; launchers: number[];
  motion: WakeShip['motion'];
}

/** Report-only exteriors. These have no Combatant, inspection, damage, orders,
 * weapon state or targeting collision geometry. A hull the mission has revealed but that
 * is not aboard yet is requested through `request` and drawn as soon as it lands; the
 * report already names the preset, so asking for it discloses nothing further. */
export class ObservedShipViews {
  readonly root = new THREE.Group();
  private models: ReadonlyMap<string, THREE.Group> = new Map();
  private request?: (presetId: string) => void;
  private views = new Map<string, View>();
  private motion = new ObservedMotion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  setModels(models: ReadonlyMap<string, THREE.Group>, request?: (presetId: string) => void): void {
    this.clear(); this.models = models; this.request = request;
  }
  update(reports: readonly ObservedShip[], tick: number, enabled: boolean, observerId?: string, dt = 1 / 60): void {
    this.root.visible = enabled;
    const active = new Set(reports.map(report => report.id));
    for (const [id, view] of this.views) if (!active.has(id)) {
      view.root.removeFromParent(); this.views.delete(id);
    }
    if (!enabled) return;
    this.motion.update(reports, tick, dt);
    // Gun attitudes settle over the same interval as the hull pose they ride on.
    const blend = -Math.expm1(-Math.max(0, dt) / .1);
    for (const report of reports) {
      let view = this.views.get(report.id);
      if (view?.presetId !== report.presetId) {
        view?.root.removeFromParent(); this.views.delete(report.id); view = undefined;
      }
      if (!view) {
        const model = this.models.get(report.presetId);
        if (!model) { this.request?.(report.presetId); continue; }
        const root = new THREE.Group(); root.name = report.id; root.rotation.order = 'YXZ';
        const clone = model.clone(true);
        clone.traverse(node => { node.updateMatrix(); node.matrixAutoUpdate = false; });
        root.add(clone); this.root.add(root);
        // Measure the recognition model once, before the root takes the report's pose.
        const bounds = new THREE.Box3().setFromObject(clone);
        const preset = shipPreset(report.presetId);
        const definition = preset.id === report.presetId ? preset : undefined;
        const joints = bindJoints(clone, definition);
        view = {
          presetId: report.presetId, root, top: bounds.isEmpty() ? 12 : bounds.max.y, definition, joints,
          mounts: report.mounts?.map(m => [...m] as [number, number, number]) ?? [], launchers: [...report.launchers ?? []],
          motion: { x: 0, y: 0, z: 0, heading: report.heading, speed: 0 },
        };
        this.views.set(report.id, view);
      }
      // Ship cameras require that ship's own current visual report. The fleet
      // chart can use any friendly observer's permitted exterior observation.
      view.root.visible = !observerId || report.observers.includes(observerId);
      const pose = this.motion.get(report.id)!;
      view.root.position.copy(pose.position);
      view.root.quaternion.copy(pose.rotation);
      this.updateMotion(view, report, pose);
      this.articulate(view, report, blend);
    }
  }
  /** The drawn pose and the report's velocity along it, for the wake this hull leaves. */
  private updateMotion(view: View, report: ObservedShip, pose: { position: THREE.Vector3; rotation: THREE.Quaternion }): void {
    const motion = view.motion;
    motion.x = pose.position.x; motion.y = pose.position.y; motion.z = pose.position.z;
    motion.heading = -this.euler.setFromQuaternion(pose.rotation).y;
    const [vx, , vz] = report.velocity;
    motion.speed = vx * Math.sin(motion.heading) - vz * Math.cos(motion.heading);
  }
  private articulate(view: View, report: ObservedShip, blend: number): void {
    const { joints } = view;
    if (report.mounts) {
      if (view.mounts.length !== report.mounts.length) view.mounts = report.mounts.map(m => [...m] as [number, number, number]);
      else view.mounts.forEach((m, i) => { for (let k = 0; k < 3; k++) m[k] += (report.mounts![i][k] - m[k]) * blend; });
    }
    if (report.launchers) {
      if (view.launchers.length !== report.launchers.length) view.launchers = [...report.launchers];
      else view.launchers.forEach((train, i) => { view.launchers[i] = train + (report.launchers![i] - train) * blend; });
    }
    // Mount train is a bounded interval, as on a simulated hull: no wrapping through forbidden arcs.
    joints.mounts.forEach((joint, i) => {
      const state = view.mounts[i];
      if (!state) return;
      joint.yaw?.rotation.set(0, -(joint.bearing + state[0]), 0);
      for (const node of joint.elevation) node.rotation.set(state[1], 0, 0);
      for (const node of joint.recoil) node.position.z = state[2] * joint.recoilM;
    });
    joints.launchers.forEach((node, i) => { if (node && view.launchers[i] !== undefined) node.rotation.set(0, -view.launchers[i], 0); });
  }
  position(id: string): THREE.Vector3 | undefined { return this.views.get(id)?.root.position; }
  /** World point above the drawn exterior for an overhead label; nothing while the report has no visible hull. */
  labelAnchor(id: string): THREE.Vector3 | undefined {
    const view = this.views.get(id);
    if (!view || !this.root.visible || !view.root.visible) return;
    view.root.updateWorldMatrix(true, false);
    return new THREE.Vector3(0, view.top + 5, 0).applyMatrix4(view.root.matrixWorld);
  }
  /** Every exterior on show this frame, for the wakes it leaves. */
  wakeShips(): WakeShip[] {
    if (!this.root.visible) return [];
    const ships: WakeShip[] = [];
    for (const view of this.views.values()) {
      if (view.definition && view.root.visible) ships.push({ root: view.root, motion: view.motion, definition: view.definition });
    }
    return ships;
  }
  clear(): void { this.root.clear(); this.views.clear(); this.motion.clear(); }
  dispose(): void { this.clear(); this.models = new Map(); this.request = undefined; this.root.removeFromParent(); }
}

/** Find the exported joints by node id; joints that move keep updating their matrices. */
function bindJoints(model: THREE.Object3D, definition?: ShipDefinition): Joints {
  if (!definition) return { mounts: [], launchers: [] };
  const nodes = new Map<string, THREE.Object3D>();
  model.traverse(o => { if (o.userData.nodeId) nodes.set(o.userData.nodeId, o); });
  const joint = (id: string) => { const node = nodes.get(id); if (node) node.matrixAutoUpdate = true; return node; };
  return {
    mounts: definition.mounts.map(m => ({
      yaw: joint(`${m.id}.yaw`), bearing: radians(m.bearingDeg), recoilM: m.weapon.recoilM,
      elevation: barrelIds(m.weapon).flatMap(side => joint(`${m.id}.${side}.elevation`) ?? []),
      recoil: barrelIds(m.weapon).flatMap(side => joint(`${m.id}.${side}.recoil`) ?? []),
    })),
    launchers: (definition.torpedoLaunchers ?? []).map(l => joint(`${l.id}.yaw`)),
  };
}
