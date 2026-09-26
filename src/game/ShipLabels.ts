import { HUD_LAYERS } from '../ui/hudLayers';
import { Box3, MathUtils, Vector3, WebGPUCoordinateSystem, type Camera } from 'three/webgpu';
import type { ShipView } from './ShipView';
import { HullDamageFeedback } from './HullDamageFeedback';
import { HIT_KINDS, isHit, SALVO_FADE, SALVO_HOLD, SalvoTally, type HitKind, type SalvoCue } from './SalvoTally';
import { FIXED_DT } from './session/motion';
import type { Module } from '../ships/blueprint';
import type { CombatEvent, FleetActor } from '../game/session/elements';

type ScreenPoint = { x: number; y: number };

/** Match the renderer's depth range so ships behind the camera never acquire mirrored labels. */
export function projectShipLabel(anchor: Vector3, camera: Camera, width: number, height: number, hull?: Vector3): ScreenPoint | null {
  const point = anchor.clone().project(camera);
  // Clip depth runs 0..1 once WebGPU has drawn the camera (and for reversed depth); a camera
  // nothing has rendered yet keeps three's default -1..1.
  const minDepth = camera.reversedDepth || camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1;
  if (![point.x, point.y, point.z].every(Number.isFinite) || point.z < minDepth || point.z > 1 || Math.abs(point.x) > 1) return null;
  // Bound the world-space mast offset in logical HUD pixels when the hull is visible.
  // Generic map projections keep strict clipping and never become edge markers.
  const hullPoint = hull && projectShipLabel(hull, camera, width, height);
  if (hullPoint) {
    return { x: (point.x + 1) * width / 2, y: Math.max(60, hullPoint.y - 96, (1 - point.y) * height / 2) };
  }
  if (Math.abs(point.y) > 1) return null;
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
}

const ICONS: Record<HitKind | 'damaged' | 'destroyed', string> = {
  penetrated: 'M9 2v4m0 6v4M2 9h14m-4-4 4 4-4 4',
  burst: 'M9 1.5v4M9 12.5v4M1.5 9h4M12.5 9h4M3.7 3.7l2.8 2.8M11.5 11.5l2.8 2.8M3.7 14.3l2.8-2.8M11.5 6.5l2.8-2.8',
  ricochet: 'M2 16h14M3 3l6 9 6-9m-4 0h4v4',
  stopped: 'M9 2 15 4v5c0 3-3 5-6 7-3-2-6-4-6-7V4Z M5.5 9h7',
  torpedo: 'M4 7h9.5a2 2 0 0 1 0 4H4Z M4 7 2 5v8l2-2',
  damaged: 'M9 2.5 16 15H2Z M9 7.5v3.5 M9 13.2v.3',
  destroyed: 'M3 3h12v12H3Z M6 6l6 6m0-6-6 6',
};
const HIT_NAMES: Record<HitKind, string> = { penetrated: 'penetrated', burst: 'burst outside', ricochet: 'ricochet', stopped: 'stopped', torpedo: 'torpedo' };
const MODULE_LABELS: Record<Module['kind'], string> = {
  engine: 'Engine', steering: 'Steering', magazine: 'Magazine',
  generator: 'Generator', 'fire-control': 'Fire control', launcher: 'Launcher',
};

function icon(kind: keyof typeof ICONS): HTMLElement {
  const element = document.createElement('i');
  element.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${ICONS[kind]}"/></svg>`;
  return element;
}

/** Name struck equipment by its type: construction ids never reach the combat HUD. */
function equipmentName(actor: FleetActor, event: CombatEvent): string | undefined {
  const impact = event.impact;
  if (impact?.kind === 'mount') return actor.definition.mounts.find(mount => mount.id === impact.targetId)?.battery === 'secondary' ? 'Secondary gun' : 'Main gun';
  const module = impact?.kind === 'module' ? actor.definition.modules.find(module => module.id === impact.targetId) : undefined;
  return module && MODULE_LABELS[module.kind];
}

type EquipmentRow = { root: HTMLSpanElement; state: HTMLElement; name: HTMLSpanElement; detail: HTMLElement; key?: string; text: string };
type Label = {
  actor: FleetActor; view: ShipView; anchor: Vector3; root: HTMLDivElement;
  meter: HTMLDivElement; fill: HTMLDivElement; health: HTMLSpanElement; hp: number; sunk: boolean;
  loss: HTMLDivElement; damageNumber: HTMLSpanElement; feedback: HullDamageFeedback; tally: SalvoTally;
  playerLoss: HTMLDivElement; playerNumber: HTMLSpanElement; otherNumber: HTMLSpanElement;
  hits: HTMLSpanElement; kinds: Record<HitKind, { root: HTMLSpanElement; count: HTMLElement }>; equipment: EquipmentRow[];
  /** Equipment losses show only on the opposing side, as the old impact labels did. */
  enemy: boolean; readout: string; rows: WeakMap<HTMLElement, { since: number; faded: number; state: string }>;
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
  private byShip = new Map<string, Label>();
  /** Your main-battery calibers, and the caliber of each shell you fired: automatic secondary fire is not your salvo. */
  private mainCalibers: number[] = [];
  private shellCalibers = new Map<number, number>();
  private observed = new Map<string, ObservedLabel>();
  private shown = new Map<string, ScreenPoint>();
  private width = 1;
  private height = 1;
  private sequence = 0;
  private time = 0;

  constructor(host: HTMLElement, private observedAnchor: (id: string) => Vector3 | undefined = () => undefined, private observedPosition: (id: string) => Vector3 | undefined = () => undefined) {
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
    const player = actors.find(actor => actor.motion.id === playerId);
    const playerTeam = player?.team ?? 'friendly';
    this.mainCalibers = player?.definition.mounts.filter(mount => mount.battery === 'main').map(mount => mount.weapon.caliberM) ?? [];
    this.shellCalibers.clear();
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
      // One block beside the tag: your salvo total, its hit counts, other damage, lost equipment.
      const damageNumber = document.createElement('span'); damageNumber.className = 'ship-label-damage';
      const playerNumber = document.createElement('span'); playerNumber.dataset.source = 'player';
      const otherNumber = document.createElement('span'); otherNumber.dataset.source = 'other';
      const hits = document.createElement('span'); hits.className = 'ship-label-hits';
      const kinds = Object.fromEntries(HIT_KINDS.map(kind => {
        const item = document.createElement('span'); item.dataset.kind = kind;
        const count = document.createElement('b');
        item.append(icon(kind), count); hits.appendChild(item);
        return [kind, { root: item, count }];
      })) as Label['kinds'];
      damageNumber.append(playerNumber, hits, otherNumber);
      damageNumber.hidden = true;
      loss.appendChild(playerLoss);
      meter.append(fill, loss);
      tag.append(name, meter, health, damageNumber); root.appendChild(tag); this.root.appendChild(root);
      // Measure the authored model once. Inspection helpers never change the anchor.
      const bounds = new Box3().setFromObject(view.root.children[0]);
      const top = bounds.isEmpty() ? actor.definition.hull.depth : bounds.max.y - view.root.position.y;
      return [{ actor, view, root, meter, fill, health, loss, playerLoss, damageNumber, playerNumber, otherNumber, hits, kinds, equipment: [],
        feedback: new HullDamageFeedback(actor.damage.integrity), tally: new SalvoTally(),
        enemy: actor.team !== playerTeam, readout: '', rows: new WeakMap(),
        anchor: new Vector3(0, top + 5, 0), hp: -1, sunk: false, lossAmount: -1, playerAmount: -1, lossOpacity: -1, integrity: -1 }];
    });
    this.byShip = new Map(this.labels.map(label => [label.actor.motion.id, label]));
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

  /** `battery` is the weapon group you are firing: secondary-battery hits join your salvo only while it is `secondary`. */
  update(camera: Camera, time: number, events: readonly CombatEvent[] = [], playerId?: string, battery?: string): void {
    if (time < this.time) this.sequence = 0;
    this.time = time;
    const playerDamage = new Map<string, number>();
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      const own = !!playerId && event.sourceId === playerId;
      if (own) {
        const amount = Math.max(0, event.impact?.hullDamage ?? event.hullDamage ?? 0);
        playerDamage.set(event.shipId, (playerDamage.get(event.shipId) ?? 0) + amount);
      }
      if (event.kind === 'shot' && event.shipId === playerId && event.shell) {
        this.shellCalibers.set(event.shell.id, event.shell.caliberM);
        if (this.shellCalibers.size > 4096) this.shellCalibers.delete(this.shellCalibers.keys().next().value!);
      }
      // A rebuilt fleet replays the retained events; only hits that could still show count.
      const label = this.byShip.get(event.shipId);
      if (label && (isHit(event) || (event.hullDamage ?? 0) > 0) && time - event.tick * FIXED_DT < SALVO_HOLD + SALVO_FADE) {
        const caliber = event.shell?.caliberM ?? this.shellCalibers.get(event.impact?.shellId ?? NaN);
        const automatic = caliber !== undefined && battery !== 'secondary' && this.mainCalibers.length > 0
          && !this.mainCalibers.some(main => Math.abs(main - caliber) < 1e-4);
        label.tally.add(event, time, own && !automatic, label.enemy ? equipmentName(label.actor, event) : undefined);
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
        label.playerLoss.style.width = `${damage.amount > 0 ? own / damage.amount * 100 : 0}%`;
      }
      if (label.lossOpacity !== damage.opacity) {
        label.lossOpacity = damage.opacity;
        label.loss.style.opacity = String(damage.opacity);
      }
      this.renderDamage(label, time, label.tally.read(time), damage.amount - own, damage.opacity);
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
      const point = view.root.visible && view.motion.y > -40 ? projectShipLabel(anchor, camera, this.width, this.height, view.root.getWorldPosition(new Vector3())) : null;
      root.hidden = !point;
      if (point) { this.shown.set(actor.motion.id, point); root.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`; } else this.shown.delete(actor.motion.id);
    }
    for (const [id, label] of this.observed) {
      const anchor = this.observedAnchor(id);
      const point = anchor && anchor.y > -40 ? projectShipLabel(anchor, camera, this.width, this.height, this.observedPosition(id)) : null;
      label.root.hidden = !point;
      if (point) { this.shown.set(id, point); label.root.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`; } else this.shown.delete(id);
    }
  }

  /** Write the block beside the tag: your salvo total, its hit counts, other damage, lost equipment. */
  private renderDamage(label: Label, time: number, salvo: SalvoCue, other: number, otherOpacity: number): void {
    const idle = label.damageNumber.hidden;
    if (idle && !(salvo.opacity > 0) && !(other > 0 && otherOpacity > 0) && !salvo.equipment.length) return;
    const readout = JSON.stringify([Math.round(salvo.damage), salvo.kinds, Math.round(other)]);
    if (label.readout !== readout) {
      label.readout = readout;
      const whole = (amount: number) => Math.max(1, Math.round(amount));
      label.playerNumber.textContent = `−${whole(salvo.damage).toLocaleString()}`;
      label.playerNumber.setAttribute('aria-label', `Your salvo: ${whole(salvo.damage)} hull HP`);
      label.otherNumber.textContent = `−${whole(other).toLocaleString()}`;
      label.otherNumber.setAttribute('aria-label', `Other damage: ${whole(other)} hull HP`);
      for (const kind of HIT_KINDS) {
        label.kinds[kind].root.hidden = !salvo.kinds[kind];
        label.kinds[kind].count.textContent = String(salvo.kinds[kind]);
      }
      label.hits.setAttribute('aria-label', `${salvo.hits} ${salvo.hits === 1 ? 'hit' : 'hits'}: ${
        HIT_KINDS.filter(kind => salvo.kinds[kind]).map(kind => `${salvo.kinds[kind]} ${HIT_NAMES[kind]}`).join(', ')}`);
    }
    // Each lost part keeps its line while the block shows; a fresh block lists them in the order they fell.
    if (idle) for (const row of label.equipment) row.key = undefined;
    const equipment = new Map<EquipmentRow, number>();
    for (const cue of salvo.equipment) {
      const status = cue.destroyed ? 'destroyed' : 'damaged', key = `${cue.label}:${status}`;
      let row = label.equipment.find(row => row.key === key) ?? label.equipment.find(row => row.key === undefined);
      if (!row) {
        const root = document.createElement('span'); root.className = 'ship-label-equipment';
        const state = document.createElement('i'), name = document.createElement('span'), detail = document.createElement('em');
        root.append(state, name, detail);
        label.damageNumber.appendChild(root);
        label.equipment.push(row = { root, state, name, detail, text: '' });
      }
      row.key = key;
      const text = `${cue.label}|${status}|${cue.count}`;
      if (row.text !== text) {
        row.text = text;
        row.root.dataset.state = status;
        row.state.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${ICONS[status]}"/></svg>`;
        row.name.textContent = cue.label;
        row.detail.textContent = cue.count > 1 ? `${status} ×${cue.count}` : status;
      }
      equipment.set(row, cue.opacity);
    }
    const rows: [HTMLElement, number][] = [
      [label.playerNumber, salvo.damage > 0 ? salvo.opacity : -1],
      [label.hits, salvo.hits > 0 ? salvo.opacity : -1],
      [label.otherNumber, other > 0 ? otherOpacity : -1],
      ...label.equipment.map((row): [HTMLElement, number] => [row.root, equipment.get(row) ?? (row.key ? 0 : -1)]),
    ];
    // -1: nothing to say. A faded row keeps its place while a row below it that was already showing
    // still shows, so the lines under it never jump; a row that appears later closes the gap instead.
    let below = Infinity;
    for (let i = rows.length - 1; i >= 0; i--) {
      const [row, opacity] = rows[i];
      let mark = label.rows.get(row);
      if (!mark) label.rows.set(row, mark = { since: Infinity, faded: -Infinity, state: '' });
      if (opacity > 0) mark.since = Math.min(mark.since, time);
      else if (mark.since !== Infinity) { mark.since = Infinity; mark.faded = time; }
      const state = opacity > 0 ? opacity.toFixed(3) : opacity === 0 && mark.faded >= below ? 'held' : 'gone';
      if (opacity > 0) below = Math.min(below, mark.since);
      if (mark.state === state) continue;
      mark.state = state;
      row.hidden = state === 'gone';
      row.style.visibility = state === 'held' ? 'hidden' : '';
      row.style.opacity = state === 'held' || state === 'gone' ? '0' : state;
    }
    label.damageNumber.hidden = below === Infinity;
  }

  dispose(): void { this.root.remove(); this.labels = []; this.byShip.clear(); this.observed.clear(); }
}
