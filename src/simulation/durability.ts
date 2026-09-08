import { physicalLoss } from './battleRules';
import type { Combatant, Shell } from './damage';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { consumeStructure, type LocalDamageEvidence } from './localDamage';

/** Converts authored equipment-scale damage to gameplay hull HP. Shared by
 * historical presets and custom blueprints; preserves relative endurance. */
export const HULL_HP_SCALE = 35;

/** AP penetration costs 65% of authored damage before scaling and saturation. */
export const HULL_DAMAGE = { penetration: .65, overpenetration: .15, equipment: .85, hePenetration: .35, heEquipment: .5 } as const;

/** Accepts authored damage units; returns whole gameplay HP lost. Fractional
 * consumption carries forward so splitting a hit never erases small damage. */
export function damageHull(actor: Combatant, amount: number, regionId?: string): number {
  if (physicalLoss(actor)) return 0;
  const consumed = consumeStructure(actor, Math.max(0, amount) * HULL_HP_SCALE, regionId);
  const pending = consumed + actor.damage.hullDamageRemainder;
  const whole = Math.floor(pending + 1e-9);
  actor.damage.hullDamageRemainder = Math.max(0, pending - whole);
  const dealt = Math.min(actor.damage.integrity, whole);
  actor.damage.integrity -= dealt;
  return dealt;
}
/** Underwater shock distributes one finite budget over nearby hull structure.
 * A torpedo does not squeeze its entire blast into one shell-sized region. */
export function damageBlastHull(actor: Combatant, def: ShipDefinition, point: Vec3, amount: number): number {
  if (!def.localDamage) return damageHull(actor, amount);
  const radius = Math.max(10, Math.cbrt(Math.max(0, amount)) * 3);
  const regions = def.localDamage.regions.filter(r => r.kind === 'hull').map(r => {
    const distance = Math.hypot(...point.map((n, i) => Math.max(0, Math.abs(n - r.center[i]) - r.size[i] / 2)));
    return { r, weight: Math.max(0, 1 - distance / radius) };
  }).filter(r => r.weight > 0);
  const total = regions.reduce((n, r) => n + r.weight, 0);
  return total ? regions.reduce((n, { r, weight }) => n + damageHull(actor, amount * weight / total, r.id), 0) : 0;
}

/** Upgrade one shell's total on each victim. Entry, exit, inner plates and the
 * delayed burst share this ceiling, including across simulation ticks. */
export function damageShellHull(shell: Shell, actor: Combatant, total: number, local?: LocalDamageEvidence): number {
  const ledger = shell.hullDamage ??= {};
  const consumed = shell.hullDamageConsumed ??= {};
  const previous = consumed[actor.motion.id] ?? 0;
  // A saturated entry must not spend the intact interior's damage opportunity.
  // Remember nominal contact ceilings separately from HP actually removed.
  const zones = shell.hullRegionDamage ??= {};
  const key = `${actor.motion.id}:${local?.regionId ?? 'legacy'}`;
  const nominal = zones[key] ?? 0;
  zones[key] = Math.max(nominal, total);
  const remainder = actor.damage.hullDamageRemainder;
  const dealt = damageHull(actor, Math.max(0, Math.min(total - nominal, total - previous)), local?.regionId);
  consumed[actor.motion.id] = previous + (dealt + actor.damage.hullDamageRemainder - remainder) / HULL_HP_SCALE;
  ledger[actor.motion.id] = (ledger[actor.motion.id] ?? 0) + dealt;
  return dealt;
}

export function penetrationHullDamage(shell: Shell, resistanceMm: number): number {
  const arming = shell.ap?.armingResistanceMm ?? shell.caliberM * 1000 / 6;
  return shell.damage * (resistanceMm >= arming ? HULL_DAMAGE.penetration : HULL_DAMAGE.overpenetration);
}

export function equipmentIntegrity(actor: Combatant, def: ShipDefinition): number {
  const maximum = def.modules.reduce((n, m) => n + m.hp, 0) + def.mounts.length * 100;
  return maximum ? (actor.damage.modules.reduce((n, m) => n + m.hp, 0) + actor.mounts.reduce((n, m) => n + m.hp, 0)) / maximum : 1;
}
