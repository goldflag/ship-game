import type { Module, ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';

export interface EquipmentCondition { availability: number; reason: 'operational' | 'damaged' | 'destroyed' | 'flooded'; }
export function equipmentCondition(actor: Combatant, def: ShipDefinition, module: Module): EquipmentCondition {
  const hp = actor.damage.modules.find(s => s.id === module.id)!.hp;
  if (hp <= 0) return { availability: 0, reason: 'destroyed' };
  if (module.immersionToleranceM !== undefined) {
    const room = def.compartments.find(c => c.id === module.compartmentId)!;
    const water = actor.damage.compartments.find(c => c.id === room.id)!.waterM3;
    const waterHeight = room.center[1] - room.size[1] / 2 + water / room.capacityM3 * room.size[1];
    if (water > 0 && waterHeight >= module.center[1] - module.size[1] / 2 + module.immersionToleranceM) return { availability: 0, reason: 'flooded' };
  }
  return { availability: hp / module.hp, reason: hp < module.hp ? 'damaged' : 'operational' };
}
export function systemHealth(actor: Combatant, def: ShipDefinition, kind: 'engine' | 'steering'): number {
  if (actor.damage.sunk) return 0;
  const available = (id: string) => equipmentCondition(actor, def, def.modules.find(m => m.id === id)!).availability;
  if (kind === 'engine' && def.propulsion) return def.propulsion.groups.reduce((power, group) => {
    const steam = group.boilerIds.length ? group.boilerIds.reduce((n, id) => n + available(id), 0) / group.boilerIds.length : 1;
    const drive = Math.min(...group.driveIds.map(available));
    const shaft = group.shaftIds.length ? Math.min(...group.shaftIds.map(available)) : 1;
    return power + group.share * Math.min(steam, drive, shaft);
  }, 0);
  const modules = def.modules.filter(m => m.kind === kind);
  return modules.length ? modules.reduce((n, m) => n + available(m.id), 0) / modules.length : 1;
}
