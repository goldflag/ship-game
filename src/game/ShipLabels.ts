import { HUD_LAYERS } from '../ui/hudLayers';
import { Box3, MathUtils, Vector3, WebGPUCoordinateSystem, type Camera } from 'three/webgpu';
import type { ShipView } from './ShipView';
import { HullDamageFeedback } from './HullDamageFeedback';
import type { CombatEvent, FleetActor } from '../game/session/elements';

type ScreenPoint = { x: number; y: number };

/** Match the renderer's depth range so ships behind the camera never acquire mirrored labels. */
export function projectShipLabel(anchor: Vector3, camera: Camera, width: number, height: number): ScreenPoint | null {
  const point = anchor.clone().project(camera);
  // Three.js uses 0..1 for WebGPU and for reversed depth on either backend.
  const minDepth = camera.reversedDepth || camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1;
  if (![point.x, point.y, point.z].every(Number.isFinite) || point.z < minDepth || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
}

type Label = {
  actor: FleetActor; view: ShipView; anchor: Vector3; root: HTMLDivElement;
  meter: HTMLDivElement; fill: HTMLDivElement; health: HTMLSpanElement; hp: number; sunk: boolean;
  loss: HTMLDivElement; damageNumber: HTMLSpanElement; feedback: HullDamageFeedback;
  playerLoss: HTMLDivElement; playerNumber: HTMLSpanElement; otherNumber: HTMLSpanElement;
  lossAmount: number; playerAmount: number; lossOpacity: number; integrity: number;
};

/** A hull drawn from an observation report rather than a simulated actor: the PvE
 * enemy fleet. Health is the sampled fraction the report carries, absent when stale. */
export interface ObservedLabelReport { id: string; name: string; health?: number; sunk?: boolean }
type ObservedLabel = { root: HTMLDivElement; name: HTMLElement; meter: HTMLDivElement; fill: HTMLDivElement; health: HTMLSpanElement; text: string; percent: number | undefined; sunk: boolean };

/** Screen overlay follows rendered hull poses at frame rate, without React rerenders. */
export class ShipLabels {
  private root = document.createElement('div');
  private labels: Label[] = [];
  private observed = new Map<string, ObservedLabel>();
  private shown = new Map<string, ScreenPoint>();
  private width = 1;
  private height = 1;
  private sequence = 0;
  private time = 0;

  constructor(host: HTMLElement, private observedAnchor: (id: string) => Vector3 | undefined = () => undefined) {
    this.root.className = HUD_LAYERS.shipLabels.className;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Ship names and hull condition');
    host.appendChild(this.root);
  }

  setFleet(views: readonly ShipView[], actors: readonly FleetActor[], playerId = actors.find(a => a.controller === 'player' && a.team === 'friendly')?.motion.id): void {
    this.root.replaceChildren();
    this.shown.clear();
    this.sequence = 0;
    this.time = 0;
    this.labels = views.flatMap((view, index) => {
      const actor = actors[index];
      if (actor.motion.id === playerId) return [];
      const root = document.createElement('div');
      root.className = `ship-label ship-label-${actor.team}`;
      root.dataset.shipId = actor.motion.id;
      root.hidden = true;
      const tag = document.createElement('div'); tag.className = 'ship-label-tag';
      const name = document.createElement('strong'); name.className = 'ship-label-name'; name.textContent = actor.definition.name;
      const identity = `${actor.team === 'friendly' ? 'Ally' : 'Enemy'} ${actor.motion.id.split('-').at(-1)}`;
      const health = document.createElement('span'); health.className = 'ship-label-health';
      const meter = document.createElement('div'); meter.className = 'ship-label-meter';
      meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', `${actor.definition.name}, ${identity}, hull condition`);
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', String(actor.damage.maxIntegrity));
      const fill = document.createElement('div'); fill.className = 'ship-label-fill';
      const loss = document.createElement('div'); loss.className = 'ship-label-loss';
      const playerLoss = document.createElement('div'); playerLoss.className = 'ship-label-player-loss';
      const damageNumber = document.createElement('span'); damageNumber.className = 'ship-label-damage';
      const playerNumber = document.createElement('span'); playerNumber.dataset.source = 'player';
      const otherNumber = document.createElement('span'); otherNumber.dataset.source = 'other';
      damageNumber.append(playerNumber, otherNumber);
      damageNumber.hidden = true;
      loss.appendChild(playerLoss);
      meter.append(fill, loss);
      tag.append(name, meter, health, damageNumber); root.appendChild(tag); this.root.appendChild(root);
      // Measure the authored model once. Inspection helpers never change the anchor.
      const bounds = new Box3().setFromObject(view.root.children[0]);
      const top = bounds.isEmpty() ? actor.definition.hull.depth : bounds.max.y - view.root.position.y;
      return [{ actor, view, root, meter, fill, health, loss, playerLoss, damageNumber, playerNumber, otherNumber, feedback: new HullDamageFeedback(actor.damage.integrity), anchor: new Vector3(0, top + 5, 0), hp: -1, sunk: false, lossAmount: -1, playerAmount: -1, lossOpacity: -1, integrity: -1 }];
    });
  }

  /** Keep one label per reported exterior. Reports have no damage model, so the
   * meter shows the observed fraction and hides when the observation is stale. */
  setObserved(reports: readonly ObservedLabelReport[]): void {
    const active = new Set(reports.map(report => report.id));
    for (const [id, label] of this.observed) if (!active.has(id)) { label.root.remove(); this.observed.delete(id); this.shown.delete(id); }
    for (const report of reports) {
      let label = this.observed.get(report.id);
      if (!label) {
        const root = document.createElement('div');
        root.className = 'ship-label ship-label-enemy ship-label-observed';
        root.dataset.shipId = report.id;
        root.hidden = true;
        const tag = document.createElement('div'); tag.className = 'ship-label-tag';
        const name = document.createElement('strong'); name.className = 'ship-label-name';
        const health = document.createElement('span'); health.className = 'ship-label-health';
        const meter = document.createElement('div'); meter.className = 'ship-label-meter';
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('div'); fill.className = 'ship-label-fill';
        meter.appendChild(fill);
        tag.append(name, meter, health); root.appendChild(tag); this.root.appendChild(root);
        label = { root, name, meter, fill, health, text: '', percent: -1, sunk: false };
        this.observed.set(report.id, label);
      }
      if (label.text !== report.name) {
        label.text = report.name; label.name.textContent = report.name;
        label.meter.setAttribute('aria-label', `${report.name}, Enemy ${report.id.split('-').at(-1)}, observed hull condition`);
      }
      const percent = report.sunk || report.health === undefined ? undefined : Math.round(MathUtils.clamp(report.health, 0, 1) * 100);
      if (label.percent !== percent) {
        label.percent = percent;
        label.meter.hidden = percent === undefined; label.health.hidden = percent === undefined;
        if (percent !== undefined) {
          label.health.textContent = `${percent}%`;
          label.meter.setAttribute('aria-valuenow', String(percent));
          label.meter.setAttribute('aria-valuetext', `${percent} percent hull condition observed`);
          label.fill.style.transform = `scaleX(${percent / 100})`;
        }
      }
      if (label.sunk !== !!report.sunk) { label.sunk = !!report.sunk; label.root.classList.toggle('ship-label-sinking', label.sunk); }
    }
  }

  resize(width: number, height: number): void { this.width = width; this.height = height; }

  update(camera: Camera, time: number, events: readonly CombatEvent[] = [], playerId?: string): void {
    if (time < this.time) this.sequence = 0;
    this.time = time;
    const playerDamage = new Map<string, number>();
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (playerId && event.sourceId === playerId) {
        const amount = Math.max(0, event.impact?.hullDamage ?? event.hullDamage ?? 0);
        playerDamage.set(event.shipId, (playerDamage.get(event.shipId) ?? 0) + amount);
      }
    }
    camera.updateMatrixWorld();
    for (const label of this.labels) {
      const { actor, view, root } = label;
      const hp = Math.round(MathUtils.clamp(actor.damage.integrity, 0, actor.damage.maxIntegrity));
      const damage = label.feedback.update(actor.damage.integrity, time, playerDamage.get(actor.motion.id));
      if (label.integrity !== actor.damage.integrity) {
        label.integrity = actor.damage.integrity;
        label.loss.style.left = `${actor.damage.integrity / actor.damage.maxIntegrity * 100}%`;
      }
      const own = Math.min(damage.amount, label.feedback.playerAmount);
      if (label.lossAmount !== damage.amount || label.playerAmount !== own) {
        label.lossAmount = damage.amount;
        label.playerAmount = own;
        label.loss.style.width = `${damage.amount / actor.damage.maxIntegrity * 100}%`;
        label.damageNumber.hidden = damage.amount <= 0;
        label.playerLoss.style.width = `${damage.amount > 0 ? own / damage.amount * 100 : 0}%`;
        for (const [number, amount, source] of [[label.playerNumber, own, 'Your damage'], [label.otherNumber, damage.amount - own, 'Other damage']] as const) {
          number.hidden = amount <= 0;
          number.textContent = `−${Math.max(1, Math.round(amount)).toLocaleString()}`;
          number.setAttribute('aria-label', `${source}: ${Math.max(1, Math.round(amount))} hull HP`);
        }
      }
      if (label.lossOpacity !== damage.opacity) {
        label.lossOpacity = damage.opacity;
        label.loss.style.opacity = String(damage.opacity);
        label.damageNumber.style.opacity = String(damage.opacity);
      }
      if (label.hp !== hp || label.sunk !== actor.damage.sunk || label.health.dataset.status !== actor.damage.stability.status) {
        label.health.dataset.status = actor.damage.stability.status;
        label.hp = hp; label.sunk = actor.damage.sunk;
        const status = actor.damage.stability.status.replaceAll('-', ' ');
        label.health.textContent = `${Math.round(hp / actor.damage.maxIntegrity * 100)}%`;
        label.meter.hidden = label.sunk;
        label.health.hidden = label.sunk;
        label.meter.setAttribute('aria-valuenow', String(hp));
        label.meter.setAttribute('aria-valuemax', String(actor.damage.maxIntegrity));
        label.meter.setAttribute('aria-valuetext', `${Math.round(hp / actor.damage.maxIntegrity * 100)} percent hull condition, ${status}`);
        label.fill.style.transform = `scaleX(${hp / actor.damage.maxIntegrity})`;
        root.classList.toggle('ship-label-sinking', label.sunk);
      }
      view.root.updateWorldMatrix(true, false);
      const anchor = label.anchor.clone().applyMatrix4(view.root.matrixWorld);
      const point = view.root.visible && view.motion.y > -40 ? projectShipLabel(anchor, camera, this.width, this.height) : null;
      root.hidden = !point;
      if (point) { this.shown.set(actor.motion.id, point); root.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`; } else this.shown.delete(actor.motion.id);
    }
    for (const [id, label] of this.observed) {
      const anchor = this.observedAnchor(id);
      const point = anchor && anchor.y > -40 ? projectShipLabel(anchor, camera, this.width, this.height) : null;
      label.root.hidden = !point;
      if (point) { this.shown.set(id, point); label.root.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`; } else this.shown.delete(id);
    }
  }

  dispose(): void { this.root.remove(); this.labels = []; this.observed.clear(); }
}
