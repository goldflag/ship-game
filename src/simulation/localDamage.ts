import type { DamageRegion, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from './damage';
import { contains } from './geometry';

export interface RegionState { id: string; hp: number; maximum: number; }
export interface LocalDamageEvidence { regionId: string; regionName: string; condition: number; multiplier: number; }
export function createRegions(def: ShipDefinition, hullHp: number): RegionState[] {
  return (def.localDamage?.regions ?? []).map(r => ({ id: r.id, hp: r.durabilityFraction * hullHp, maximum: r.durabilityFraction * hullHp }));
}
/** Explicit mount ownership wins over fixed volumes. Fixed overlaps choose the
 * smallest volume, so a bridge does not consume the machinery below it. */
export function damageRegion(def: ShipDefinition, point: Vec3, mountId?: string): DamageRegion | undefined {
  const regions = def.localDamage?.regions;
  if (!regions) return;
  if (mountId) return regions.find(r => r.mountId === mountId);
  let best: DamageRegion | undefined, volume = Infinity;
  for (const r of regions) {
    if (r.mountId || !contains(r, point)) continue;
    const size = r.size[0] * r.size[1] * r.size[2];
    if (size < volume) { best = r; volume = size; }
  }
  return best;
}
export function regionCondition(actor: Combatant, id: string): number {
  const region = actor.damage.regions.find(r => r.id === id);
  return region ? region.hp / region.maximum : 1;
}
export function localDamageEvidence(actor: Combatant, def: ShipDefinition, point: Vec3, mountId?: string): LocalDamageEvidence | undefined {
  const r = damageRegion(def, point, mountId);
  if (!r) return;
  const condition = regionCondition(actor, r.id);
  return { regionId: r.id, regionName: r.name, condition, multiplier: Math.min(1, condition * 2) };
}
/** Full damage through the first half, then an exponential taper. This exact
 * integration makes a long fire tick equivalent to many short ticks. Exhausted
 * local capacity cannot be spent again and repairs never refill it. */
export function consumeStructure(actor: Combatant, amount: number, regionId?: string): number {
  if (amount <= 0) return 0;
  const region = actor.damage.regions.find(r => r.id === regionId);
  if (!region) return amount;
  const before = region.hp, half = region.maximum / 2;
  const full = Math.min(amount, Math.max(0, before - half));
  region.hp -= full;
  region.hp *= Math.exp(-(amount - full) / half);
  if (region.hp < .001) region.hp = 0;
  return before - region.hp;
}
