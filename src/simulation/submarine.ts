import type { Handling, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import { systemHealth } from '../game/machinery';
import { hullDepth } from '../game/session/motion';
import { clamp } from '../game/geometry';

export { DEPTH_STEP_M } from '../game/session/motion';

export type { SubmarineState } from '../game/session/elements';
import type { SubmarineState } from '../game/session/elements';
export const createSubmarineState = (): SubmarineState => ({ targetDepthM: 0, ballastM3: 0, emergencyBlow: false, planes: 0, trimPitch: 0, waveHeave: 0, waveSpeed: 0 });

/** Commands are persistent, finite and bounded; a new depth order cancels a blow. */
export function orderDepth(actor: Combatant, definition: ShipDefinition, depthM: number, emergency = false): void {
  if (!actor.submarine || !definition.submarine || actor.damage.sunk || !Number.isFinite(depthM)) return;
  actor.submarine.targetDepthM = emergency ? 0 : clamp(depthM, 0, definition.submarine.maxDepthM);
  actor.submarine.emergencyBlow = emergency;
}

/** Diesels stop as the casing goes under; submerged propulsion uses its own modules. */
export function submarinePropulsion(actor: Combatant, def: ShipDefinition): { handling: Handling; power: number } | undefined {
  const equipment = def.submarine;
  if (!equipment) return undefined;
  const submerged = hullDepth(actor.motion) > .5;
  return { handling: submerged ? equipment.submergedHandling : def.handling, power: systemHealth(actor, def, 'engine') };
}
