import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { FireState } from './damageControl';
import { regionCondition } from './localDamage';

export interface FireReadout { id: string; name: string; intensity: number; fuelFraction: number; status: string; threat?: string; }
export function fireReadout(actor: Combatant, def: ShipDefinition): FireReadout[] {
  const control = actor.damage.control;
  const entry = (id: string, name: string, f: FireState, threat?: string): FireReadout => ({ id, name, intensity: f.intensity,
    fuelFraction: f.initialFuel ? f.fuel / f.initialFuel : 0, status: f.suppressed ? 'Being fought' : f.trend === 'growing' ? 'Growing' : f.intensity > 0 ? 'Contained' : 'Cooling', threat });
  const rooms = control.rooms.flatMap((f, i) => {
    if (f.intensity <= 0 && f.heat <= .15) return [];
    const room = def.compartments[i];
    const nearby = new Set([room.id, ...actor.damage.connections.filter(c => c.state !== 'closed' && (c.fromIndex === i || c.toIndex === i)).map(c => def.compartments[c.fromIndex === i ? c.toIndex : c.fromIndex].id)]);
    const threatened = def.modules.filter((m, index) => nearby.has(m.compartmentId) && actor.damage.modules[index].hp > 0)
      .sort((a, b) => Number(b.kind === 'magazine') - Number(a.kind === 'magazine'))[0];
    return [entry(room.id, room.name, f, f.intensity > 0 ? threatened?.name : undefined)];
  });
  return [...rooms, ...control.mounts.flatMap((f, i) => {
    if (f.intensity <= 0 && f.heat <= .15) return [];
    const mount = def.mounts[i];
    const magazine = def.modules.find(m => m.id === mount.magazineId);
    return [entry(mount.id, mount.name, f, f.intensity > 0 && actor.mounts[i].ammo > 0 ? magazine?.name : undefined)];
  })].sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
}
export function regionReadout(actor: Combatant, def: ShipDefinition) {
  return (def.localDamage?.regions ?? []).map(r => ({ id: r.id, name: r.name, condition: regionCondition(actor, r.id) }))
    .filter(r => r.condition < .999).sort((a, b) => a.condition - b.condition || a.id.localeCompare(b.id));
}
