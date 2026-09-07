import type { FleetActor } from './battle';
import type { Vec3 } from '../ships/blueprint';
import { addBreach } from './breaches';
import { damageHull } from './durability';
import { localDamageEvidence } from './localDamage';
import { worldToLocal } from './geometry';

export interface HullImpact { actor: FleetActor; other?: FleetActor; position: Vec3; damage: number; kind: 'collision' | 'grounding'; }
/** Dissipated contact energy, not overlap depth, drives crushing. This prevents
 * resting or solver-corrected overlaps from repeatedly damaging a hull.
 * Energy-to-HP and breach area are provisional game calibration. */
export function damageHullContact(actor: FleetActor, position: Vec3, energyJ: number): number {
  if (energyJ <= 25000 || actor.damage.sunk) return 0;
  const point = worldToLocal(position, actor.motion);
  const amount = Math.sqrt((energyJ - 25000) / 1e6) * 12;
  const local = localDamageEvidence(actor, actor.definition, point);
  const dealt = damageHull(actor, amount, local?.regionId);
  const rooms = actor.definition.compartments.map((c, i) => ({ i, distance: Math.min(...(c.cells ?? [c]).map(cell =>
    Math.hypot(...point.map((v, axis) => Math.max(0, Math.abs(v - cell.center[axis]) - cell.size[axis] / 2))))) }));
  const nearest = rooms.sort((a, b) => a.distance - b.distance)[0];
  if (nearest && energyJ > 250000) addBreach(actor.damage.compartments[nearest.i], point, Math.min(2, (energyJ - 250000) / 1e8), -1);
  return dealt;
}
