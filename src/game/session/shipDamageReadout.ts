import type { ShipDefinition, Vec3 } from '../../ships/blueprint';
import { equipmentCondition, systemHealth } from '../machinery';
import type { Combatant } from './elements';
import { regionReadout } from './damageReadout';

export type DamageTone = 'healthy' | 'damaged' | 'destroyed' | 'flooded' | 'fire';
export const DAMAGE_COLORS: Record<DamageTone, string> = {
  healthy: '#86e4c5', damaged: '#e8c56c', destroyed: '#f18b79', flooded: '#75c9ef', fire: '#ffad69',
};
export interface ShipDamagePart {
  /** Shared inspection geometry id, never an enemy target id. */
  id: string; name: string; location: string; kind: 'equipment' | 'compartment';
  tone: DamageTone; status: string; affected: boolean; condition?: number;
  fire: number; waterM3?: number; floodFraction?: number; breachM2?: number; crew?: string;
}
export interface ShipDamageReadout {
  propulsion: number; steering: number; parts: ShipDamagePart[];
  regions: ReturnType<typeof regionReadout>;
}

export function damageTone(condition: number, flooded: boolean, fire: number): DamageTone {
  return condition <= 0 ? 'destroyed' : fire > 0 ? 'fire' : flooded ? 'flooded' : condition < .999 ? 'damaged' : 'healthy';
}

/** Presentation only: read the owned/followed actor's current frame, without advancing damage. */
export function shipDamageReadout(actor: Combatant, def: ShipDefinition): ShipDamageReadout {
  const location = (point: Vec3) => `${point[2] < -def.hull.length * .2 ? 'Forward' : point[2] > def.hull.length * .2 ? 'Aft' : 'Amidships'} · ${point[0] < -1 ? 'Port' : point[0] > 1 ? 'Starboard' : 'Centreline'}`;
  const roomIndices = new Map(def.compartments.map((room, i) => [room.id, i]));
  const crew = (kind: 'equipment' | 'compartment' | 'mount', index: number): string | undefined => {
    if (actor.damage.sunk) return undefined;
    const jobs = actor.damage.control.teams.flatMap(job => {
      if (!job || (kind === 'equipment' ? job.kind !== 'repair-module' : kind === 'mount' ? !['repair-mount', 'fire-mount'].includes(job.kind) : !['pump', 'patch', 'fire-room', 'isolate'].includes(job.kind))) return [];
      const matches = job.kind === 'isolate' ? actor.damage.connections[job.index]?.fromIndex === index || actor.damage.connections[job.index]?.toIndex === index : job.index === index;
      if (!matches) return [];
      const label = ({ pump: 'Pumping', patch: 'Patching', 'fire-room': 'Fighting fire', 'fire-mount': 'Fighting fire', isolate: 'Closing boundary', 'repair-module': 'Repairing', 'repair-mount': 'Repairing' } as const)[job.kind];
      return [`${label}${job.setup > 0 ? ` · ready in ${Math.ceil(job.setup)}s` : ''}`];
    });
    return jobs.length ? jobs.join(' · ') : undefined;
  };
  const modules: ShipDamagePart[] = def.modules.map((module, i) => {
    const condition = actor.damage.modules[i].hp / module.hp, equipment = equipmentCondition(actor, def, module);
    const room = roomIndices.get(module.compartmentId ?? '');
    const fire = room === undefined ? 0 : actor.damage.control.rooms[room].intensity;
    const tone = damageTone(condition, equipment.reason === 'flooded', fire);
    const status = equipment.reason === 'destroyed' ? 'Destroyed' : fire > 0 ? 'On fire' : ({ operational: 'Operational', damaged: 'Damaged', flooded: 'Flooded · offline', unimmersed: 'Out of water' } as const)[equipment.reason];
    return { id: `module:${module.id}`, name: module.name, location: location(module.center), kind: 'equipment', tone, status,
      affected: equipment.reason !== 'operational' || fire > 0, condition, fire, crew: crew('equipment', i) };
  });
  const mounts: ShipDamagePart[] = def.mounts.map((mount, i) => {
    const state = actor.mounts[i], condition = state.hp / 100, fire = actor.damage.control.mounts[i].intensity;
    const disabled = state.status === 'disabled', tone = damageTone(condition, false, fire);
    return { id: `weapon:${mount.id}`, name: mount.name, location: location(mount.position), kind: 'equipment',
      tone: disabled && tone === 'healthy' ? 'damaged' : tone,
      status: condition <= 0 ? 'Destroyed' : fire > 0 ? 'On fire' : disabled ? 'Disabled' : condition < .999 ? 'Damaged' : 'Operational',
      affected: condition < .999 || fire > 0 || disabled, condition, fire, crew: crew('mount', i) };
  });
  const rooms: ShipDamagePart[] = def.compartments.map((room, i) => {
    const state = actor.damage.compartments[i], fire = actor.damage.control.rooms[i].intensity;
    const flooded = state.waterM3 > .01, breached = state.breachAreaM2 > 0;
    return { id: `compartment:${room.id}`, name: room.name, location: location(room.center), kind: 'compartment',
      tone: fire > 0 ? 'fire' : flooded ? 'flooded' : breached ? 'damaged' : 'healthy',
      status: fire > 0 ? 'On fire' : flooded ? 'Floodwater' : breached ? 'Breached · dry' : 'Dry',
      affected: flooded || breached || fire > 0, fire, waterM3: state.waterM3, floodFraction: state.waterM3 / room.capacityM3,
      breachM2: state.breachAreaM2, crew: crew('compartment', i) };
  });
  const severity: Record<DamageTone, number> = { fire: 0, flooded: 1, destroyed: 2, damaged: 3, healthy: 4 };
  return { propulsion: systemHealth(actor, def, 'engine'), steering: systemHealth(actor, def, 'steering'),
    parts: [...modules, ...mounts, ...rooms].sort((a, b) => severity[a.tone] - severity[b.tone] || a.name.localeCompare(b.name)),
    regions: regionReadout(actor, def) };
}
