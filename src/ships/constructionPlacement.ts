import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionSource, Vec3 } from './blueprint';
import type { ConstructionCommand } from './constructionCommands';
import { mirroredWall, wallMount } from './constructionWallFittings';

/** Requests and results of the native seat resolver (`crates/naval-sim/src/construction_placement.rs`).
 * This module only builds records and batches; every height comes from the native hull geometry. */
export interface PlacementItem {
  equipment: ConstructionEquipment;
  on?: string;
  select?: 'first' | 'last' | 'nearest';
  slide?: boolean;
  mirrorOf?: string;
  autoBearing?: boolean;
  maxTravelM?: number;
}
export interface PlacementSupport {
  kind: 'surface' | 'plating' | 'deck';
  id: string;
  primitiveId?: string;
  face?: string;
  panelId?: string;
  normal: Vec3;
  point: Vec3;
}
export interface Placement {
  id: string;
  partId: string;
  status: 'seated' | 'slid' | 'mirrored' | 'kept' | 'unsupported';
  from: Vec3;
  position: Vec3;
  bearingDeg: number;
  gapM?: number;
  residualM?: number;
  attachment: Vec3;
  direction: Vec3;
  support?: PlacementSupport;
  message?: string;
}
export interface PlaceOptions {
  partId: string;
  /** Datum X and Z in ship metres: +X starboard, −Z bow. */
  at: [number, number];
  /** Height hint: the support nearest this datum height is used instead of the outermost. */
  y?: number;
  /** Restrict supports to one hull primitive or internal deck ID. */
  on?: string;
  /** Clockwise from the bow. Wall fittings default to facing out of the nearest hull side. */
  bearingDeg?: number;
  id?: string;
  mirror?: boolean;
  repeat?: number;
  step?: [number, number];
}
export const PLACEMENT_LIMIT = 64;

const bearing = (degrees: number) => (((degrees % 360) + 360) % 360) || 0;
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** Equipment records for one `place` request, positions still provisional. */
export function placementItems(source: ConstructionSource, catalog: ConstructionCatalog, options: PlaceOptions): PlacementItem[] {
  const part = catalog.equipment.find((p) => p.id === options.partId);
  if (!part) throw new Error('Unknown catalog part ' + options.partId + '. List exact IDs with ship:catalog.');
  if (part.path) throw new Error(part.name + ' is a connected fitting drawn between points; write its path with an equipment command instead.');
  if (source.construction.version >= 2 && part.kind === 'magazine') throw new Error('Ammunition is built into each weapon in this design; do not place magazines.');
  const count = options.repeat ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > PLACEMENT_LIMIT) throw new Error('--repeat takes 1–' + PLACEMENT_LIMIT + ' copies.');
  if (count > 1 && (!options.step || !options.step.some((v) => v !== 0))) throw new Error('--repeat needs a non-zero --step dx,dz between copies.');
  if (count === 1 && options.step) throw new Error('--step applies to --repeat only.');
  if (![...options.at, options.y ?? 0, options.bearingDeg ?? 0, ...(options.step ?? [])].every(Number.isFinite)) throw new Error('Coordinates and bearing must be finite numbers.');
  const wall = wallMount(part) ? { version: 1 as const, widthM: part.size[0], heightM: part.size[1] } : undefined;
  if (wall && options.y === undefined) throw new Error(part.name + ' mounts on a hull side: give its datum height with --y. It seats along the wall normal.');
  const horizontal = !wall && part.kind !== 'propeller' && Math.abs(part.sockets?.find((s) => s.id === 'attachment')?.direction[1] ?? -1) < 0.5;
  if (horizontal && (options.y === undefined || options.bearingDeg === undefined))
    throw new Error(part.name + ' attaches sideways: give its datum height with --y and the --bearing that faces away from its support.');
  const taken = new Set([...source.construction.primitives, ...source.construction.equipment, ...source.construction.boundaries, ...source.construction.loads].map((p) => p.id));
  const base = options.id ?? part.id.slice(0, 48);
  if (!validId(base)) throw new Error('--id accepts 1–64 letters, digits, hyphens and underscores.');
  const fresh = (wanted: string) => {
    let id = wanted;
    for (let n = 2; taken.has(id); n++) id = wanted + '-' + n;
    if (!validId(id)) throw new Error('Generated ID ' + id + ' is too long; pass a shorter --id.');
    taken.add(id);
    return id;
  };
  const explicit = options.id !== undefined && count === 1;
  if (explicit && taken.has(base)) throw new Error('ID ' + base + ' already exists. Use reseat or a move command for existing equipment.');
  const items: PlacementItem[] = [];
  for (let i = 0; i < count; i++) {
    const x = options.at[0] + (options.step?.[0] ?? 0) * i, z = options.at[1] + (options.step?.[1] ?? 0) * i;
    const mirrored = !!options.mirror && Math.abs(x) > 1e-6;
    const stem = count > 1 ? base + '-' + (i + 1) : base, sides = x > 0 ? ['-starboard', '-port'] : ['-port', '-starboard'];
    const id = explicit ? (taken.add(base), base) : fresh(mirrored ? stem + sides[0] : stem);
    const twinId = mirrored ? fresh(stem + sides[1]) : undefined;
    // The requested side is seated; its twin is the exact reflection across X=0.
    const equipment: ConstructionEquipment = {
      id, partId: part.id, position: [x, options.y ?? 0, z], bearingDeg: bearing(options.bearingDeg ?? 0),
      ...(wall ? { wall: { ...wall, ...(twinId ? { mirrorId: twinId } : {}) } } : {}),
    };
    items.push({
      equipment, on: options.on,
      select: wall || horizontal || options.y !== undefined ? 'nearest' : part.placement === 'internal' ? 'last' : 'first',
      ...(wall && options.bearingDeg === undefined ? { autoBearing: true } : {}),
    });
    if (twinId) items.push({
      equipment: { ...structuredClone(equipment), id: twinId, position: [-x, options.y ?? 0, z], bearingDeg: bearing(-equipment.bearingDeg), ...(wall ? { wall: { ...mirroredWall(wall), mirrorId: id } } : {}) },
      on: options.on, mirrorOf: id,
    });
  }
  if (source.construction.equipment.length + items.length > 128) throw new Error('A design holds at most 128 equipment records; this placement needs ' + items.length + ' and ' + (128 - source.construction.equipment.length) + ' remain.');
  return items;
}

const seated = (item: PlacementItem, placement: Placement): ConstructionEquipment => ({ ...structuredClone(item.equipment), position: placement.position, bearingDeg: placement.bearingDeg });

/** New records as plain `equipment` commands; a linked wall twin follows its partner so the pair stays exact. */
export function placementCommands(items: PlacementItem[], placements: Placement[]): ConstructionCommand[] {
  return items.map((item) => {
    const placement = placements.find((p) => p.id === item.equipment.id);
    if (!placement || placement.status === 'unsupported') throw new Error('No seat was found for ' + item.equipment.id + '.');
    return { op: 'equipment', value: seated(item, placement) };
  });
}

export interface ReseatSelection { items: PlacementItem[]; skipped: { id: string; reason: string }[] }
/** Existing equipment to seat again along its attachment direction (Y for everything but wall and sideways fittings). */
export function reseatItems(source: ConstructionSource, catalog: ConstructionCatalog, ids: string[] | 'all', slide = false): ReseatSelection {
  const equipment = source.construction.equipment;
  if (ids !== 'all') {
    const unknown = ids.filter((id) => !equipment.some((e) => e.id === id));
    if (!ids.length || unknown.length) throw new Error(ids.length ? 'Unknown equipment ID ' + unknown.join(', ') + '.' : 'Provide --ids a,b,c or --all.');
    if (new Set(ids).size !== ids.length) throw new Error('Equipment IDs must not repeat.');
  }
  const chosen = ids === 'all' ? equipment : ids.map((id) => equipment.find((e) => e.id === id)!);
  const items: PlacementItem[] = [], skipped: ReseatSelection['skipped'] = [], followers = new Set<string>();
  for (const e of chosen) {
    const part: ConstructionEquipmentPart | undefined = catalog.equipment.find((p) => p.id === e.partId);
    const reason = !part ? 'unknown catalog part ' + e.partId
      : part.path || e.path ? 'connected fitting: its points are not seated by this command'
      : part.kind === 'propeller' ? 'propeller: the compiler derives its shaft support; move it explicitly'
      : followers.has(e.id) ? 'linked wall twin: follows ' + e.wall?.mirrorId
      : undefined;
    if (reason) { skipped.push({ id: e.id, reason }); continue; }
    if (e.wall?.mirrorId) followers.add(e.wall.mirrorId);
    // Same reach as the editor's wall snap: a fitting whose wall moved away is not thrown onto another wall.
    const reach = e.wall ? { maxTravelM: Math.max(0.15, Math.max(e.wall.widthM, e.wall.heightM) * 0.75) } : {};
    items.push({ equipment: structuredClone(e), select: 'nearest', ...(slide && !e.wall ? { slide: true } : {}), ...reach });
  }
  return { items, skipped };
}

/** Absolute position patches for records more than 1 mm off their seat; patching a linked wall fitting moves its twin. */
export function reseatCommands(placements: Placement[], minimumM = 1e-3): ConstructionCommand[] {
  return placements
    .filter((p) => (p.status === 'seated' || p.status === 'slid') && p.position.some((v, i) => Math.abs(v - p.from[i]) > minimumM))
    .map((p) => ({ op: 'equipment-patch', id: p.id, changes: { position: p.position } }));
}
