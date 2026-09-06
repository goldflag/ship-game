import type { Handling, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { HelmCommand } from './ship';
import { clamp } from './geometry';

export interface SubmarineState {
  targetDepthM: number;
  ballastM3: number;
  emergencyBlow: boolean;
  /** Positive plane order dives; pitch is positive bow-up. */
  planes: number;
  trimPitch: number;
}
export const createSubmarineState = (): SubmarineState => ({ targetDepthM: 0, ballastM3: 0, emergencyBlow: false, planes: 0, trimPitch: 0 });

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
  const submerged = actor.motion.y < -.5;
  const ids = submerged ? equipment.submergedEngineIds : equipment.surfaceEngineIds;
  const power = actor.damage.sunk ? 0 : ids.reduce((sum, id) => {
    const module = def.modules.find(m => m.id === id)!;
    return sum + clamp((actor.damage.modules.find(m => m.id === id)?.hp ?? 0) / module.hp, 0, 1);
  }, 0) / ids.length;
  return { handling: submerged ? equipment.submergedHandling : def.handling, power };
}

/** A bounded ballast/plane depth keeper, separate from irreversible damage flooding.
 * Extra immersed volume restores buoyancy near the surface. Floodwater adds weight;
 * tank filling/blowing takes time and planes lose authority when stopped.
 * Tuned gameplay hydrostatics, not an engineering pressure-hull model. */
export function stepSubmarine(actor: Combatant, def: ShipDefinition, command: HelmCommand, dt: number): void {
  const s = actor.submarine, equipment = def.submarine;
  if (!s || !equipment || actor.damage.sunk) return;
  if (command.depthM !== undefined) orderDepth(actor, def, command.depthM, command.emergencyBlow);
  const motion = actor.motion, depth = Math.max(0, -motion.y);
  const water = actor.damage.compartments.reduce((sum, c) => sum + c.waterM3, 0);
  const capacity = equipment.ballastCapacityM3;
  const immersion = clamp(depth / Math.max(.5, def.hull.depth - def.hull.draft), 0, 1);
  const neutral = equipment.neutralBallastFraction * immersion;
  const downSpeed = -(motion.verticalSpeed ?? 0);
  const desiredSpeed = clamp((s.targetDepthM - depth) * .22, -equipment.maxRiseSpeed, equipment.maxDiveSpeed);
  const speedError = desiredSpeed - downSpeed;
  const targetBallast = s.targetDepthM === 0 ? 0 : clamp(neutral - water / capacity + speedError * .3, 0, 1) * capacity;
  const rate = targetBallast > s.ballastM3 ? equipment.floodRateM3PerSecond : s.emergencyBlow ? equipment.emergencyBlowRateM3PerSecond : equipment.blowRateM3PerSecond;
  s.ballastM3 += clamp(targetBallast - s.ballastM3, -rate * dt, rate * dt);
  const authority = clamp(Math.abs(motion.speed) / equipment.submergedHandling.forwardSpeed, 0, 1);
  const planeOrder = s.emergencyBlow ? -1 : clamp(speedError, -1, 1);
  s.planes += clamp(planeOrder - s.planes, -dt * .6, dt * .6);
  const acceleration = (s.ballastM3 / capacity + water / capacity - neutral) * 1.8 + s.planes * authority * .4 - downSpeed * .25;
  const nextSpeed = clamp(downSpeed + acceleration * dt, -equipment.maxRiseSpeed, equipment.maxDiveSpeed);
  const nextDepth = Math.max(0, depth + nextSpeed * dt);
  motion.y = -nextDepth;
  motion.verticalSpeed = nextDepth === 0 ? 0 : -nextSpeed;
  const pitch = -clamp(nextSpeed / Math.max(3, Math.abs(motion.speed)) * .24, -.14, .14);
  s.trimPitch += (pitch - s.trimPitch) * (1 - Math.exp(-dt / 2));
  // updateFlooding computed the damage trim immediately before this step.
  motion.pitch = clamp(motion.pitch + s.trimPitch, -.3, .3);
  if (nextDepth === 0 && s.ballastM3 < .01) s.emergencyBlow = false;
  // A damaged boat can pass the commanded depth limit; excess pressure costs HP.
  if (nextDepth > equipment.maxDepthM) actor.damage.integrity = Math.max(0, actor.damage.integrity - (nextDepth - equipment.maxDepthM) * .5 * dt);
}
