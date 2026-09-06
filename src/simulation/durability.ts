import type { Combatant, Shell } from './damage';
import type { ShipDefinition } from '../ships/blueprint';

/** Shared gameplay calibration, independent of a preset's geometry or identity.
 * A 70-point 38 cm AP penetration costs 45.5 hull HP: about 32 clean hits on
 * Bismarck's 1,450 HP. Local weapons, machinery and flooding remain separate. */
export const HULL_DAMAGE = { penetration: .65, overpenetration: .15, equipment: .85, hePenetration: .35, heEquipment: .5 } as const;

export function damageHull(actor: Combatant, amount: number): number {
  if (actor.damage.sunk || actor.damage.stability.combatLost) return 0;
  const dealt = Math.min(actor.damage.integrity, Math.max(0, amount));
  actor.damage.integrity -= dealt;
  return dealt;
}

/** Upgrade one shell's total on each victim. Entry, exit, inner plates and the
 * delayed burst share this ceiling, including across simulation ticks. */
export function damageShellHull(shell: Shell, actor: Combatant, total: number): number {
  const ledger = shell.hullDamage ??= {};
  const previous = ledger[actor.motion.id] ?? 0;
  const dealt = damageHull(actor, Math.max(0, total - previous));
  ledger[actor.motion.id] = previous + dealt;
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
