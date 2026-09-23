import type { Armor, AuthoredSurface, ConvexVolume, ShipDefinition, Vec3 } from './blueprint';
import { structuralSurfaces } from '../game/hullStructure';
import { inspectionArmor } from './inspectionArmor';

export type InspectionMode = 'exterior' | 'armor' | 'internals' | 'compartments';
export type InspectionKind = 'armor' | 'engine' | 'magazine' | 'steering' | 'generator' | 'fire-control' | 'weapon' | 'launcher' | 'compartment';
export const INSPECTION_COLORS: Record<Exclude<InspectionKind, 'armor'>, string> = {
  launcher: '#dca48e', weapon: '#e4c581', engine: '#90bca5', magazine: '#dca48e', steering: '#b4b2db', generator: '#dfbd83', 'fire-control': '#9ecad1', compartment: '#9ecad1',
};
export const INSPECTION_KIND_LABELS: Record<Exclude<InspectionKind, 'armor'>, string> = {
  launcher: 'Launcher', weapon: 'Gun mount', engine: 'Machinery', magazine: 'Magazine', steering: 'Steering gear', generator: 'Electrical supply', 'fire-control': 'Fire control', compartment: 'Compartment',
};
/** The port's fixed scale keeps equal thicknesses the same color across every ship; the editor passes the ship's own thickest plate as the scale instead. */
export const ARMOR_COLOR_STOPS = [
  { thicknessMm: 0, color: '#64d487' },
  { thicknessMm: 200, color: '#efd05b' },
  { thicknessMm: 400, color: '#ee615a' },
] as const;
export const ARMOR_SCALE_MM: number = ARMOR_COLOR_STOPS[ARMOR_COLOR_STOPS.length - 1].thicknessMm;
/** The thicknesses at the green and red ends of the armor colour ramp. */
export interface ArmorScale { fromMm: number; toMm: number }
export const FIXED_ARMOR_SCALE: ArmorScale = { fromMm: 0, toMm: ARMOR_SCALE_MM };
/** `center` is in the hull frame, except for gunhouse plates (`plate.mountId` set, `mountIndex` found): their `center`
 * and plate vertices are mount-local, with the origin at the mount and turned by its bearing and train (`mountFrame`).
 * `anchor` is then the mount's hull-frame position, where the viewer puts that origin; `bearingDeg` is the mount's.
 *
 * Construction ships' armor names say where a plate came from: `<primitiveId>:<face>` for hull skin (the face can
 * carry a `:<panel>` suffix), `equipment:<fittingId>:<face>:<n>` for a turret fitting's barbette, the bare
 * boundary id for a deck or bulkhead, and `<mount name> · <face>` for gunhouse plates. */
export interface InspectionEntry {
  id: string; name: string; kind: InspectionKind; center: Vec3; size: Vec3;
  underwaterProtection?: { damageReduction: number; breachReduction: number };
  plate?: Armor['plate']; provenance?: Armor['provenance']; anchor?: Vec3;
  /** Simulation plates represented by this viewer panel. */
  armorIds?: string[];
  cells?: { center: Vec3; size: Vec3 }[];
  volumes?: ConvexVolume[];
  inwardPlate?: boolean;
  surface?: AuthoredSurface;
  thicknessMm?: number; capacityM3?: number; pumpM3PerSecond?: number; hp?: number;
  /** Name of the compartment housing a module. */
  within?: string;
  /** Named consumers of a director or launcher damage owner. */
  consumers?: string[];
  mountIndex?: number; moduleIndex?: number; compartmentIndex?: number; bearingDeg?: number;
}
/** Green at the scale's start through yellow to red at its end: the port's fixed 0–400 mm, or a ship's thinnest to thickest plate so a destroyer's 20 mm reads apart from its skin. A uniform ship is all green. */
export function armorThicknessColor(thicknessMm: number, scale: ArmorScale = FIXED_ARMOR_SCALE): string {
  const span = scale.toMm - scale.fromMm;
  const thickness = span > 0 ? Math.min(1, Math.max(0, (thicknessMm - scale.fromMm) / span)) * ARMOR_SCALE_MM : 0;
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
  if (entry.underwaterProtection) return '#79aacf';
  if (entry.kind !== 'armor') return INSPECTION_COLORS[entry.kind];
  // Teak backing has no steel-equivalent resistance in combat.
  return entry.plate?.material === 'teak' ? '#aebabe' : armorThicknessColor(entry.thicknessMm ?? 0);
}
/** The port lists and renders simulation volumes, joining authored panel halves for inspection. */
export function inspectionEntries(def: ShipDefinition): InspectionEntry[] {
  return [
    ...(def.hull.volume ? [] : structuralSurfaces(def)).map(s=>({id:`structure:${s.id}`,name:s.name,kind:'armor' as const,center:s.center,size:s.size,surface:s,thicknessMm:s.thicknessMm,
      provenance:{sourceId:'original-structure',basis:'estimated' as const,note:def.structuralPlating!.note}})),
    ...(def.underwaterProtection?.zones ?? []).map(z => ({
      id: `underwater-protection:${z.id}`, name: `${z.name} · ${Math.round(z.damageReduction * 100)}% damage / ${Math.round(z.breachReduction * 100)}% breach reduction`,
      kind: 'armor' as const, center: z.center, size: z.size, underwaterProtection: { damageReduction: z.damageReduction, breachReduction: z.breachReduction },
      provenance: { sourceId: 'underwater-defense-calibration', basis: 'estimated' as const, note: def.underwaterProtection!.basis },
    })),
    ...inspectionArmor(def.armor).map(({ armor: a, ids: armorIds }) => {
      const mountIndex = def.mounts.findIndex(m => m.id === a.plate?.mountId);
      return { id: `armor:${a.id}`, name:a.name, kind:'armor' as const, center:a.center, size:a.size, thicknessMm:a.thicknessMm, plate:a.plate, provenance:a.provenance, armorIds,
        inwardPlate: !!def.construction && a.plate?.exterior === true,
        ...(mountIndex >= 0 ? { mountIndex, anchor:def.mounts[mountIndex].position, bearingDeg:def.mounts[mountIndex].bearingDeg } : {}) };
    }),
    ...def.mounts.flatMap((m, mountIndex) => def.armor.some(a => a.plate?.mountId === m.id) ? [] : [{
      id: `mount:${m.id}`, name: m.name, kind: 'armor' as const, mountIndex, bearingDeg: m.bearingDeg,
      center: [m.position[0], m.position[1] + m.weapon.gunhouseSize[2] / 2, m.position[2]] as Vec3,
      size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3, thicknessMm: m.weapon.armorMm,
    }]),
    ...def.mounts.map((m, mountIndex) => ({
      id: `weapon:${m.id}`, name: m.name, kind: 'weapon' as const, hp: 100, mountIndex, bearingDeg: m.bearingDeg,
      center: [m.position[0], m.position[1] + m.weapon.gunhouseSize[2] / 2, m.position[2]] as Vec3,
      size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3,
    })),
    ...def.modules.map((m, moduleIndex) => ({ id: `module:${m.id}`, name: m.name, kind: m.kind, center: m.center, size: m.size, hp: m.hp, moduleIndex, consumers: m.kind === 'fire-control' ? def.mounts.filter(mount => m.servesMountIds === undefined || m.servesMountIds.includes(mount.id)).map(mount=>mount.name) : m.kind === 'launcher' ? [...(def.torpedoTubes ?? []),...(def.depthChargeLaunchers ?? [])].filter(l=>l.launcherModuleId===m.id).map(l=>l.name) : undefined, within: def.compartments.find(c => c.id === m.compartmentId)?.name })),
    ...def.compartments.map((c, compartmentIndex) => ({ id: `compartment:${c.id}`, name: c.name, kind: 'compartment' as const, center: c.center, size: c.size, cells: c.cells, volumes: c.volumes, capacityM3: c.capacityM3, pumpM3PerSecond: c.pumpM3PerSecond, compartmentIndex })),
  ];
}
export function entriesForMode(entries: InspectionEntry[], mode: InspectionMode) {
  return entries.filter(entry => entryInMode(entry, mode));
}

export function entryInMode(entry: InspectionEntry, mode: InspectionMode): boolean {
  if (mode === 'armor') return entry.kind === 'armor';
  if (mode === 'compartments') return entry.kind === 'compartment';
  return mode === 'internals' && entry.kind !== 'armor' && entry.kind !== 'compartment';
}
export const INSPECTION_EFFECTS: Record<Exclude<InspectionKind, 'armor'>, string> = {
  launcher: 'Destruction disables connected weapons. Surviving equipment can be repaired or recover after flooding recedes.',
  engine: 'Damage reduces propulsion power.', steering: 'Damage reduces rudder authority.',
  magazine: 'Loss disables connected weapons. Fire can ignite ammunition and open the hull.',
  generator: 'Damage reduces electrical supply to pumps, gun mechanisms and fire control.',
  'fire-control': 'Damage reduces accuracy for the guns served by this director. Guns retain local control.',
  weapon: 'Can be damaged or destroyed. Disabled guns stop aiming and firing.',
  compartment: 'Breaches admit water; flooding changes list, trim and buoyancy.',
};
