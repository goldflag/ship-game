import { Box3, MathUtils, Vector3, type Camera } from 'three/webgpu';
import type { FleetActor } from '../simulation/battle';
import type { ShipView } from './ShipView';

type ScreenPoint = { x: number; y: number };

/** Cull in clip space so ships behind the camera never acquire mirrored labels. */
export function projectShipLabel(anchor: Vector3, camera: Camera, width: number, height: number): ScreenPoint | null {
  const point = anchor.clone().project(camera);
  if (![point.x, point.y, point.z].every(Number.isFinite) || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
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

  constructor(host: HTMLElement) {
    this.root.className = 'ship-label-layer';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Ship names and hull health');
    host.appendChild(this.root);
  }

  setFleet(views: readonly ShipView[], actors: readonly FleetActor[]): void {
    this.root.replaceChildren();
    this.labels = views.flatMap((view, index) => {
      const actor = actors[index];
      if (actor.controller === 'player') return [];
      const root = document.createElement('div');
      root.className = `ship-label ship-label-${actor.team}`;
      root.dataset.shipId = actor.motion.id;
      root.hidden = true;
      const tag = document.createElement('div'); tag.className = 'ship-label-tag';
      const name = document.createElement('strong'); name.className = 'ship-label-name'; name.textContent = actor.definition.name;
      const identity = `${actor.team === 'friendly' ? 'Ally' : 'Enemy'} ${actor.motion.id.split('-').at(-1)}`;
      const health = document.createElement('span'); health.className = 'ship-label-health';
      const meter = document.createElement('div'); meter.className = 'ship-label-meter';
      meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', `${actor.definition.name}, ${identity}, hull health`);
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '1000');
      const fill = document.createElement('div'); meter.appendChild(fill);
      tag.append(name, meter, health); root.appendChild(tag); this.root.appendChild(root);
      // Measure the authored model once. Inspection helpers never change the anchor.
      const bounds = new Box3().setFromObject(view.root.children[0]);
      const top = bounds.isEmpty() ? actor.definition.hull.depth : bounds.max.y - view.root.position.y;
      return [{ actor, view, root, meter, fill, health, anchor: new Vector3(0, top + 5, 0), hp: -1, sunk: false }];
    });
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  update(camera: Camera): void {
    camera.updateMatrixWorld();
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
      if (point) root.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`;
    }
  }

  dispose(): void { this.root.remove(); this.labels = []; }
}
