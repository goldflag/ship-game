import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionSource, Vec3 } from './blueprint';
import { CUSTOM_FITTING_LIMITS, customFittingDefinitions, customFittingFault, customFittingOf, effectiveConstructionCatalog, equipmentCounts, isCustomFittingPartId } from './constructionCustomFittings';
import type { ConstructionCommand } from './constructionCommands';
import { CONSTRUCTION_LIMITS } from './constructionEditor';
import { mirroredWall, wallMount } from './constructionWallFittings';
import { CENTERLINE_M, MAX_PARENT_DEPTH, carriedIds, carrierOf, mayCarry, mayFloat, mayRideTrainable, parentChain, trains } from './constructionParents';

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
  /** A hull piece or equipment row the new records ride on (`parent`). Seating is unchanged: the seat is still
   * the hull support under (x,z). Only equipment that may float takes a parent. */
  parent?: string;
}
/** Copies one `place` request may seat. The design's own equipment and custom-fitting
 * budgets still apply, so a long run is refused by the budget, not by this cap. */
export const PLACEMENT_LIMIT = 1_000;

const bearing = (degrees: number) => (((degrees % 360) + 360) % 360) || 0;
const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** Equipment records for one `place` request, positions still provisional. */
export function placementItems(source: ConstructionSource, catalog: ConstructionCatalog, options: PlaceOptions): PlacementItem[] {
  catalog = effectiveConstructionCatalog(source.construction, catalog);
  const part = catalog.equipment.find((p) => p.id === options.partId);
  const definition = customFittingOf(source.construction, options);
  if (!part && definition) throw new Error('Custom fitting ' + definition.id + ' ' + customFittingFault(definition) + '.');
  if (!part)
    throw new Error(
      isCustomFittingPartId(options.partId)
        ? 'Unknown custom fitting ' + options.partId + '. Define it with a `fitting` command; ship:summary lists this design’s definitions.'
        : 'Unknown catalog part ' + options.partId + '. List exact IDs with ship:catalog.',
    );
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
  const taken = new Set([...source.construction.primitives, ...source.construction.equipment, ...source.construction.boundaries, ...source.construction.loads, ...customFittingDefinitions(source.construction)].map((p) => p.id));
  // A design-local part ID is `design:<definition id>`; the colon is not valid in a source ID.
  const base = options.id ?? part.id.replace(/^design:/, '').slice(0, 48);
  if (!validId(base)) throw new Error('--id accepts 1–64 letters, digits, hyphens and underscores.');
  const fresh = (wanted: string) => {
    let id = wanted;
    for (let n = 2; taken.has(id); n++) id = wanted + '-' + n;
    if (!validId(id)) throw new Error('Generated ID ' + id + ' is too long; pass a shorter --id.');
    taken.add(id);
    return id;
  };
  const parentAt = options.parent === undefined ? undefined : placementParent(source, catalog, part, options.parent);
  if (parentAt && options.mirror && Math.abs(parentAt[0]) > CENTERLINE_M && Math.abs(options.at[0]) > 1e-6)
    throw new Error('--mirror would give the twin a parent on the other side; place each side with its own --parent.');
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
      ...(options.parent === undefined ? {} : { parent: options.parent }),
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
  // Catalog rows and design-local fitting instances have separate budgets, as in the compiler.
  const now = equipmentCounts(source.construction), more = equipmentCounts({ equipment: items.map((item) => item.equipment) });
  for (const [count, added, limit, noun] of [
    [now.catalog, more.catalog, CONSTRUCTION_LIMITS.equipment, 'equipment records'],
    [now.custom, more.custom, CUSTOM_FITTING_LIMITS.instances, 'custom fitting instances'],
  ] as const)
    if (added > 0 && count + added > limit)
      throw new Error('A design holds at most ' + limit.toLocaleString('en-US') + ' ' + noun + '; this placement needs ' + added + ' and ' + (limit - count) + ' remain.');
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

export { mayFloat };

/** The datum of a requested parent, after checking the relationship the compiler will check. */
function placementParent(source: ConstructionSource, catalog: ConstructionCatalog, part: ConstructionEquipmentPart, id: string): Vec3 {
  const data = source.construction;
  const row = data.equipment.find((e) => e.id === id),
    piece = data.primitives.find((p) => p.id === id);
  if (!row && !piece) throw new Error('Unknown parent ' + id + '. A parent is a hull piece or an equipment ID (ship:summary lists them).');
  if (!mayFloat(source, catalog, { id: '', partId: part.id, position: [0, 0, 0], bearingDeg: 0 }, part))
    throw new Error(part.name + ' needs hull support, so it cannot ride a parent; only equipment that may float (deck fittings, masts, light deck-mounted guns without a well) takes one.');
  if (row) {
    const parentPart = catalog.equipment.find((p) => p.id === row.partId);
    if (!mayCarry(row, parentPart))
      throw new Error(
        parentPart?.kind === 'torpedo-launcher'
          ? id + ' is a trainable torpedo launcher; equipment cannot ride a launcher yet.'
          : id + ' cannot carry equipment; parents are hull pieces, guns, masts, funnels, directors and deck fittings.',
      );
    const carrier = trains(parentPart) ? id : carrierOf(data, catalog, id);
    if (carrier !== undefined && !mayRideTrainable(source, catalog, { id: '', partId: part.id, position: [0, 0, 0], bearingDeg: 0 }, part))
      throw new Error(part.name + ' cannot ride the trainable gun ' + carrier + '; only deck fittings and light deck guns train with a gun.');
    if (parentChain(data, id).length >= MAX_PARENT_DEPTH) throw new Error(id + ' already rides ' + MAX_PARENT_DEPTH + ' parents deep; attach closer to the hull.');
  }
  return (row ?? piece)!.position;
}

export interface ReseatSelection {
  items: PlacementItem[];
  skipped: { id: string; reason: string }[];
  /** Under `all`: records allowed to float. They are lifted out of a support but left where they float above one. */
  floating: string[];
}
/** Existing equipment to seat again along its attachment direction (Y for everything but wall and sideways fittings). */
export function reseatItems(source: ConstructionSource, catalog: ConstructionCatalog, ids: string[] | 'all', slide = false): ReseatSelection {
  catalog = effectiveConstructionCatalog(source.construction, catalog);
  const equipment = source.construction.equipment;
  if (ids !== 'all') {
    const unknown = ids.filter((id) => !equipment.some((e) => e.id === id));
    if (!ids.length || unknown.length) throw new Error(ids.length ? 'Unknown equipment ID ' + unknown.join(', ') + '.' : 'Provide --ids a,b,c or --all.');
    if (new Set(ids).size !== ids.length) throw new Error('Equipment IDs must not repeat.');
  }
  const chosen = ids === 'all' ? equipment : ids.map((id) => equipment.find((e) => e.id === id)!);
  const items: PlacementItem[] = [], skipped: ReseatSelection['skipped'] = [], floating: string[] = [], followers = new Set<string>();
  for (const e of chosen) {
    const part: ConstructionEquipmentPart | undefined = catalog.equipment.find((p) => p.id === e.partId);
    const reason = !part ? 'unknown catalog part ' + e.partId
      : part.path || e.path ? 'connected fitting: its points are not seated by this command'
      : part.kind === 'propeller' ? 'propeller: its height is valid where it is; the compiler derives the shaft support, so move it explicitly to change it'
      : followers.has(e.id) ? 'linked wall twin: follows ' + e.wall?.mirrorId
      : ids === 'all' && e.parent !== undefined ? 'rides its parent ' + e.parent + ', which carries it; name it with --ids to seat it'
      : undefined;
    if (reason) { skipped.push({ id: e.id, reason }); continue; }
    if (e.wall?.mirrorId) followers.add(e.wall.mirrorId);
    const floats = ids === 'all' && mayFloat(source, catalog, e, part!);
    if (floats) floating.push(e.id);
    // Same reach as the editor's wall snap: a fitting whose wall moved away is not thrown onto another wall.
    const reach = e.wall ? { maxTravelM: Math.max(0.15, Math.max(e.wall.widthM, e.wall.heightM) * 0.75) } : {};
    items.push({ equipment: structuredClone(e), select: 'nearest', ...(slide && !e.wall && !floats ? { slide: true } : {}), ...reach });
  }
  return { items, skipped, floating };
}

/** Records that may float and stand above their nearest support: `reseat --all` leaves them where they are. */
export function floatingAbove(placements: Placement[], floating: readonly string[]): Set<string> {
  const allowed = new Set(floating);
  return new Set(placements.filter((p) => allowed.has(p.id) && (p.gapM ?? 0) > 0).map((p) => p.id));
}

/** Absolute position patches for records more than 1 mm off their seat; patching a linked wall fitting moves its twin.
 * With the source, what a reseated record carries (`parent`) moves by the same delta, unless it was reseated itself. */
export function reseatCommands(placements: Placement[], minimumM = 1e-3, source?: ConstructionSource): ConstructionCommand[] {
  const moved = placements.filter((p) => (p.status === 'seated' || p.status === 'slid') && p.position.some((v, i) => Math.abs(v - p.from[i]) > minimumM));
  const commands: ConstructionCommand[] = moved.map((p) => ({ op: 'equipment-patch', id: p.id, changes: { position: p.position } }));
  if (!source) return commands;
  const own = new Set(moved.map((p) => p.id));
  for (const p of moved) {
    const riders = [...carriedIds(source.construction, [p.id])].filter((id) => !own.has(id));
    if (riders.length) commands.push({ op: 'move', ids: riders, delta: p.position.map((v, i) => v - p.from[i]) as Vec3 });
  }
  return commands;
}
