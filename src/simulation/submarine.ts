import type { Handling, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import { addBreach } from './damage';
import { systemHealth } from './machinery';
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
  return { handling: submerged ? equipment.submergedHandling : def.handling, power: systemHealth(actor, def, 'engine') };
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
  const previousTrim = s.trimPitch;
  s.trimPitch += (pitch - s.trimPitch) * (1 - Math.exp(-dt / 2));
  // updateFlooding computed the damage trim immediately before this step.
  // A stability profile integrates its own pitch, so only add the trim change.
  motion.pitch = clamp(motion.pitch + s.trimPitch - (def.stability ? previousTrim : 0), -.3, .3);
  if (nextDepth === 0 && s.ballastM3 < .01) s.emergencyBlow = false;
  // Excess pressure opens a persistent keel breach beside the central room.
  // Use shared flooding rather than the retired universal hull-HP sinking pool.
  if (nextDepth > equipment.maxDepthM && def.compartments.length) {
    const index = def.compartments.reduce((nearest, room, i) => Math.abs(room.center[2]) < Math.abs(def.compartments[nearest].center[2]) ? i : nearest, 0);
    const room = def.compartments[index];
    addBreach(actor.damage.compartments[index], [0, -def.hull.draft, room.center[2]], (nextDepth - equipment.maxDepthM) * .0001 * dt, -1, .05);
  }
}
