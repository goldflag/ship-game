import * as THREE from 'three/webgpu';
import type { ObservedShip } from './session/BattleSession';

/** Report-only exteriors. These have no Combatant, inspection, damage, orders,
 * weapon state or targeting collision geometry. Templates are loaded from the
 * public catalog before battle, independently of the private enemy selection. */
export class ObservedShipViews {
  readonly root = new THREE.Group();
  private models: ReadonlyMap<string, THREE.Group> = new Map();
  private views = new Map<string, { presetId: string; root: THREE.Group }>();

  setModels(models: ReadonlyMap<string, THREE.Group>): void {
    this.clear(); this.models = models;
  }
  update(reports: readonly ObservedShip[], tick: number, enabled: boolean, observerId?: string): void {
    this.root.visible = enabled;
    const active = new Set(reports.map(report => report.id));
    for (const [id, view] of this.views) if (!active.has(id)) {
      view.root.removeFromParent(); this.views.delete(id);
    }
    if (!enabled) return;
    for (const report of reports) {
      let view = this.views.get(report.id);
      if (view?.presetId !== report.presetId) {
        view?.root.removeFromParent(); this.views.delete(report.id); view = undefined;
      }
      if (!view) {
        const model = this.models.get(report.presetId);
        if (!model) continue;
        const root = new THREE.Group(); root.name = report.id;
        const clone = model.clone(true);
        clone.traverse(node => { node.updateMatrix(); node.matrixAutoUpdate = false; });
        root.add(clone); this.root.add(root);
        view = { presetId: report.presetId, root }; this.views.set(report.id, view);
      }
      // Ship cameras require that ship's own current visual report. The fleet
      // chart can use any friendly observer's permitted exterior observation.
      view.root.visible = !observerId || report.observers.includes(observerId);
      const seconds = Math.min(1, Math.max(0, (tick - report.observedTick) / 60));
      view.root.position.fromArray(report.position).addScaledVector(new THREE.Vector3(...report.velocity), seconds);
      view.root.rotation.set(0, -report.heading, 0, 'YXZ');
    }
  }
  clear(): void { this.root.clear(); this.views.clear(); }
  dispose(): void { this.clear(); this.models = new Map(); this.root.removeFromParent(); }
}
