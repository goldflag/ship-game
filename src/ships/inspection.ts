import type { Armor, AuthoredSurface, ShipDefinition, Vec3 } from './blueprint';
import { structuralSurfaces } from '../simulation/structure';

export type InspectionMode = 'exterior' | 'armor' | 'internals';
export type InspectionKind = 'armor' | 'engine' | 'magazine' | 'steering' | 'compartment';
export const INSPECTION_COLORS: Record<Exclude<InspectionKind, 'armor'>, string> = {
  engine: '#90bca5', magazine: '#dca48e', steering: '#b4b2db', compartment: '#9ecad1',
};
export const INSPECTION_KIND_LABELS: Record<Exclude<InspectionKind, 'armor'>, string> = {
  engine: 'Machinery', magazine: 'Magazine', steering: 'Steering gear', compartment: 'Compartment',
};
/** A fixed scale keeps equal thicknesses the same color across every ship. */
export const ARMOR_COLOR_STOPS = [
  { thicknessMm: 0, color: '#64d487' },
  { thicknessMm: 200, color: '#efd05b' },
  { thicknessMm: 400, color: '#ee615a' },
] as const;
export interface InspectionEntry {
  id: string; name: string; kind: InspectionKind; center: Vec3; size: Vec3;
  plate?: Armor['plate']; provenance?: Armor['provenance']; anchor?: Vec3;
  surface?: AuthoredSurface;
  thicknessMm?: number; capacityM3?: number; pumpM3PerSecond?: number; hp?: number;
  /** Name of the compartment housing a module. */
  within?: string;
  mountIndex?: number; moduleIndex?: number; compartmentIndex?: number; bearingDeg?: number;
}
export function armorThicknessColor(thicknessMm: number): string {
  const thickness = Math.max(0, thicknessMm);
  for (let i = 1; i < ARMOR_COLOR_STOPS.length; i++) {
    const low = ARMOR_COLOR_STOPS[i - 1], high = ARMOR_COLOR_STOPS[i];
    if (thickness > high.thicknessMm) continue;
    const fraction = (thickness - low.thicknessMm) / (high.thicknessMm - low.thicknessMm);
    return '#' + [1, 3, 5].map(offset => {
      const from = parseInt(low.color.slice(offset, offset + 2), 16), to = parseInt(high.color.slice(offset, offset + 2), 16);
      return Math.round(from + (to - from) * fraction).toString(16).padStart(2, '0');
    }).join('');
  }
  return ARMOR_COLOR_STOPS[ARMOR_COLOR_STOPS.length - 1].color;
}
export function inspectionColor(entry: InspectionEntry): string {
  if (entry.kind !== 'armor') return INSPECTION_COLORS[entry.kind];
  // Teak backing has no steel-equivalent resistance in combat.
  return entry.plate?.material === 'teak' ? '#aebabe' : armorThicknessColor(entry.thicknessMm ?? 0);
}
/** The port lists and renders the same volumes used by hit and flooding simulation. */
export function inspectionEntries(def: ShipDefinition): InspectionEntry[] {
  return [
    ...structuralSurfaces(def).map(s=>({id:`structure:${s.id}`,name:s.name,kind:'armor' as const,center:s.center,size:s.size,surface:s,thicknessMm:s.thicknessMm,
      provenance:{sourceId:'original-structure',basis:'estimated' as const,note:def.structuralPlating!.note}})),
    ...def.armor.map(a => {
      const mountIndex = def.mounts.findIndex(m => m.id === a.plate?.mountId);
      return { id: `armor:${a.id}`, name:a.name, kind:'armor' as const, center:a.center, size:a.size, thicknessMm:a.thicknessMm, plate:a.plate, provenance:a.provenance,
        ...(mountIndex >= 0 ? { mountIndex, anchor:def.mounts[mountIndex].position, bearingDeg:def.mounts[mountIndex].bearingDeg } : {}) };
    }),
    ...def.mounts.flatMap((m, mountIndex) => def.armor.some(a => a.plate?.mountId === m.id) ? [] : [{
      id: `mount:${m.id}`, name: m.name, kind: 'armor' as const, mountIndex, bearingDeg: m.bearingDeg,
      center: [m.position[0], m.position[1] + m.weapon.gunhouseSize[2] / 2, m.position[2]] as Vec3,
      size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3, thicknessMm: m.weapon.armorMm,
    }]),
    ...def.modules.map((m, moduleIndex) => ({ id: `module:${m.id}`, name: m.name, kind: m.kind, center: m.center, size: m.size, hp: m.hp, moduleIndex, within: def.compartments.find(c => c.id === m.compartmentId)?.name })),
    ...def.compartments.map((c, compartmentIndex) => ({ id: `compartment:${c.id}`, name: c.name, kind: 'compartment' as const, center: c.center, size: c.size, capacityM3: c.capacityM3, pumpM3PerSecond: c.pumpM3PerSecond, compartmentIndex })),
  ];
}
export function entriesForMode(entries: InspectionEntry[], mode: InspectionMode) {
  return entries.filter(entry => mode === 'armor' ? entry.kind === 'armor' : mode === 'internals' && entry.kind !== 'armor');
}
