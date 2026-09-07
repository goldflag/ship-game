import { waterLevel } from './stability';
import { localToWorld } from './geometry';
import type { Module, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';

export interface EquipmentCondition { availability: number; reason: 'operational' | 'damaged' | 'destroyed' | 'flooded'; }
type MachineryLayout = { modules: Map<string, { module: Module; index: number }>; rooms: Map<string, number> };
const layouts = new WeakMap<ShipDefinition, MachineryLayout>();
function layout(def: ShipDefinition): MachineryLayout {
  let result = layouts.get(def);
  if (!result) {
    result = { modules: new Map(def.modules.map((module, index) => [module.id, { module, index }])),
      rooms: new Map(def.compartments.map((room, index) => [room.id, index])) };
    layouts.set(def, result);
  }
  return result;
}
export function equipmentCondition(actor: Combatant, def: ShipDefinition, module: Module): EquipmentCondition {
  const compiled = layout(def), slot = compiled.modules.get(module.id)!.index;
  const state = actor.damage.modules[slot];
  const hp = (state?.id === module.id ? state : actor.damage.modules.find(s => s.id === module.id)!).hp;
  if (hp <= 0) return { availability: 0, reason: 'destroyed' };
  if (module.immersionToleranceM !== undefined) {
    const roomIndex = compiled.rooms.get(module.compartmentId)!, room = def.compartments[roomIndex];
    const compartment = actor.damage.compartments[roomIndex];
    const water = (compartment?.id === room.id ? compartment : actor.damage.compartments.find(c => c.id === room.id)!).waterM3;
    if (water > 0 && waterLevel(actor, def, roomIndex) >= localToWorld([module.center[0], module.center[1] - module.size[1] / 2 + module.immersionToleranceM, module.center[2]], actor.motion)[1]) return { availability: 0, reason: 'flooded' };
  }
  return { availability: hp / module.hp, reason: hp < module.hp ? 'damaged' : 'operational' };
}
export function systemHealth(actor: Combatant, def: ShipDefinition, kind: 'engine' | 'steering'): number {
  if (actor.damage.sunk) return 0;
  const compiled = layout(def);
  const available = (id: string) => equipmentCondition(actor, def, compiled.modules.get(id)!.module).availability;
  if (kind === 'engine' && def.submarine) {
    const ids = actor.motion.y < -.5 ? def.submarine.submergedEngineIds : def.submarine.surfaceEngineIds;
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
