import type { ShipDefinition } from '../ships/blueprint';
import { launcherAvailable, equipmentCondition, systemHealth } from '../game/machinery';
import { availableAmmunition } from './weapons';
import type { Combatant } from '../game/session/elements';
import { waterLevel, type WaterBody } from '../game/floodwater';
export { waterLevel } from '../game/floodwater';
import { localToWorld } from '../game/geometry';

export type { VesselStatus } from '../game/session/elements';
import type { VesselStatus } from '../game/session/elements';
export interface StabilityState {
  sampleRoll?: number; samplePitch?: number; rollSlope?: number; pitchSlope?: number;
  elapsed: number; targetY: number; rollRate: number; pitchRate: number; capsizeSeconds: number; water: WaterBody[];
  rollArm: number; pitchArm: number; displacementM3: number; reserveM3: number; status: VesselStatus;
  /** Legacy permanent weapon-capability flag. Never use this as an afloat/result predicate. */
  combatLost: boolean;
}
export const createStability = (): StabilityState => ({ elapsed: .5, targetY: 0, rollRate: 0, pitchRate: 0, capsizeSeconds: 0, water: [], rollArm: 0, pitchArm: 0, displacementM3: 0, reserveM3: 0, status: 'operational', combatLost: false });
export function updateCapability(actor: Combatant, def: ShipDefinition): void {
  const s = actor.damage.stability;
  if (actor.damage.sunk || actor.damage.integrity <= 0) {
    if (!actor.damage.sunk) actor.damage.defeatCause = 'hull-failure';
    s.combatLost = true; if (s.status !== 'capsized') s.status = 'sinking';
    actor.mounts.forEach(m => m.status = 'disabled');
    return;
  }
  // Every surviving weapon counts, including secondaries after main-gun loss.
  const loadedTubes = (def.torpedoTubes ?? []).filter(t => (actor.torpedoTubes?.find(s => s.id === t.id)?.ammo ?? 0) > 0);
  const loadedCharges = (def.depthChargeLaunchers ?? []).filter(l => (actor.depthChargeLaunchers?.find(s => s.id === l.id)?.ammo ?? 0) > 0);
  // Assess ship-attack capability independently from physical survival.
  const armedFlight = !!actor.airWing?.planes.some(p => ['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(p.phase) && p.payload);
  const strikeReserves = !!actor.airWing?.planes.some(p => p.phase !== 'lost' && p.role !== 'fighter');
  const service = def.airWing && def.modules.find(m => m.id === def.airWing!.serviceModuleId);
  const airRecoverable = armedFlight || strikeReserves && (actor.damage.modules.find(m => m.id === service?.id)?.hp ?? 0) > 0;
  const airUsable = armedFlight || strikeReserves && !!service && equipmentCondition(actor, def, service).availability > 0;
  let gunUsable = false, gunRecoverable = false, gunAmmunition = false;
  // Scan live mounts directly: no per-tick array of wrapper objects, and each
  // magazine's condition also supplies the immediate individual failure status.
  for (let i = 0; i < def.mounts.length; i++) {
    const m = def.mounts[i], state = actor.mounts[i], barrels = m.weapon.barrelCount;
    const salvo = availableAmmunition(state, 'ap') >= barrels || !!m.weapon.he && availableAmmunition(state, 'he') >= barrels;
    gunAmmunition ||= salvo;
    const supply = m.magazineId ? equipmentCondition(actor, def, m.magazineId) : undefined;
    if (state.hp <= 0 || supply?.availability === 0) state.status = 'disabled';
    if (state.hp > 0 && salvo) {
      gunUsable ||= !supply || supply.availability > 0;
      gunRecoverable ||= !m.magazineId || actor.damage.modules.find(mod => mod.id === m.magazineId)!.hp > 0;
    }
  }
  const usable = airUsable || gunUsable ||
    [...loadedTubes, ...loadedCharges].some(t => launcherAvailable(actor, def, t.launcherModuleId) && equipmentCondition(actor, def, t.magazineId).availability > 0);
  const recoverable = airRecoverable || gunRecoverable ||
    [...loadedTubes, ...loadedCharges].some(t => launcherAvailable(actor, def, t.launcherModuleId, true) && (actor.damage.modules.find(m => m.id === t.magazineId)?.hp ?? 0) > 0);
  const mobile = systemHealth(actor, def, 'engine') > .001;
  // Flooded supplies may recover. Permanent weapon loss disables firing,
  // while battleRules.physicalLoss independently owns survival and scoring.
  s.combatLost ||= !recoverable;
  s.status = usable ? (mobile ? 'operational' : 'immobile') : (mobile ? 'disarmed' : 'disabled');
  if (s.combatLost) {
    actor.damage.defeatCause ??= !gunAmmunition && loadedTubes.length === 0 && loadedCharges.length === 0 ? 'ammunition-exhausted' : 'weapons-lost';
  }
  // Hits resolve after gun training. Publish individual failures immediately so
  // the HUD and renderer do not spend another tick treating them as turning.
  if (s.combatLost) actor.mounts.forEach(state => state.status = 'disabled');
}
