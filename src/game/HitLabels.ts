import { Vector3, type Camera } from 'three/webgpu';
import type { CombatSimulation } from '../simulation/combat';
import type { ShipView } from './ShipView';
import { HitFeedback } from './HitFeedback';
import { projectShipLabel } from './ShipLabels';

const OUTCOME_ICONS = [
  { label: 'Armor stopped', kind: 'stopped', path: 'M9 2 15 4v5c0 3-3 5-6 7-3-2-6-4-6-7V4Z M5.5 9h7' },
  { label: 'Penetration', kind: 'penetration', path: 'M9 2v4m0 6v4M2 9h14m-4-4 4 4-4 4' },
  { label: 'Ricochet', kind: 'ricochet', path: 'M2 16h14M3 3l6 9 6-9m-4 0h4v4' },
  { label: 'Destroyed', kind: 'destroyed', path: 'M3 3h12v12H3Z M6 6l6 6m0-6-6 6' },
];

export class HitLabels {
  private root = document.createElement('div');
  private feedback = new HitFeedback();
  private labels = new Map<number, HTMLDivElement>();
  private width = 1;
  private height = 1;
  constructor(host: HTMLElement) {
    this.root.className = 'hit-label-layer';
    this.root.setAttribute('aria-label', 'Enemy impact damage');
    host.appendChild(this.root);
  }
  resize(width: number, height: number): void { this.width = width; this.height = height; }
  update(sim: CombatSimulation, views: readonly ShipView[], camera: Camera, visible: boolean): void {
    const cues = this.feedback.update(sim);
    this.root.hidden = !visible;
    const live = new Set(cues.map(c => c.id));
    for (const [id, label] of this.labels) if (!live.has(id)) { label.remove(); this.labels.delete(id); }
    const occupied: { x: number; y: number; width: number; height: number }[] = [];
    const placements: { label: HTMLDivElement; point: { x: number; y: number } | null }[] = [];
    for (const cue of cues) {
      let label = this.labels.get(cue.id);
      if (!label) {
        label = document.createElement('div'); label.className = 'hit-label';
        label.innerHTML = '<strong></strong><span class="hit-label-part"><span class="hit-label-name"></span><span class="hit-label-outcome" role="img"><svg viewBox="0 0 18 18" aria-hidden="true"><path/></svg><span></span></span></span><small></small>';
        this.root.appendChild(label); this.labels.set(cue.id, label);
      }
      const [damage, part, result] = Array.from(label.children) as HTMLElement[];
      const [name, outcome] = Array.from(part.children) as HTMLElement[];
      const count = cue.projectileIds.length > 1 ? ` x${cue.projectileIds.length}` : '';
      const icon = OUTCOME_ICONS.find(icon => cue.result === icon.label || cue.result.startsWith(`${icon.label} · `));
      damage.textContent = cue.damage > 0 ? `−${cue.damage.toLocaleString(undefined, { maximumFractionDigits: 0 })} HP` : '';
      damage.hidden = cue.damage <= 0;
      name.textContent = icon?.kind === 'destroyed' ? `Destroyed ${cue.part}` : cue.part;
      outcome.hidden = !icon;
      if (icon) {
        outcome.dataset.outcome = icon.kind;
        outcome.setAttribute('aria-label', `${icon.label}${count}`);
        outcome.title = `${icon.label}${count}`;
        outcome.children[0].children[0].setAttribute('d', icon.path);
        outcome.children[1].textContent = count.trim();
      }
      // Preserve additional evidence, such as a new opening, without repeating the icon's outcome.
      result.textContent = icon ? cue.result.slice(icon.label.length).replace(/^ · /, '') : `${cue.result}${count}`;
      result.hidden = !result.textContent;
      const view = views.find(v => v.actor.motion.id === cue.shipId);
      const anchor = view && new Vector3(...cue.position).applyMatrix4(view.root.matrixWorld);
      const point = anchor && view?.root.visible ? projectShipLabel(anchor, camera, this.width, this.height) : null;
      label.hidden = !point;
      placements.push({ label, point });
      label.style.opacity = String(cue.opacity);
    }
    // Measure after updating every label: a zero-damage armor stop is only one row high.
    const measured = placements.map(p => ({ ...p, width: p.label.offsetWidth, height: p.label.offsetHeight }));
    for (const { label, point, width, height } of measured) {
      if (point) {
        point.y -= 28;
        let overlap;
        while ((overlap = occupied.find(p => Math.abs(p.x - point.x) < (p.width + width) / 2 + 6 && point.y > p.y - p.height - 6 && point.y - height < p.y + 6))) {
          point.y = overlap.y - overlap.height - 6;
        }
        label.hidden = point.y - height < 16;
        if (label.hidden) continue;
        occupied.push({ ...point, width, height });
        label.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
      }
    }
  }
  dispose(): void { this.root.remove(); this.labels.clear(); }
}
