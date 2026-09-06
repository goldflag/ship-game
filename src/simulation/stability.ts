import { equipmentCondition, systemHealth } from './machinery';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from './damage';
import { flotation, hydrostatics, rightingArms } from './hydrostatics';
import { levelAtVolume, waterBody, type WaterBody } from './floodwater';
import { clamp, localToWorld } from './geometry';
import { availableAmmunition, type MountDefinition, type MountState } from './weapons';

export type VesselStatus = 'operational' | 'immobile' | 'disarmed' | 'disabled' | 'knocked-out' | 'sinking' | 'capsized';
export interface StabilityState {
  elapsed: number; targetY: number; rollRate: number; pitchRate: number; capsizeSeconds: number; water: WaterBody[];
  rollArm: number; pitchArm: number; displacementM3: number; reserveM3: number; status: VesselStatus; combatLost: boolean;
}
export const createStability = (): StabilityState => ({ elapsed: .5, targetY: 0, rollRate: 0, pitchRate: 0, capsizeSeconds: 0, water: [], rollArm: 0, pitchArm: 0, displacementM3: 0, reserveM3: 0, status: 'operational', combatLost: false });
const fullCache = new WeakMap<ShipDefinition, number>();
/** Read-only sea-relative waterplane shared by physics and inspection. Volume
 * queries use the full fill curve at the last 2 Hz hydrostatic orientation. */
export function waterLevel(actor: Combatant, def: ShipDefinition, i: number, volume = actor.damage.compartments[i].waterM3): number {
  const state = actor.damage.compartments[i], room = def.compartments[i];
  if (!def.stability) return localToWorld([room.center[0], room.center[1] - room.size[1] / 2 + volume / room.capacityM3 * room.size[1], room.center[2]], actor.motion)[1];
  const body = actor.damage.stability.water[i] ?? waterBody(room, state.waterM3, actor.motion.roll, actor.motion.pitch);
  return actor.motion.y + levelAtVolume(room, body, volume);
}
export function updateStability(actor: Combatant, def: ShipDefinition, dt: number): void {
  const state = actor.damage.stability, profile = def.stability;
  if (!profile || actor.damage.sunk) return;
  state.elapsed += dt;
  if (state.elapsed >= .5) {
    state.elapsed %= .5;
    state.water = def.compartments.map((c, i) => waterBody(c, actor.damage.compartments[i].waterM3, actor.motion.roll, actor.motion.pitch));
    const water = state.water.reduce((sum, w) => sum + w.volume, 0), mass = def.hull.massKg + water * 1025;
    const center = profile.dryCenterOfGravity.map((n, axis) => (n * def.hull.massKg + state.water.reduce((sum, w) => sum + w.volume * 1025 * w.center[axis], 0)) / mass) as Vec3;
    const volume = mass / (1025 * profile.buoyancyScale);
    let full = fullCache.get(def); if (full === undefined) { full = hydrostatics(def.hull, -(def.hull.length + def.hull.beam + def.hull.draft + def.hull.depth)).volume; fullCache.set(def, full); }
    state.displacementM3 = volume; state.reserveM3 = Math.max(0, full - volume);
    if (volume >= full) { actor.damage.sunk = true; actor.damage.defeatCause = 'flooding'; state.status = 'sinking'; state.combatLost = true; return; }
    if (water === 0 && actor.motion.y === 0 && actor.motion.roll === 0 && actor.motion.pitch === 0 && state.rollRate === 0 && state.pitchRate === 0) { state.targetY = 0; state.rollArm = 0; state.pitchArm = 0; return; }
    const f = flotation(def.hull, volume, actor.motion.roll, actor.motion.pitch), arms = rightingArms(f.center, center, actor.motion.roll, actor.motion.pitch);
    state.rollArm = arms.roll; state.pitchArm = arms.pitch; state.targetY = f.y;
  }
  const step = dt;
  actor.motion.y += clamp(state.targetY - actor.motion.y, -step, step);
  state.rollRate = (state.rollRate + 9.81 * state.rollArm / (def.hull.beam * .4) ** 2 * step) * Math.exp(-step / 4);
  state.pitchRate = (state.pitchRate + 9.81 * state.pitchArm / (def.hull.length * .28) ** 2 * step) * Math.exp(-step / 3);
  actor.motion.roll = clamp(actor.motion.roll + state.rollRate * step, -Math.PI, Math.PI);
  actor.motion.pitch = clamp(actor.motion.pitch + state.pitchRate * step, -Math.PI / 2, Math.PI / 2);
  // Finite-angle loss: sustained past 100 degrees with an outward/neutral arm.
  // Negative initial GM alone is deliberately insufficient (a loll equilibrium may exist).
  const inverted = Math.abs(actor.motion.roll) > 100 * Math.PI / 180 && state.rollArm * actor.motion.roll >= -.01;
  state.capsizeSeconds = inverted ? state.capsizeSeconds + step : 0;
  if (state.capsizeSeconds >= 10) { actor.damage.sunk = true; actor.damage.defeatCause = 'capsize'; state.status = 'capsized'; state.combatLost = true; }
}

export function updateCapability(actor: Combatant, def: ShipDefinition): void {
  const s = actor.damage.stability;
  const maximum = def.modules.reduce((n, m) => n + m.hp, 0) + def.mounts.length * 100;
  actor.damage.integrity = actor.damage.maxIntegrity * (maximum ? (actor.damage.modules.reduce((n, m) => n + m.hp, 0) + actor.mounts.reduce((n, m) => n + m.hp, 0)) / maximum : 1);
  if (actor.damage.sunk) { s.combatLost = true; if (s.status !== 'capsized') s.status = 'sinking'; return; }
  // Main guns and torpedoes decide fighting strength. Secondary-only custom
  // ships use their fitted guns; a surviving AA mount cannot save a battleship.
  const hasPrimary = def.mounts.some(m => m.battery === 'main') || !!def.torpedoTubes?.length;
  const guns = def.mounts.flatMap((m, i) => !hasPrimary || m.battery === 'main' ? [{ definition: m, state: actor.mounts[i] }] : []);
  const hasSalvo = ({ definition: m, state }: { definition: MountDefinition; state: MountState }) =>
    availableAmmunition(state, 'ap') >= (m.weapon.barrelCount ?? 2) || !!m.weapon.he && availableAmmunition(state, 'he') >= (m.weapon.barrelCount ?? 2);
  const loadedGuns = guns.filter(g => g.state.hp > 0 && hasSalvo(g));
  const loadedTubes = (def.torpedoTubes ?? []).filter(t => (actor.torpedoTubes?.find(s => s.id === t.id)?.ammo ?? 0) > 0);
  const usable = loadedGuns.some(({ definition: m }) => !m.magazineId || equipmentCondition(actor, def, def.modules.find(mod => mod.id === m.magazineId)!).availability > 0) ||
    loadedTubes.some(t => equipmentCondition(actor, def, def.modules.find(m => m.id === t.magazineId)!).availability > 0);
  const recoverable = loadedGuns.some(({ definition: m }) => !m.magazineId || actor.damage.modules.find(mod => mod.id === m.magazineId)!.hp > 0) ||
    loadedTubes.some(t => (actor.damage.modules.find(m => m.id === t.magazineId)?.hp ?? 0) > 0);
  const mobile = systemHealth(actor, def, 'engine') > .001;
  // Flooded supplies may recover. Permanent primary-weapon loss is a knockout
  // even while afloat, and stays final until the battle resets.
  s.combatLost ||= !recoverable;
  s.status = s.combatLost ? 'knocked-out' : usable ? (mobile ? 'operational' : 'immobile') : (mobile ? 'disarmed' : 'disabled');
  if (s.combatLost) {
    actor.damage.defeatCause ??= !guns.some(hasSalvo) && loadedTubes.length === 0 ? 'ammunition-exhausted' : 'weapons-lost';
    actor.mounts.forEach(m => m.status = 'disabled');
  }
}
