import { equipmentCenter } from './equipmentPose';
import { seaHeight } from './sea';
import { hullDepth } from './ship';
import { waterLevel } from './stability';
import { localToWorld } from './geometry';
import type { Module, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';

export interface EquipmentCondition { availability: number; reason: 'operational' | 'damaged' | 'destroyed' | 'flooded'; }
type MachineryLayout = { modules: Map<string, { module: Module; index: number }>; rooms: Map<string, number>; generators: Module[]; directors: Module[]; coverage?: Map<string, Module[]> };
const layouts = new WeakMap<ShipDefinition, MachineryLayout>();
function layout(def: ShipDefinition): MachineryLayout {
  let result = layouts.get(def);
  if (!result) {
    result = { modules: new Map(def.modules.map((module, index) => [module.id, { module, index }])),
      rooms: new Map(def.compartments.map((room, index) => [room.id, index])),
      generators: def.modules.filter(m => m.kind === 'generator'), directors: def.modules.filter(m => m.kind === 'fire-control') };
    if (result.directors.some(m => m.servesMountIds !== undefined)) result.coverage = new Map(def.mounts.map(m => [m.id, result!.directors.filter(d => d.servesMountIds!.includes(m.id))]));
    layouts.set(def, result);
  }
  return result;
}
export function equipmentCondition(actor: Combatant, def: ShipDefinition, module: Module | string): EquipmentCondition {
  const compiled = layout(def), entry = compiled.modules.get(typeof module === 'string' ? module : module.id)!;
  if (typeof module === 'string') module = entry.module;
  const slot = entry.index;
  const state = actor.damage.modules[slot];
  const hp = (state?.id === module.id ? state : actor.damage.modules.find(s => s.id === module.id)!).hp;
  if (hp <= 0) return { availability: 0, reason: 'destroyed' };
  if (module.immersionToleranceM !== undefined) {
    const roomIndex = module.compartmentId === undefined ? undefined : compiled.rooms.get(module.compartmentId)!;
    if (roomIndex !== undefined) {
      const room = def.compartments[roomIndex], compartment = actor.damage.compartments[roomIndex];
      const water = (compartment?.id === room.id ? compartment : actor.damage.compartments.find(c => c.id === room.id)!).waterM3;
      // Internal equipment in a dry room cannot be immersed. Avoid constructing
      // its world pose on every readiness, propulsion and repair query.
      if (water <= 0) return { availability: hp / module.hp, reason: hp < module.hp ? 'damaged' : 'operational' };
    }
    const center = equipmentCenter(actor, def, module);
    const datum = localToWorld([center[0], center[1] - module.size[1] / 2 + module.immersionToleranceM, center[2]], actor.motion);
    if (module.compartmentId === undefined) {
      const level = actor.sea ? seaHeight(actor.sea.state, datum[0], datum[2], actor.sea.time) : 0;
      if (datum[1] <= level) return { availability: 0, reason: 'flooded' };
    } else {
      if (waterLevel(actor, def, roomIndex!) >= datum[1]) return { availability: 0, reason: 'flooded' };
    }
  }
  return { availability: hp / module.hp, reason: hp < module.hp ? 'damaged' : 'operational' };
}
function electricalPower(actor: Combatant, def: ShipDefinition): number {
  const { generators }=layout(def);
  return actor.damage.sunk ? 0 : generators.length ? generators.reduce((n,m)=>n+equipmentCondition(actor,def,m).availability,0)/generators.length : 1;
}
/** Shared emergency/manual fallback is applied by consumers. Independent
 * directors provide redundancy; generators share available electrical load. */
export function supportPerformance(actor: Combatant, def: ShipDefinition): { power: number; fireControl: number } {
  const { directors } = layout(def);
  const power = electricalPower(actor,def);
  const fireControl = directors.length ? Math.max(...directors.map(m => equipmentCondition(actor, def, m).availability)) * (.35 + .65 * power) : 1;
  return { power, fireControl };
}
/** Immutable coverage topology is cached; equipment availability is always live. */
export function mountSupport(actor: Combatant, def: ShipDefinition, mountId: string, power = electricalPower(actor, def)): { power: number; fireControl: number } {
  const { coverage, directors } = layout(def), served = coverage ? coverage.get(mountId) ?? [] : directors;
  const best = served.length ? Math.max(...served.map(m => equipmentCondition(actor, def, m).availability)) : coverage ? 0 : 1;
  return { power, fireControl: !coverage && !directors.length ? 1 : best * (.35 + .65 * power) };
}
export const directorDispersion = (fireControl: number): number => (1 - fireControl) * .0015;

export function systemHealth(actor: Combatant, def: ShipDefinition, kind: 'engine' | 'steering'): number {
  if (actor.damage.sunk) return 0;
  const compiled = layout(def);
  const available = (id: string) => equipmentCondition(actor, def, compiled.modules.get(id)!.module).availability;
  if (kind === 'engine' && def.submarine) {
    const ids = hullDepth(actor.motion) > .5 ? def.submarine.submergedEngineIds : def.submarine.surfaceEngineIds;
    return ids.reduce((power, id) => power + available(id), 0) / ids.length;
  }
  if (kind === 'engine' && def.propulsion) return def.propulsion.groups.reduce((power, group) => {
    const steam = group.boilerIds.length ? group.boilerIds.reduce((n, id) => n + available(id), 0) / group.boilerIds.length : 1;
    const drive = Math.min(...group.driveIds.map(available));
    const shaft = group.shaftIds.length ? Math.min(...group.shaftIds.map(available)) : 1;
    return power + group.share * Math.min(steam, drive, shaft);
  }, 0);
  const modules = def.modules.filter(m => m.kind === kind);
  return modules.length ? modules.reduce((n, m) => n + available(m.id), 0) / modules.length : 1;
}

/** Readiness and permanent-loss evaluation share the same launcher owner. */
export function launcherAvailable(actor: Combatant, def: ShipDefinition, id?: string, recoverable = false): boolean {
  if (!id) return true;
  const module = layout(def).modules.get(id)?.module;
  if (!module) return false;
  const state = equipmentCondition(actor, def, module);
  return recoverable ? state.reason !== 'destroyed' : state.availability > 0;
}
