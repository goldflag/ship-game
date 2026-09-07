import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { FireState } from './damageControl';
import { regionCondition } from './localDamage';

export interface FireReadout { id: string; name: string; intensity: number; fuelFraction: number; status: string; threat?: string; crew: string; location: string; setupSeconds: number; }
export function fireReadout(actor: Combatant, def: ShipDefinition): FireReadout[] {
  const control = actor.damage.control;
  const entry = (id: string, name: string, f: FireState, kind: 'fire-room' | 'fire-mount', index: number, threat?: string): FireReadout => {
    const team = actor.damage.sunk ? undefined : control.teams.find(job => job?.kind === kind && job.index === index);
    const setupSeconds = team?.setup ?? 0;
    const point: Vec3 = kind === 'fire-room' ? def.compartments[index].center : def.mounts[index].position;
    const location = `${point[2] < -def.hull.length * .2 ? 'Forward' : point[2] > def.hull.length * .2 ? 'Aft' : 'Amidships'} · ${point[0] < -1 ? 'Port' : point[0] > 1 ? 'Starboard' : 'Centreline'}`;
    return { id, name, intensity: f.intensity, fuelFraction: f.initialFuel ? f.fuel / f.initialFuel : 0,
      status: f.intensity <= 0 ? f.fuel <= 0 ? 'Burned out · cooling' : 'Cooling' : f.suppressed ? 'Being fought' : f.trend === 'growing' ? 'Growing' : 'Steady',
      crew: actor.damage.sunk ? 'Crews unavailable' : !team ? 'Awaiting crew' : setupSeconds > 0 ? 'Crew deploying' : f.intensity > 0 ? 'Suppressing fire' : 'Cooling space',
      location, setupSeconds, threat };
  };
  const rooms = control.rooms.flatMap((f, i) => {
    if (f.intensity <= 0 && f.heat <= .15) return [];
    const room = def.compartments[i];
    const nearby = new Set([room.id, ...actor.damage.connections.filter(c => c.state !== 'closed' && (c.fromIndex === i || c.toIndex === i)).map(c => def.compartments[c.fromIndex === i ? c.toIndex : c.fromIndex].id)]);
    const threatened = def.modules.filter((m, index) => m.compartmentId !== undefined && nearby.has(m.compartmentId) && actor.damage.modules[index].hp > 0)
      .sort((a, b) => Number(b.kind === 'magazine') - Number(a.kind === 'magazine'))[0];
    return [entry(room.id, room.name, f, 'fire-room', i, f.intensity > 0 ? threatened?.name : undefined)];
  });
  return [...rooms, ...control.mounts.flatMap((f, i) => {
    if (f.intensity <= 0 && f.heat <= .15) return [];
    const mount = def.mounts[i];
    const magazine = def.modules.find(m => m.id === mount.magazineId);
    return [entry(mount.id, mount.name, f, 'fire-mount', i, f.intensity > 0 ? [actor.mounts[i].hp > 0 ? mount.name : undefined, actor.mounts[i].ammo > 0 ? magazine?.name : undefined].filter(Boolean).join(' · ') || undefined : undefined)];
  })].sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id));
}
export function regionReadout(actor: Combatant, def: ShipDefinition) {
  return (def.localDamage?.regions ?? []).map(r => ({ id: r.id, name: r.name, condition: regionCondition(actor, r.id) }))
    .filter(r => r.condition < .999).sort((a, b) => a.condition - b.condition || a.id.localeCompare(b.id));
}
