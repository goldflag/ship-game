import type { CombatEvent } from './session/elements';

/** How one of your projectiles ended against a ship, counted as the after-action record does. */
export type HitKind = 'penetrated' | 'burst' | 'ricochet' | 'stopped' | 'torpedo';
export const HIT_KINDS: readonly HitKind[] = ['penetrated', 'burst', 'ricochet', 'stopped', 'torpedo'];

export interface EquipmentCue { label: string; destroyed: boolean; count: number; opacity: number }
export interface SalvoCue {
  /** Hull HP your hits removed. */
  damage: number;
  hits: number;
  kinds: Record<HitKind, number>;
  opacity: number;
  equipment: EquipmentCue[];
}

/** The total holds this long after your latest hit, then fades. A hit that lands while it still
 * shows joins it, so mounts that fire a moment apart read as one salvo. */
export const SALVO_HOLD = 2;
export const SALVO_FADE = .6;
const EQUIPMENT_HOLD = 3.2;
const EQUIPMENT_FADE = .8;
const TORPEDO_HITS = new Set<CombatEvent['kind']>(['torpedo-hit', 'torpedo-dud', 'depth-charge-hit']);

/** A projectile striking a ship: a shell impact layer, or a torpedo or depth charge. */
export const isHit = (event: CombatEvent) => !!event.impact || TORPEDO_HITS.has(event.kind);

const projectileId = (event: CombatEvent) =>
  event.shell?.id ?? event.torpedo?.id ?? event.depthCharge?.id ?? event.impact?.shellId ?? -event.sequence;

/** Mirror records.rs: a shell is as far along as its deepest layer, and once inside it stays a penetration. */
export function advanceHit(current: HitKind | undefined, event: CombatEvent): HitKind {
  if (event.kind === 'torpedo-dud') return current ?? 'stopped';
  if (event.kind === 'torpedo-hit' || event.kind === 'depth-charge-hit') return 'torpedo';
  const impact = event.impact;
  let next: HitKind = current ?? 'stopped';
  if (impact) {
    if (current === 'penetrated' || impact.outcome === 'penetrated' || impact.kind === 'module' || impact.kind === 'boundary') next = 'penetrated';
    else if (impact.outcome === 'detonation' || current === 'burst') next = 'burst';
    else if (impact.outcome === 'ricochet') next = 'ricochet';
    else if (impact.outcome === 'stopped') next = 'stopped';
  }
  return event.kind === 'burst' && next !== 'penetrated' ? 'burst' : next;
}

const fade = (age: number, hold: number, span: number) => Math.max(0, Math.min(1, 1 - (age - hold) / span));

/** One ship's hit feedback: your salvo total and outcome counts, plus equipment it lost to anyone.
 * Presentation only; simulation time holds it still while combat is paused. */
export class SalvoTally {
  private time = -Infinity;
  private last = -Infinity;
  private damage = 0;
  private shells = new Map<number, HitKind>();
  private equipment = new Map<string, { label: string; destroyed: boolean; time: number }>();

  /** A projectile hit or other hull damage on this ship. `own` says it belongs to your salvo;
   * `equipment` names the struck mount or module, or is absent when its loss should not show. */
  add(event: CombatEvent, time: number, own: boolean, equipment?: string): void {
    this.rewind(time);
    if (own) {
      if (time - this.last > SALVO_HOLD + SALVO_FADE) { this.damage = 0; this.shells.clear(); }
      this.last = time;
      this.damage += Math.max(0, event.impact?.hullDamage ?? event.hullDamage ?? 0);
      // A ram adds to the total but is not a hit to count.
      if (isHit(event)) {
        const id = projectileId(event);
        this.shells.set(id, advanceHit(this.shells.get(id), event));
      }
    }
    const impact = event.impact;
    // Wreckage struck again is not news; a destroyed mount stays destroyed while it shows.
    if (!equipment || !impact || impact.throughWreckage || !((impact.damage ?? 0) > 0)
      || !['damaged', 'destroyed', 'detonation'].includes(impact.outcome)) return;
    const prior = this.equipment.get(impact.targetId);
    this.equipment.set(impact.targetId, { label: equipment, destroyed: impact.outcome !== 'damaged' || !!prior?.destroyed, time });
  }

  read(time: number): SalvoCue {
    this.rewind(time);
    const kinds = Object.fromEntries(HIT_KINDS.map(kind => [kind, 0])) as Record<HitKind, number>;
    for (const kind of this.shells.values()) kinds[kind]++;
    const equipment: EquipmentCue[] = [];
    for (const [id, entry] of this.equipment) {
      const opacity = fade(time - entry.time, EQUIPMENT_HOLD, EQUIPMENT_FADE);
      if (opacity <= 0) { this.equipment.delete(id); continue; }
      const same = equipment.find(cue => cue.label === entry.label && cue.destroyed === entry.destroyed);
      if (same) { same.count++; same.opacity = Math.max(same.opacity, opacity); }
      else equipment.push({ label: entry.label, destroyed: entry.destroyed, count: 1, opacity });
    }
    const shown = this.damage > 0 || this.shells.size > 0;
    return { damage: this.damage, hits: this.shells.size, kinds, opacity: shown ? fade(time - this.last, SALVO_HOLD, SALVO_FADE) : 0, equipment };
  }

  private rewind(time: number): void {
    if (time < this.time) {
      this.last = -Infinity; this.damage = 0; this.shells.clear(); this.equipment.clear();
    }
    this.time = time;
  }
}
