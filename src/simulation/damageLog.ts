import { FIXED_DT } from './ship';

export interface DamageLogEntry {
  id: number;
  tick: number;
  sourceId: string;
  targetId: string;
  weapon: string;
  damage: number;
  hits: number;
}

/** A bounded battle record, independent of the short-lived visual event queue. */
export class DamageLog {
  private sequence = 0;
  private entries: { entry: DamageLogEntry; firstTick: number; projectiles: Set<number> }[] = [];

  record(hit: Omit<DamageLogEntry, 'id' | 'hits'> & { projectileId: number }): void {
    if (!Number.isFinite(hit.damage) || hit.damage <= 0) return;
    const index = this.entries.findIndex(({ entry, firstTick }) =>
      (hit.tick - firstTick) * FIXED_DT <= 1 && hit.tick >= firstTick &&
      entry.sourceId === hit.sourceId && entry.targetId === hit.targetId && entry.weapon === hit.weapon);
    const group = index >= 0 ? this.entries.splice(index, 1)[0] : {
      entry: { id: ++this.sequence, tick: hit.tick, sourceId: hit.sourceId, targetId: hit.targetId, weapon: hit.weapon, damage: 0, hits: 0 },
      firstTick: hit.tick, projectiles: new Set<number>(),
    };
    group.projectiles.add(hit.projectileId);
    group.entry = { ...group.entry, tick: hit.tick, damage: group.entry.damage + hit.damage, hits: group.projectiles.size };
    this.entries.unshift(group);
    this.entries.length = Math.min(this.entries.length, 40);
  }

  snapshot(): DamageLogEntry[] { return this.entries.map(({ entry }) => ({ ...entry })); }
  clear(): void { this.entries.length = 0; this.sequence = 0; }
}
