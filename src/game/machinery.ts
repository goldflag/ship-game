import { equipmentCenter } from './equipmentPose';
import { seaHeight } from './session/seaSurface';
import { hullDepth } from './session/motion';
import { localToWorld } from './geometry';
import type { Module, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './session/elements';
import { waterLevel } from './floodwater';

export interface EquipmentCondition { availability: number; reason: 'operational' | 'damaged' | 'destroyed' | 'flooded' | 'unimmersed'; }
type MachineryLayout = { modules: Map<string, { module: Module; index: number }>; rooms: Map<string, number>; generators: Module[]; directors: Module[]; coverage?: Map<string, Module[]> };
const layouts = new WeakMap<ShipDefinition, MachineryLayout>();
function layout(def: ShipDefinition): MachineryLayout {
  let result = layouts.get(def);
  if (!result) {
    result = { modules: new Map(def.modules.map((module, index) => [module.id, { module, index }])),
      rooms: new Map(def.compartments.map((room, index) => [room.id, index])),
      generators: def.modules.filter(m => m.kind === 'generator'), directors: def.modules.filter(m => m.kind === 'fire-control') };
    result.coverage = new Map(def.mounts.map(m => [m.id, result!.directors.filter(d => d.servesMountIds!.includes(m.id))]));
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
  let immersion = 1;
  if ((def.hull.volume || def.maneuvering) && (module.role === 'shaft' || module.kind === 'steering')) {
    const bottom = localToWorld([module.center[0], module.center[1] - module.size[1] / 2, module.center[2]], actor.motion);
    const top = localToWorld([module.center[0], module.center[1] + module.size[1] / 2, module.center[2]], actor.motion);
    const surface = actor.sea ? seaHeight(actor.sea.state, top[0], top[2], actor.sea.time) : 0;
    immersion = Math.max(0, Math.min(1, (surface - Math.min(bottom[1], top[1])) / Math.max(1e-6, Math.abs(top[1] - bottom[1]))));
    if (!immersion) return { availability: 0, reason: 'unimmersed' };
  }
  if (def.hull.volume && module.role === 'boiler') {
    const top = localToWorld([module.center[0], module.center[1] + module.size[1] / 2, module.center[2]], actor.motion);
    const surface = actor.sea ? seaHeight(actor.sea.state, top[0], top[2], actor.sea.time) : 0;
    if (top[1] <= surface) return { availability: 0, reason: 'flooded' };
  }
  if (module.immersionToleranceM !== undefined) {
    const roomIndex = module.compartmentId === undefined ? undefined : compiled.rooms.get(module.compartmentId)!;
    if (roomIndex !== undefined) {
      const room = def.compartments[roomIndex], compartment = actor.damage.compartments[roomIndex];
      const water = (compartment?.id === room.id ? compartment : actor.damage.compartments.find(c => c.id === room.id)!).waterM3;
      // Internal equipment in a dry room cannot be immersed. Avoid constructing
      // its world pose on every readiness, propulsion and repair query.
      if (water <= 0) return { availability: hp / module.hp * immersion, reason: hp < module.hp ? 'damaged' : 'operational' };
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
  return { availability: hp / module.hp * immersion, reason: hp < module.hp ? 'damaged' : 'operational' };
}
const AUXILIARY_POWER_SHARE = .02;
function exhaustFraction(capacity: number, demand: number): number {
  return demand > 0 ? Math.max(0, Math.min(1, capacity / demand)) : 0;
}
/** Presentation of the same shared allocation used by native machinery. */
function sharedExhaustFraction(actor: Combatant, def: ShipDefinition): number {
  const pool = def.propulsion!.sharedExhaust!;
  const live = (ratings: typeof pool.engines) => ratings.reduce((sum, r) => sum + r.kw * equipmentCondition(actor, def, r.id).availability, 0);
  return exhaustFraction(live(pool.funnels), live(pool.engines));
}
function electricalPower(actor: Combatant, def: ShipDefinition): number {
  const pool = def.propulsion?.sharedExhaust;
  if (pool) {
    if (actor.damage.sunk) return 0;
    let total = 0, live = 0;
    const service = Math.min(1, sharedExhaustFraction(actor, def) / AUXILIARY_POWER_SHARE);
    for (const engine of pool.engines.filter(e => e.kw > 0)) {
      const mass = def.loading?.contributions.find(c => c.id === engine.id && c.kind === 'equipment')?.massKg ?? 0;
      const weight = Math.max(0, Math.min(1, mass / 35000));
      total += weight;
      live += weight * equipmentCondition(actor, def, engine.id).availability * service;
    }
    return total > 0 ? live / total : 0;
  }
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
  if (kind === 'engine' && def.propulsion?.sharedExhaust) {
    const pool = def.propulsion.sharedExhaust;
    const baseline = Math.max(0, exhaustFraction(pool.funnels.reduce((n, f) => n + f.kw, 0), pool.engines.reduce((n, e) => n + e.kw, 0)) - AUXILIARY_POWER_SHARE);
    if (!baseline) return 0;
    const supply = Math.max(0, sharedExhaustFraction(actor, def) - AUXILIARY_POWER_SHARE);
    const power = def.propulsion.groups.reduce((sum, g) => sum + g.share * Math.min(1, ...g.driveIds.map(available)) * (g.shaftIds.length ? g.shaftIds.reduce((n, id) => n + available(id), 0) / g.shaftIds.length : 1) * supply / baseline, 0);
    return Math.max(0, Math.min(1, power));
  }
  if (kind === 'engine' && def.propulsion) return def.propulsion.groups.reduce((power, group) => {
    const steam = group.boilerIds.length ? group.boilerIds.reduce((n, id) => n + available(id), 0) / group.boilerIds.length : 1;
    const drive = Math.min(...group.driveIds.map(available));
    const shaft = group.shaftIds.length ? group.shaftIds.reduce((n, id) => n + available(id), 0) / group.shaftIds.length : 1;
    return power + group.share * Math.min(steam, drive) * shaft;
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

/** Fraction of the hull's equipment hit points still standing. */
export function equipmentIntegrity(actor: Combatant, def: ShipDefinition): number {
  const maximum = def.modules.reduce((n, m) => n + m.hp, 0) + def.mounts.length * 100;
  return maximum ? (actor.damage.modules.reduce((n, m) => n + m.hp, 0) + actor.mounts.reduce((n, m) => n + m.hp, 0)) / maximum : 1;
}
