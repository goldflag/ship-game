import { Box3, MathUtils, Vector3, type Camera } from 'three/webgpu';
import type { FleetActor } from '../simulation/battle';
import type { ShipView } from './ShipView';

const LABEL_WIDTH = 144, LABEL_HEIGHT = 50, GAP = 8;
type ScreenPoint = { x: number; y: number };
type LabelRect = { left: number; right: number; top: number; bottom: number };

/** Cull in clip space so ships behind the camera never acquire mirrored labels. */
export function projectShipLabel(anchor: Vector3, camera: Camera, width: number, height: number): ScreenPoint | null {
  const point = anchor.clone().project(camera);
  if (![point.x, point.y, point.z].every(Number.isFinite) || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
}

/** Keep neighboring labels readable above their ships and clear of the HUD. */
export function layoutShipLabels(points: ScreenPoint[], width: number, exclusions: readonly LabelRect[] = []): (ScreenPoint & { lift: number })[] {
  const occupied = [...exclusions];
  return points.map(point => {
    const clampX = (x: number) => MathUtils.clamp(x, LABEL_WIDTH / 2 + GAP, width - LABEL_WIDTH / 2 - GAP);
    const xs = [...new Set([point.x, ...occupied.flatMap(rect => [rect.left - LABEL_WIDTH / 2 - GAP, rect.right + LABEL_WIDTH / 2 + GAP])].map(clampX))]
      .sort((a, b) => Math.abs(a - point.x) - Math.abs(b - point.x));
    const bottoms = [...new Set([point.y - GAP, ...occupied.map(rect => rect.top - GAP)])]
      .filter(y => y <= point.y - GAP && y >= LABEL_HEIGHT + GAP).sort((a, b) => b - a);
    // Bounded candidate search also avoids repeating floating-point row boundaries.
    for (const bottom of bottoms) for (const x of xs) {
      const rect = { left: x - LABEL_WIDTH / 2, right: x + LABEL_WIDTH / 2, top: bottom - LABEL_HEIGHT, bottom };
      if (occupied.every(other => rect.right <= other.left - GAP || rect.left >= other.right + GAP || rect.bottom <= other.top - GAP || rect.top >= other.bottom + GAP)) {
        occupied.push(rect);
        return { x, y: point.y, lift: point.y - bottom };
      }
    }
    return { x: clampX(point.x), y: point.y, lift: point.y + GAP };
  });
}

type Label = {
  actor: FleetActor; view: ShipView; anchor: Vector3; root: HTMLDivElement;
  meter: HTMLDivElement; fill: HTMLDivElement; health: HTMLSpanElement; hp: number; sunk: boolean;
};

/** Screen overlay follows rendered hull poses at frame rate, without React rerenders. */
export class ShipLabels {
  private root = document.createElement('div');
  private labels: Label[] = [];
  private width = 1;
  private height = 1;
  private hudRects: LabelRect[] = [];
  private nextHudMeasure = 0;

  constructor(private host: HTMLElement) {
    this.root.className = 'ship-label-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Ship names and hull health');
    host.appendChild(this.root);
  }

  setFleet(views: readonly ShipView[], actors: readonly FleetActor[]): void {
    this.root.replaceChildren();
    this.labels = views.map((view, index) => {
      const actor = actors[index];
      const root = document.createElement('div');
      root.className = `ship-label ship-label-${actor.team}`;
      root.dataset.shipId = actor.motion.id;
      root.hidden = true;
      const tag = document.createElement('div'); tag.className = 'ship-label-tag';
      const name = document.createElement('strong'); name.className = 'ship-label-name'; name.textContent = actor.definition.name;
      const identity = actor.controller === 'player' ? 'You' : `${actor.team === 'friendly' ? 'Ally' : 'Enemy'} ${actor.motion.id.split('-').at(-1)}`;
      const health = document.createElement('span'); health.className = 'ship-label-health';
      const meter = document.createElement('div'); meter.className = 'ship-label-meter';
      meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', `${actor.definition.name}, ${identity}, hull health`);
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '1000');
      const fill = document.createElement('div'); meter.appendChild(fill);
      tag.append(name, meter, health); root.appendChild(tag); this.root.appendChild(root);
      // Measure the authored model once. Inspection helpers never change the anchor.
      const bounds = new Box3().setFromObject(view.root.children[0]);
      const top = bounds.isEmpty() ? actor.definition.hull.depth : bounds.max.y - view.root.position.y;
      return { actor, view, root, meter, fill, health, anchor: new Vector3(0, top + 5, 0), hp: -1, sunk: false };
    });
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; this.nextHudMeasure = 0; }

  update(camera: Camera): void {
    camera.updateMatrixWorld();
    // HUD layout changes much less often than the camera. Batch its measurements
    // before writing label positions, including responsive controls and open gunnery.
    const now = performance.now();
    if (now >= this.nextHudMeasure) {
      this.nextHudMeasure = now + 200;
      const host = this.host.getBoundingClientRect();
      const hud = this.host.parentElement?.querySelector('.fleet-hud');
      this.hudRects = Array.from(hud?.querySelectorAll('.fleet-battle, .fleet-ship, .fleet-armament, .fleet-compass, .fleet-map-area, .fleet-top-actions, .fleet-capture-hint, .gunnery, .fleet-scope-readout') ?? [])
        .map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => ({ left: rect.left - host.left, right: rect.right - host.left, top: rect.top - host.top, bottom: rect.bottom - host.top }));
      if (hud?.querySelector('.fleet-sight')) this.hudRects.push({ left: this.width / 2 - 16, right: this.width / 2 + 16, top: this.height / 2 - 16, bottom: this.height / 2 + 16 });
    }
    const visible: { label: Label; point: ScreenPoint; distance: number }[] = [];
    for (const label of this.labels) {
      const { actor, view, root } = label;
      const hp = Math.round(MathUtils.clamp(actor.damage.integrity, 0, 1000));
      if (label.hp !== hp || label.sunk !== actor.damage.sunk) {
        label.hp = hp; label.sunk = actor.damage.sunk;
        label.health.textContent = `${hp} HP`;
        label.meter.setAttribute('aria-valuenow', String(hp));
        label.meter.setAttribute('aria-valuetext', `${hp} of 1000 hull health${label.sunk ? ', sinking' : ''}`);
        label.fill.style.transform = `scaleX(${hp / 1000})`;
        root.classList.toggle('ship-label-sinking', label.sunk);
      }
      view.root.updateWorldMatrix(true, false);
      const anchor = label.anchor.clone().applyMatrix4(view.root.matrixWorld);
      const point = view.root.visible && view.motion.y > -40 ? projectShipLabel(anchor, camera, this.width, this.height) : null;
      root.hidden = !point;
      if (point) visible.push({ label, point, distance: anchor.distanceToSquared(camera.position) });
    }
    // Preserve the nearest ship's direct label when several hulls share a bearing.
    visible.sort((a, b) => a.distance - b.distance);
    const positions = layoutShipLabels(visible.map(item => item.point), this.width, this.hudRects);
    visible.forEach(({ label, point }, index) => {
      const { x, y, lift } = positions[index];
      label.root.hidden = y - lift < LABEL_HEIGHT + GAP;
      label.root.style.transform = `translate(${point.x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      label.root.style.setProperty('--label-lift', `${lift.toFixed(2)}px`);
      label.root.style.setProperty('--label-offset', `${(x - point.x).toFixed(2)}px`);
    });
  }

  dispose(): void { this.root.remove(); this.labels = []; }
}
