import { Vector3, type Camera } from 'three/webgpu';
import type { CombatSimulation } from '../simulation/combat';
import type { ShipView } from './ShipView';
import { HitFeedback } from './HitFeedback';
import { projectShipLabel } from './ShipLabels';

export class HitLabels {
  private root = document.createElement('div');
  private feedback = new HitFeedback();
  private labels = new Map<number, HTMLDivElement>();
  constructor(private host: HTMLElement) {
    this.root.className = 'hit-label-layer';
    this.root.setAttribute('aria-label', 'Enemy impact damage');
    host.appendChild(this.root);
  }
  update(sim: CombatSimulation, views: readonly ShipView[], camera: Camera, visible: boolean): void {
    const cues = this.feedback.update(sim);
    this.root.hidden = !visible;
    const live = new Set(cues.map(c => c.id));
    for (const [id, label] of this.labels) if (!live.has(id)) { label.remove(); this.labels.delete(id); }
    const occupied: { x: number; y: number }[] = [];
    for (const cue of cues) {
      let label = this.labels.get(cue.id);
      if (!label) {
        label = document.createElement('div'); label.className = 'hit-label';
        for (const tag of ['strong', 'span', 'small']) label.appendChild(document.createElement(tag));
        this.root.appendChild(label); this.labels.set(cue.id, label);
      }
      label.children[0].textContent = cue.damage > 0 ? `−${cue.damage.toLocaleString(undefined, { maximumFractionDigits: 1 })} HP` : '0 HP';
      label.children[1].textContent = cue.part;
      label.children[2].textContent = cue.result;
      label.dataset.damage = String(cue.damage > 0);
      const view = views.find(v => v.actor.motion.id === cue.shipId);
      const anchor = view && new Vector3(...cue.position).applyMatrix4(view.root.matrixWorld);
      const point = anchor && view?.root.visible ? projectShipLabel(anchor, camera, this.host.clientWidth, this.host.clientHeight) : null;
      label.hidden = !point;
      if (point) {
        point.y -= 28;
        while (occupied.some(p => Math.abs(p.x - point.x) < 155 && Math.abs(p.y - point.y) < 62)) point.y -= 64;
        label.hidden = point.y < 70;
        occupied.push(point);
        label.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
        label.style.opacity = String(cue.opacity);
      }
    }
  }
  dispose(): void { this.root.remove(); this.labels.clear(); }
}
