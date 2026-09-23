/** Port readings grouped the way a ship is built: armor zones, gun batteries by calibre, equipment
 * groups and flooding spaces, plus a side profile to show where each sits. Presentation only; the
 * ids are the inspection ids the 3D view isolates. */
import type { ShipDefinition, Vec3 } from './blueprint';
import { antiAircraftRange } from './armament';
import { entriesForMode, inspectionEntries, INSPECTION_EFFECTS, type InspectionEntry, type InspectionKind, type InspectionMode } from './inspection';

type Mount = ShipDefinition['mounts'][number];

const entryCache = new WeakMap<ShipDefinition, InspectionEntry[]>();
/** One inspection list per compiled definition, shared by every tab. */
export function portEntries(def: ShipDefinition): InspectionEntry[] {
  let entries = entryCache.get(def);
  if (!entries) entryCache.set(def, (entries = inspectionEntries(def)));
  return entries;
}
export const modeEntries = (def: ShipDefinition, mode: InspectionMode) => entriesForMode(portEntries(def), mode);

/** Metres aft of the stem; ship coordinates put the bow at negative z. */
export const fromBow = (def: ShipDefinition, z: number) => Math.max(0, Math.min(def.hull.length, z + def.hull.length / 2));
export const calibreLabel = (mm: number) => (mm >= 100 ? `${Number((mm / 10).toFixed(1))} cm` : `${Math.round(mm)} mm`);
const sideOf = (x: number) => (Math.abs(x) < 1 ? 'centreline' : x < 0 ? 'port' : 'starboard');

/** Gunhouse plates are authored in mount space; everything else is already in the ship frame. */
function toShip(entry: InspectionEntry, point: Vec3): Vec3 {
  if (!entry.anchor) return point;
  const bearing = ((entry.bearingDeg ?? 0) * Math.PI) / 180,
    c = Math.cos(bearing),
    s = Math.sin(bearing);
  return [entry.anchor[0] + point[0] * c - point[2] * s, entry.anchor[1] + point[1], entry.anchor[2] + point[0] * s + point[2] * c];
}
const shipCenter = (entry: InspectionEntry) => toShip(entry, entry.center);

/* ---------- gun batteries ---------- */

export type GunRole = 'Main battery' | 'Secondary' | 'Dual-purpose' | 'Light AA';
export interface GunBattery {
  id: string;
  calibreMm: number;
  label: string;
  role: GunRole;
  mountIndexes: number[];
  barrels: number;
}
/** Guns by calibre, heaviest first. The sheet no longer depends on how a design flags its batteries. */
export function gunBatteries(def: ShipDefinition): GunBattery[] {
  const byCalibre = new Map<number, number[]>();
  def.mounts.forEach((mount, index) => {
    const mm = Math.round(mount.weapon.caliberM * 1000);
    byCalibre.set(mm, [...(byCalibre.get(mm) ?? []), index]);
  });
  return [...byCalibre]
    .sort(([a], [b]) => b - a)
    .map(([mm, mountIndexes], rank) => {
      const mounts = mountIndexes.map((i) => def.mounts[i]);
      const role: GunRole =
        rank === 0 ? 'Main battery' : mm <= 40 ? 'Light AA' : mounts.some((m) => antiAircraftRange(m) > 0) ? 'Dual-purpose' : 'Secondary';
      return { id: `guns-${mm}`, calibreMm: mm, label: calibreLabel(mm), role, mountIndexes, barrels: mounts.reduce((n, m) => n + m.weapon.barrelCount, 0) };
    });
}
/** Distinct mount names where the design gave them (Anton, No. 1); otherwise lettered bow to stern for the main battery. */
export function mountLabels(def: ShipDefinition): string[] {
  const main = gunBatteries(def)[0];
  const counts = new Map<string, number>();
  def.mounts.forEach((m) => counts.set(m.name, (counts.get(m.name) ?? 0) + 1));
  const named = (m: Mount) => counts.get(m.name) === 1 && m.name !== m.weapon.name;
  const letters = new Map<number, string>();
  if (main && main.mountIndexes.some((i) => !named(def.mounts[i])))
    [...main.mountIndexes]
      .sort((a, b) => def.mounts[a].position[2] - def.mounts[b].position[2])
      .forEach((index, order) => letters.set(index, `Turret ${String.fromCharCode(65 + (order % 26))}`));
  return def.mounts.map((m, i) => (named(m) ? m.name : (letters.get(i) ?? m.name)));
}

/* ---------- armor zones ---------- */

export type ArmorZoneId =
  | 'belt'
  | 'belt-other'
  | 'deck'
  | 'deck-other'
  | 'turrets'
  | 'mounts'
  | 'barbettes'
  | 'conning'
  | 'bulkheads'
  | 'ends'
  | 'side'
  | 'backing'
  | 'plating'
  | 'fittings'
  | 'superstructure'
  | 'underwater';
const ZONES: Record<ArmorZoneId, { label: string; help: string }> = {
  belt: { label: 'Main belt', help: 'The heaviest side armor, along the waterline over machinery and magazines.' },
  'belt-other': { label: 'Upper and lower belt', help: 'Side armor of 50 mm or more above, below or beyond the main belt.' },
  deck: { label: 'Armored deck', help: 'The heaviest horizontal protection, against plunging fire and bombs.' },
  'deck-other': { label: 'Other decks', help: 'Deck plating outside the armored deck.' },
  turrets: { label: 'Main turrets', help: 'Gunhouse plates of the heaviest guns. They train with the turret.' },
  mounts: { label: 'Other gunhouses', help: 'Gunhouses and shields of every lighter gun.' },
  barbettes: { label: 'Barbettes', help: 'Fixed armored trunks under the turrets.' },
  conning: { label: 'Conning tower', help: 'The armored command position.' },
  bulkheads: { label: 'Bulkheads', help: 'Transverse, torpedo and internal bulkheads and decks.' },
  ends: { label: 'Bow, stern and bottom', help: 'Hull plating outside the sides and decks.' },
  side: { label: 'Hull side plating', help: 'Side shell thinner than 50 mm.' },
  backing: { label: 'Teak backing', help: 'Wood behind armor. It has no steel-equivalent resistance.' },
  plating: { label: 'Structural plating', help: 'Ordinary hull and deckhouse steel. It registers hits outside the armor.' },
  fittings: { label: 'Fitting shields', help: 'Plates around deck fittings and equipment.' },
  superstructure: { label: 'Superstructure', help: 'Deckhouses, towers, funnels and other blocks above the hull.' },
  underwater: { label: 'Underwater protection', help: 'Torpedo defense zones. Figures are damage reduction, not thickness.' },
};
export interface ArmorZone {
  id: ArmorZoneId;
  label: string;
  help: string;
  entryIds: string[];
  minMm: number;
  maxMm: number;
  materials: string[];
  /** Metres from the bow. */
  span: [number, number];
  /** Heaviest first; each isolates its own plates. */
  thicknesses: { mm: number; entryIds: string[] }[];
  /** Underwater zones: the best torpedo damage reduction. */
  reduction?: number;
}
interface ZoneContext {
  mainMounts: Set<number>;
  hullIds: Set<string>;
  boundaryIds: Set<string>;
  construction: boolean;
  beltMm: number;
  deckMm: number;
}
type ConstructionPart = 'hull-side' | 'hull-top' | 'hull-end' | 'boundary' | 'fitting' | 'block';
/** Built ships name plates `<primitive>:<face>…`; the compiler names fitting shields `equipment:…`. */
function constructionPart(entry: InspectionEntry, context: ZoneContext): ConstructionPart | undefined {
  if (!context.construction) return;
  const [head, face] = entry.name.split(':');
  if (head === 'equipment') return 'fitting';
  if (context.boundaryIds.has(head)) return 'boundary';
  if (context.hullIds.has(head)) return face === 'port' || face === 'starboard' ? 'hull-side' : face === 'top' ? 'hull-top' : 'hull-end';
  return 'block';
}
function zoneOf(entry: InspectionEntry, context: ZoneContext): ArmorZoneId {
  if (entry.underwaterProtection) return 'underwater';
  if (entry.surface) return 'plating';
  if (entry.mountIndex !== undefined) return context.mainMounts.has(entry.mountIndex) ? 'turrets' : 'mounts';
  if (entry.plate?.material === 'teak') return 'backing';
  const name = entry.name.toLowerCase(),
    mm = entry.thicknessMm ?? 0,
    part = constructionPart(entry, context),
    historical = !part;
  if (name.includes('conning')) return 'conning';
  if (name.includes('barbette')) return 'barbettes';
  if (part === 'fitting') return 'fittings';
  if (part === 'boundary' || (historical && /bulkhead|transverse/.test(name))) return 'bulkheads';
  if (part === 'hull-side' || (historical && name.includes('belt'))) return mm >= context.beltMm ? 'belt' : mm >= 50 ? 'belt-other' : 'side';
  if (part === 'hull-top' || (historical && /deck|turtleback/.test(name)))
    return mm >= context.deckMm || (historical && mm >= 25 && /armou?r|protective|turtleback/.test(name)) ? 'deck' : 'deck-other';
  if (part === 'hull-end' || (historical && /\bbow\b|stern|bottom|plating/.test(name))) return 'ends';
  return 'superstructure';
}
function zoneContext(def: ShipDefinition, entries: InspectionEntry[]): ZoneContext {
  const construction = def.construction;
  const context: ZoneContext = {
    mainMounts: new Set(gunBatteries(def)[0]?.mountIndexes ?? []),
    hullIds: new Set(construction?.primitives.filter((p) => p.kind === 'custom-hull').map((p) => p.id) ?? []),
    boundaryIds: new Set(construction?.boundaries.map((b) => b.id) ?? []),
    construction: !!construction,
    beltMm: Infinity,
    deckMm: Infinity,
  };
  // Name-free thresholds: the heaviest side and deck plating set what counts as belt and armored deck.
  let side = 0,
    deck = 0;
  for (const entry of entries) {
    if (entry.surface || entry.underwaterProtection || entry.mountIndex !== undefined || entry.plate?.material === 'teak') continue;
    const part = constructionPart(entry, context),
      name = entry.name.toLowerCase(),
      mm = entry.thicknessMm ?? 0;
    if (part === 'hull-side' || (!part && name.includes('belt'))) side = Math.max(side, mm);
    if (part === 'hull-top' || (!part && /deck|turtleback/.test(name))) deck = Math.max(deck, mm);
  }
  if (side >= 50) context.beltMm = Math.max(50, side * 0.8);
  if (deck >= 25) context.deckMm = Math.max(25, deck * 0.8);
  return context;
}
const zoneCache = new WeakMap<ShipDefinition, ArmorZone[]>();
/** Armor as zones, heaviest first, with underwater protection last. */
export function armorZones(def: ShipDefinition): ArmorZone[] {
  const cached = zoneCache.get(def);
  if (cached) return cached;
  const entries = modeEntries(def, 'armor'),
    context = zoneContext(def, entries);
  type Building = ArmorZone & { thick: Map<number, string[]> };
  const zones = new Map<ArmorZoneId, Building>();
  for (const entry of entries) {
    const id = zoneOf(entry, context);
    const zone: Building = zones.get(id) ?? { id, ...ZONES[id], entryIds: [], minMm: Infinity, maxMm: 0, materials: [], span: [Infinity, -Infinity], thicknesses: [], thick: new Map() };
    const mm = entry.thicknessMm ?? 0,
      [, , z] = shipCenter(entry);
    zone.entryIds.push(entry.id);
    zone.minMm = Math.min(zone.minMm, mm);
    zone.maxMm = Math.max(zone.maxMm, mm);
    zone.span = [Math.min(zone.span[0], fromBow(def, z - entry.size[2] / 2)), Math.max(zone.span[1], fromBow(def, z + entry.size[2] / 2))];
    const material = entry.plate?.material;
    if (material && !zone.materials.includes(material)) zone.materials.push(material);
    if (entry.underwaterProtection) zone.reduction = Math.max(zone.reduction ?? 0, entry.underwaterProtection.damageReduction);
    else zone.thick.set(mm, [...(zone.thick.get(mm) ?? []), entry.id]);
    zones.set(id, zone);
  }
  const result = [...zones.values()]
    .map(({ thick, ...zone }) => ({ ...zone, thicknesses: [...thick].sort(([a], [b]) => b - a).map(([mm, entryIds]) => ({ mm, entryIds })) }))
    .sort((a, b) => Number(a.id === 'underwater') - Number(b.id === 'underwater') || b.maxMm - a.maxMm || b.entryIds.length - a.entryIds.length);
  zoneCache.set(def, result);
  return result;
}

/* ---------- equipment ---------- */

export interface EquipmentItem {
  id: string;
  name: string;
  hp: number;
  /** Where it sits: metres from the bow and side. */
  where: string;
  y: number;
  z: number;
}
export interface EquipmentGroup {
  id: string;
  label: string;
  kind: Exclude<InspectionKind, 'armor' | 'compartment'>;
  help: string;
  summary: string;
  entryIds: string[];
  items: EquipmentItem[];
}
const MODULE_GROUPS: Record<string, string> = {
  magazine: 'Magazines',
  engine: 'Machinery',
  generator: 'Electrical supply',
  'fire-control': 'Fire control',
  steering: 'Steering gear',
  launcher: 'Launchers',
};
/** Built ships name magazines after their fitting (`turret-a ammunition`); say what they feed instead. */
function magazineName(def: ShipDefinition, moduleIndex: number, labels: string[]): string {
  const module = def.modules[moduleIndex];
  if (!def.construction) return module.name;
  const onDeck = module.placement === 'fixed' || !module.compartmentId;
  const fitting = module.name.replace(/ ammunition$/, '');
  const mountIndex = def.mounts.findIndex((m) => m.magazineId === module.id || m.id === fitting);
  if (mountIndex >= 0) {
    const mount = def.mounts[mountIndex],
      label = labels[mountIndex];
    if (label !== mount.name) return `${label} magazine`;
    return `${calibreLabel(Math.round(mount.weapon.caliberM * 1000))} ${onDeck ? 'ready-use locker' : 'magazine'}`;
  }
  const tube = (def.torpedoTubes ?? []).find((t) => t.magazineId === module.id);
  if (tube) return `${sideOf(tube.position[0]).replace(/^./, (c) => c.toUpperCase())} torpedo stowage`;
  return /torpedo/i.test(module.name) ? 'Torpedo stowage' : module.name;
}
/** Damageable equipment in plain groups: main battery, magazines, machinery and the rest, then lighter guns by calibre. */
export function equipmentGroups(def: ShipDefinition): EquipmentGroup[] {
  const entries = modeEntries(def, 'internals'),
    batteries = gunBatteries(def),
    labels = mountLabels(def);
  const batteryOf = new Map(batteries.flatMap((b) => b.mountIndexes.map((i) => [i, b] as const)));
  const groups = new Map<string, EquipmentGroup>();
  for (const entry of entries) {
    if (entry.kind === 'armor' || entry.kind === 'compartment') continue;
    const [x, y, z] = shipCenter(entry);
    const battery = entry.kind === 'weapon' && entry.mountIndex !== undefined ? batteryOf.get(entry.mountIndex) : undefined;
    const id = battery ? battery.id : entry.kind;
    const group =
      groups.get(id) ??
      ({
        id,
        label: battery ? (battery.role === 'Main battery' ? `${battery.label} main battery` : `${battery.label} ${battery.role === 'Light AA' ? 'light AA' : battery.role.toLowerCase()}`) : MODULE_GROUPS[entry.kind],
        kind: entry.kind,
        help: INSPECTION_EFFECTS[entry.kind],
        summary: '',
        entryIds: [],
        items: [],
      } as EquipmentGroup);
    const name =
      entry.kind === 'weapon' && entry.mountIndex !== undefined
        ? labels[entry.mountIndex]
        : entry.kind === 'magazine' && entry.moduleIndex !== undefined
          ? magazineName(def, entry.moduleIndex, labels)
          : entry.name;
    group.entryIds.push(entry.id);
    group.items.push({ id: entry.id, name, hp: Math.round(entry.hp ?? 0), where: `${Math.round(fromBow(def, z))} m from bow · ${sideOf(x)}`, y, z });
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.z - b.z);
    const n = group.items.length;
    if (group.kind === 'weapon') {
      const battery = batteries.find((b) => b.id === group.id)!;
      const lettered = group.items.map((i) => i.name).filter((name) => /^Turret [A-Z]$/.test(name));
      group.summary = `${n} ${n === 1 ? 'mount' : 'mounts'} · ${battery.barrels} ${battery.barrels === 1 ? 'barrel' : 'barrels'}${lettered.length ? ` · ${lettered.map((l) => l.slice(-1)).join(' ')}` : ''}`;
    } else if (group.kind === 'magazine') {
      const onDeck = group.entryIds.filter((id) => {
        const m = def.modules.find((module) => `module:${module.id}` === id);
        return m && (m.placement === 'fixed' || !m.compartmentId);
      }).length;
      group.summary = onDeck ? `${n - onDeck} below deck · ${onDeck} ready-use on deck` : `${n} below deck`;
    } else if (group.kind === 'fire-control') {
      const served = new Set(entries.filter((e) => group.entryIds.includes(e.id)).map((e) => e.consumers?.length ?? 0));
      group.summary = served.size === 1 ? `${n} ${n === 1 ? 'director' : 'directors'} · each directs ${[...served][0]} mounts` : `${n} directors`;
    } else if (group.kind === 'engine') {
      const roles = new Map<string, number>();
      for (const id of group.entryIds) {
        const role = def.modules.find((m) => `module:${m.id}` === id)?.role;
        if (role) roles.set(role, (roles.get(role) ?? 0) + 1);
      }
      const named = [...roles].map(([role, count]) => `${count} ${role === 'combined-drive' ? 'drive' : role}${count === 1 ? '' : 's'}`);
      group.summary = named.length ? named.join(' · ') : `${n} ${n === 1 ? 'module' : 'modules'}`;
    } else group.summary = `${n} ${n === 1 ? 'module' : 'modules'}`;
  }
  const order = (group: EquipmentGroup) =>
    group.id === batteries[0]?.id ? 0 : group.kind === 'weapon' ? 10 + batteries.findIndex((b) => b.id === group.id) : 1 + Object.keys(MODULE_GROUPS).indexOf(group.kind);
  return [...groups.values()].sort((a, b) => order(a) - order(b));
}

/* ---------- flooding ---------- */

export interface FloodingSpace {
  id: string;
  name: string;
  capacityM3: number;
  pumpM3PerMinute: number;
  /** Metres from the bow. */
  span: [number, number];
  holds: string;
  /** Spaces of under 100 m³ and 0.2 % of the ship's capacity fold into one row. */
  minor: boolean;
}
const HOLDS: Record<string, [string, string]> = {
  engine: ['machinery module', 'machinery modules'],
  magazine: ['magazine', 'magazines'],
  steering: ['steering gear', 'steering gears'],
  generator: ['generator', 'generators'],
  'fire-control': ['director', 'directors'],
  launcher: ['launcher', 'launchers'],
};
/** Watertight spaces bow to stern, with what each holds. */
export function floodingSpaces(def: ShipDefinition): FloodingSpace[] {
  const entries = modeEntries(def, 'compartments'),
    total = entries.reduce((n, e) => n + (e.capacityM3 ?? 0), 0);
  return entries
    .map((entry) => {
      const compartment = def.compartments[entry.compartmentIndex!];
      const inside = def.modules.filter((m) => m.compartmentId === compartment.id);
      const counts = new Map<string, number>();
      inside.forEach((m) => counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1));
      const holds = [...counts].map(([kind, n]) => `${n} ${HOLDS[kind][n === 1 ? 0 : 1]}`).join(', ');
      const [, , z] = entry.center;
      return {
        id: entry.id,
        name: entry.name,
        capacityM3: entry.capacityM3 ?? 0,
        pumpM3PerMinute: (entry.pumpM3PerSecond ?? 0) * 60,
        span: [fromBow(def, z - entry.size[2] / 2), fromBow(def, z + entry.size[2] / 2)] as [number, number],
        holds,
        minor: (entry.capacityM3 ?? 0) < Math.max(1, Math.min(100, total * 0.002)),
      };
    })
    .sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]);
}

/* ---------- side profile ---------- */

export interface ProfileShape {
  id: string;
  mm: number;
  /** Ship z and y pairs. */
  points: number[];
}
export interface ShipProfile {
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  shapes: ProfileShape[];
}
const profileCache = new WeakMap<ShipDefinition, ShipProfile>();
/** Every armor and plating surface projected onto the centreline plane, thinnest first. */
export function sideProfile(def: ShipDefinition): ShipProfile {
  const cached = profileCache.get(def);
  if (cached) return cached;
  const shapes: ProfileShape[] = [];
  for (const entry of modeEntries(def, 'armor')) {
    if (entry.underwaterProtection) continue;
    const mm = entry.thicknessMm ?? 0;
    if (entry.surface) {
      const vertices = entry.surface.vertices;
      for (const triangle of entry.surface.triangles)
        shapes.push({ id: entry.id, mm, points: triangle.flatMap((i) => [vertices[i][2], vertices[i][1]]) });
    } else if (entry.plate) {
      shapes.push({ id: entry.id, mm, points: entry.plate.vertices.flatMap((v) => { const p = toShip(entry, v); return [p[2], p[1]]; }) });
    } else {
      const [, y, z] = shipCenter(entry),
        bearing = ((entry.bearingDeg ?? 0) * Math.PI) / 180;
      const length = Math.abs(Math.cos(bearing)) * entry.size[2] + Math.abs(Math.sin(bearing)) * entry.size[0],
        height = entry.size[1];
      shapes.push({ id: entry.id, mm, points: [z - length / 2, y - height / 2, z + length / 2, y - height / 2, z + length / 2, y + height / 2, z - length / 2, y + height / 2] });
    }
  }
  shapes.sort((a, b) => a.mm - b.mm);
  let z0 = Infinity,
    z1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const shape of shapes)
    for (let i = 0; i < shape.points.length; i += 2) {
      z0 = Math.min(z0, shape.points[i]);
      z1 = Math.max(z1, shape.points[i]);
      y0 = Math.min(y0, shape.points[i + 1]);
      y1 = Math.max(y1, shape.points[i + 1]);
    }
  if (!shapes.length) [z0, z1, y0, y1] = [-def.hull.length / 2, def.hull.length / 2, -def.hull.draft, def.hull.depth - def.hull.draft];
  const profile = { z0, z1, y0: Math.min(y0, -def.hull.draft), y1, shapes };
  profileCache.set(def, profile);
  return profile;
}
/** Ship-frame height and length of any inspection volume, for marks on the profile. */
export function profilePoint(entry: InspectionEntry): { y: number; z: number } {
  const [, y, z] = shipCenter(entry);
  return { y, z };
}
