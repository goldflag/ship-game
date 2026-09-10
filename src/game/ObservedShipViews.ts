import * as THREE from 'three/webgpu';
import { ObservedMotion } from './ObservedMotion';
import type { ObservedShip } from './session/BattleSession';

/** Report-only exteriors. These have no Combatant, inspection, damage, orders,
 * weapon state or targeting collision geometry. Templates are loaded from the
 * public catalog before battle, independently of the private enemy selection. */
export class ObservedShipViews {
  readonly root = new THREE.Group();
  private models: ReadonlyMap<string, THREE.Group> = new Map();
  private views = new Map<string, { presetId: string; root: THREE.Group }>();
  private motion = new ObservedMotion();

  setModels(models: ReadonlyMap<string, THREE.Group>): void {
    this.clear(); this.models = models;
  }
  update(reports: readonly ObservedShip[], tick: number, enabled: boolean, observerId?: string, dt = 1 / 60): void {
    this.root.visible = enabled;
    const active = new Set(reports.map(report => report.id));
    for (const [id, view] of this.views) if (!active.has(id)) {
      view.root.removeFromParent(); this.views.delete(id);
    }
    if (!enabled) return;
    this.motion.update(reports, tick, dt);
    for (const report of reports) {
      let view = this.views.get(report.id);
      if (view?.presetId !== report.presetId) {
        view?.root.removeFromParent(); this.views.delete(report.id); view = undefined;
      }
      if (!view) {
        const model = this.models.get(report.presetId);
        if (!model) continue;
        const root = new THREE.Group(); root.name = report.id; root.rotation.order = 'YXZ';
        const clone = model.clone(true);
        clone.traverse(node => { node.updateMatrix(); node.matrixAutoUpdate = false; });
        root.add(clone); this.root.add(root);
        view = { presetId: report.presetId, root }; this.views.set(report.id, view);
      }
      // Ship cameras require that ship's own current visual report. The fleet
      // chart can use any friendly observer's permitted exterior observation.
      view.root.visible = !observerId || report.observers.includes(observerId);
      const pose = this.motion.get(report.id)!;
      view.root.position.copy(pose.position);
      view.root.quaternion.copy(pose.rotation);
    }
  }
  position(id: string): THREE.Vector3 | undefined { return this.views.get(id)?.root.position; }
  clear(): void { this.root.clear(); this.views.clear(); this.motion.clear(); }
  dispose(): void { this.clear(); this.models = new Map(); this.root.removeFromParent(); }
}
