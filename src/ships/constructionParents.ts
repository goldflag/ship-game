import type {
  ConstructionCatalog,
  ConstructionData,
  ConstructionEquipment,
  ConstructionEquipmentPart,
  ConstructionSource,
  Vec3,
} from './blueprint';
import { isCustomFittingPartId } from './constructionCustomFittings';

/** Equipment parents. An equipment row may name a hull piece or another equipment row as its `parent`; moving,
 * turning, copying, mirroring and removing the parent carries it. The row keeps its own absolute position and
 * bearing (at the neutral pose). The compiler checks it (`construction_parents.rs`, code `equipment-parent`):
 * parents are hull pieces, deck fittings, masts, funnels, directors and guns, only equipment that may float
 * takes a parent, and a chain is at most `MAX_PARENT_DEPTH` links long. A row with a gun up its chain trains
 * with the nearest one, its carrier (`carrierOf`): only deck fittings and light deck guns without a raised
 * barbette may (`mayRideTrainable`). Under fixed parents nothing physical reads the link. */
export const MAX_PARENT_DEPTH = 8;
/** A parent this close to X=0 counts as on the centreline when a mirrored copy decides whether to keep it. */
export const CENTERLINE_M = 1e-6;

type Rows = Pick<ConstructionData, 'equipment'>;

/** Mirrors `floats` in `crates/naval-sim/src/construction.rs`: non-structural deck equipment needs no hull
 * under it (deck fittings, masts, light deck-mounted guns without a well); wall and path fittings do.
 * Exactly the equipment that may take a parent. */
export function mayFloat(
  source: ConstructionSource,
  catalog: ConstructionCatalog,
  e: ConstructionEquipment,
  part: ConstructionEquipmentPart,
): boolean {
  if (part.placement !== 'deck' || e.wall || part.wallMount || part.path) return false;
  if (part.kind === 'deck-fitting' || part.kind === 'mast') return true;
  return (
    source.construction.version >= 2 &&
    part.kind === 'gun' &&
    (part.occupancy ? part.occupancy.length === 0 : catalog.weapons.parts.some((w) => w.id === part.gunPartId && w.caliberM < 0.1))
  );
}

/** Whether this row may carry equipment: guns, deck fittings, masts, funnels and directors that are neither
 * wall nor path fittings. A torpedo launcher cannot carry equipment yet. */
export function mayCarry(item: ConstructionEquipment, part: ConstructionEquipmentPart | undefined): boolean {
  if (item.wall || item.path) return false;
  if (isCustomFittingPartId(item.partId)) return true;
  return (
    !!part &&
    part.placement === 'deck' &&
    !part.path &&
    !part.wallMount &&
    (part.kind === 'gun' || part.kind === 'deck-fitting' || part.kind === 'mast' || part.kind === 'funnel' || part.kind === 'director')
  );
}

/** Whether a row trains, carrying its riders with it: a gun. */
export const trains = (part: ConstructionEquipmentPart | undefined): boolean => part?.kind === 'gun';

/** Whether this row may ride a trainable gun: deck fittings (catalog and design-local) and light deck guns
 * without a raised barbette. A mast would leave its fixed gun-arc obstruction behind, a barbette its hull
 * material. Mirrors `ride_fault` in `construction_parents.rs`. */
export function mayRideTrainable(
  source: ConstructionSource,
  catalog: ConstructionCatalog,
  item: ConstructionEquipment,
  part: ConstructionEquipmentPart | undefined,
): boolean {
  if (item.wall || item.path) return false;
  if (isCustomFittingPartId(item.partId)) return true;
  if (!part || !mayFloat(source, catalog, item, part)) return false;
  return part.kind === 'deck-fitting' || (part.kind === 'gun' && !(item.gun?.barbetteHeightM ?? 0));
}

/** The nearest trainable gun up this row's parent chain, which the row trains with; none under fixed parents. */
export function carrierOf(
  data: Rows,
  catalog: Pick<ConstructionCatalog, 'equipment'>,
  id: string,
  byId = rowsById(data),
): string | undefined {
  return parentChain(data, id, byId).find((ancestor) => {
    const row = byId.get(ancestor);
    return !!row && trains(catalog.equipment.find((p) => p.id === row.partId));
  });
}

/** Rows by the ID they name as parent. */
export function childrenByParent(data: Rows): Map<string, ConstructionEquipment[]> {
  const out = new Map<string, ConstructionEquipment[]>();
  for (const item of data.equipment)
    if (item.parent !== undefined) {
      const list = out.get(item.parent);
      if (list) list.push(item);
      else out.set(item.parent, [item]);
    }
  return out;
}

/** Every equipment ID these IDs carry, at any depth, excluding the IDs themselves. A loop in a broken source
 * ends the walk rather than repeating it. */
export function carriedIds(data: Rows, ids: Iterable<string>, children = childrenByParent(data)): Set<string> {
  const start = new Set(ids),
    out = new Set<string>(),
    queue = [...start];
  if (!children.size) return out;
  while (queue.length) {
    for (const child of children.get(queue.pop()!) ?? [])
      if (!start.has(child.id) && !out.has(child.id)) {
        out.add(child.id);
        queue.push(child.id);
      }
  }
  return out;
}

const rowsById = (data: Rows) => new Map(data.equipment.map((item) => [item.id, item]));
/** The parent chain of one row, nearest first, stopping at a loop, a missing row or `MAX_PARENT_DEPTH + 1` links. */
export function parentChain(data: Rows, id: string, byId = rowsById(data)): string[] {
  const chain: string[] = [];
  for (
    let parent = byId.get(id)?.parent;
    parent !== undefined && parent !== id && !chain.includes(parent);
    parent = byId.get(parent)?.parent
  ) {
    chain.push(parent);
    if (chain.length > MAX_PARENT_DEPTH) break;
  }
  return chain;
}

/** The IDs of `ids` that no other member of `ids` carries: each one moves or turns its own descendants. */
export function carryRoots(data: Rows, ids: ReadonlySet<string>): string[] {
  const byId = rowsById(data);
  return [...ids].filter((id) => !parentChain(data, id, byId).some((ancestor) => ids.has(ancestor)));
}

const micro = (value: number) => Math.round(value * 1e6) / 1e6 || 0;
/** `point` turned about the vertical axis through `pivot` by a bearing change: clockwise seen from above, as `bearingDeg`. */
export function turnedAbout(point: Vec3, pivot: Vec3, bearingDeg: number): Vec3 {
  const r = (-bearingDeg * Math.PI) / 180,
    x = point[0] - pivot[0],
    z = point[2] - pivot[2];
  return [micro(pivot[0] + x * Math.cos(r) + z * Math.sin(r)), point[1], micro(pivot[2] - x * Math.sin(r) + z * Math.cos(r))];
}

/** The riders of `id` after its datum moved from `from` to `to` and turned by `bearingDeg` (clockwise seen from
 * above) about the new datum: the same rigid change of pose, for edits that rewrite a parent record whole. */
export function carriedPoses(
  data: Rows,
  id: string,
  from: Vec3,
  to: Vec3,
  bearingDeg: number,
  skip: ReadonlySet<string> = new Set(),
): ConstructionEquipment[] {
  const riders = carriedIds(data, [id]);
  if (!riders.size || (bearingDeg % 360 === 0 && from.every((v, k) => v === to[k]))) return [];
  return data.equipment
    .filter((rider) => riders.has(rider.id) && !skip.has(rider.id))
    .map((rider) => ({
      ...structuredClone(rider),
      position: turnedAbout(rider.position.map((v, k) => v - from[k] + to[k]) as Vec3, to, bearingDeg),
      ...(rider.wall ? {} : { bearingDeg: (((rider.bearingDeg + bearingDeg) % 360) + 360) % 360 }),
    }));
}

/** The parent datum: a hull piece's position or an equipment row's. */
export function parentPosition(data: Pick<ConstructionData, 'equipment' | 'primitives'>, id: string): Vec3 | undefined {
  return (data.equipment.find((item) => item.id === id) ?? data.primitives.find((piece) => piece.id === id))?.position;
}

export interface ParentCandidate {
  id: string;
  kind: 'hull' | 'equipment';
  label: string;
  distanceM: number;
}
/** The nearest hull pieces and equipment that could carry `item`: not itself, nothing it already carries
 * (that would loop), nothing too deep to add a link, and only kinds a parent may be. A gun, or anything a gun
 * carries, is offered only when the item and everything it carries may ride a trainable gun. Sorted by datum
 * distance. */
export function parentCandidates(
  source: ConstructionSource,
  catalog: ConstructionCatalog,
  item: ConstructionEquipment,
  limit = 20,
): ParentCandidate[] {
  const data = source.construction,
    below = carriedIds(data, [item.id]),
    byId = rowsById(data);
  // The deepest chain hanging from the item: a parent may add links above it only while the whole stays within the limit.
  const depthBelow = (id: string): number =>
    Math.max(0, ...data.equipment.filter((e) => e.parent === id && below.has(e.id)).map((e) => 1 + depthBelow(e.id)));
  const room = MAX_PARENT_DEPTH - depthBelow(item.id);
  const partOf = (row: ConstructionEquipment) => catalog.equipment.find((p) => p.id === row.partId);
  const rides = [item, ...data.equipment.filter((e) => below.has(e.id))].every((row) =>
    mayRideTrainable(source, catalog, row, partOf(row)),
  );
  const distance = (p: Vec3) => Math.hypot(p[0] - item.position[0], p[1] - item.position[1], p[2] - item.position[2]);
  const candidates: ParentCandidate[] = [];
  for (const piece of data.primitives)
    candidates.push({ id: piece.id, kind: 'hull', label: `${piece.kind} · ${piece.id}`, distanceM: distance(piece.position) });
  for (const other of data.equipment) {
    if (other.id === item.id || below.has(other.id)) continue;
    const part = catalog.equipment.find((p) => p.id === other.partId);
    if (!mayCarry(other, part)) continue;
    if (parentChain(data, other.id, byId).length >= room) continue;
    if (!rides && (trains(part) || carrierOf(data, catalog, other.id, byId) !== undefined)) continue;
    candidates.push({
      id: other.id,
      kind: 'equipment',
      label: `${part?.name ?? other.partId} · ${other.id}${trains(part) ? ' · trains' : ''}`,
      distanceM: distance(other.position),
    });
  }
  return candidates.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id)).slice(0, limit);
}
