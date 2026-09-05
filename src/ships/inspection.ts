import type { ShipDefinition, Vec3 } from './blueprint';

export type InspectionMode = 'exterior' | 'armor' | 'internals';
export type InspectionKind = 'armor' | 'engine' | 'magazine' | 'steering' | 'compartment';
export const INSPECTION_COLORS: Record<InspectionKind, string> = {
  armor: '#e5bf80', engine: '#90bca5', magazine: '#dca48e', steering: '#b4b2db', compartment: '#9ecad1',
};
export interface InspectionEntry {
  id: string; name: string; kind: InspectionKind; center: Vec3; size: Vec3;
  thicknessMm?: number; capacityM3?: number; hp?: number;
  mountIndex?: number; moduleIndex?: number; compartmentIndex?: number; bearingDeg?: number;
}
/** The port lists and renders the same volumes used by hit and flooding simulation. */
export function inspectionEntries(def: ShipDefinition): InspectionEntry[] {
  return [
    ...def.armor.map(a => ({ id: `armor:${a.id}`, name: a.name, kind: 'armor' as const, center: a.center, size: a.size, thicknessMm: a.thicknessMm })),
    ...def.mounts.map((m, mountIndex) => ({
      id: `mount:${m.id}`, name: m.name, kind: 'armor' as const, mountIndex, bearingDeg: m.bearingDeg,
      center: [m.position[0], m.position[1] + m.weapon.gunhouseSize[2] / 2, m.position[2]] as Vec3,
      size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3, thicknessMm: m.weapon.armorMm,
    })),
    ...def.modules.map((m, moduleIndex) => ({ id: `module:${m.id}`, name: m.name, kind: m.kind, center: m.center, size: m.size, hp: m.hp, moduleIndex })),
    ...def.compartments.map((c, compartmentIndex) => ({ id: `compartment:${c.id}`, name: c.name, kind: 'compartment' as const, center: c.center, size: c.size, capacityM3: c.capacityM3, compartmentIndex })),
  ];
}
export function entriesForMode(entries: InspectionEntry[], mode: InspectionMode) {
  return entries.filter(entry => mode === 'armor' ? entry.kind === 'armor' : mode === 'internals' && entry.kind !== 'armor');
}
