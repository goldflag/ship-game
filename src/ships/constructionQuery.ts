import type {
  ConstructionCatalog,
  ConstructionEquipment,
  ConstructionEquipmentPart,
  ConstructionFittingDefinition,
  ConstructionPrimitive,
  ConstructionSource,
  Vec3,
} from './blueprint';
import { CONSTRUCTION_LIMITS } from './constructionEditor';
import {
  CUSTOM_FITTING_LIMITS,
  customFittingDefinitions,
  customFittingInstances,
  customFittingPartId,
  effectiveConstructionCatalog,
  equipmentCounts,
  resolveCustomFitting,
} from './constructionCustomFittings';
import { equipmentPathBounds, pathWorldPoint } from './constructionPaths';
import { worldVertex } from './constructionVertex';
import { installedWallPart } from './constructionWallFittings';
import { envelopeVertices } from './freeformShape';

/** Bounded, compile-free reads of a construction source for agents. Every answer is source-level:
 * Rust remains authoritative for fit, clearance and launch validity. */
export const CONSTRUCTION_CONVENTIONS = {
  units: 'metres',
  axes: '+X starboard, +Y up, -Z bow; compilation never recenters',
  bearingDeg: 'clockwise seen from above; 0 faces the bow (-Z), 90 starboard (+X)',
  primitive:
    'size [x,y,z] is the envelope centred at position; custom-hull size is [beam, depth, length]; rotationDeg is yaw, optional tilt adds pitch/roll (YXZ)',
  equipment: 'position is the catalog part datum (not its bounds centre); catalog boundsCenter/size are datum-local',
} as const;
/** Source bounds checked by `validate_source` in crates/naval-sim/src/construction.rs. */
export const CONSTRUCTION_SOURCE_LIMITS = {
  ...CONSTRUCTION_LIMITS,
  sourceBytes: 16_000_000,
  idCharacters: 64,
  pathPoints: 64,
} as const;
/** Derived complexity bounds (`MAX_SURFACES`, `MAX_CONNECTIONS`); usage is known only after a compile. */
export const CONSTRUCTION_DERIVED_LIMITS = { surfaces: 131_072, floodingPortals: 16_384 } as const;

export type QueryTable = 'primitives' | 'equipment' | 'boundaries' | 'loads' | 'fittings';
export interface Aabb {
  min: Vec3;
  max: Vec3;
}
export interface BoundsRow extends Aabb {
  id: string;
  table: QueryTable;
  kind: string;
  part?: string;
  /** Equipment datum; the box is usually not centred on it. */
  datum?: Vec3;
  approximate: boolean;
  why?: string[];
  /** Union of the part's intrinsic working spaces (turret wells, magazines), when it has any. */
  occupancy?: Aabb;
}
export interface Selector {
  ids?: string[];
  kind?: string;
  part?: string;
  prefix?: string;
}

const round = (n: number, digits = 3) => {
  const v = Number(n.toFixed(digits));
  return v === 0 ? 0 : v;
};
const vec = (v: readonly number[]) => v.map((n) => round(n)) as Vec3;
const box = (points: readonly (readonly number[])[]): Aabb => ({
  min: vec([0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])))),
  max: vec([0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])))),
});
const union = (boxes: readonly Aabb[]): Aabb | undefined => (boxes.length ? box(boxes.flatMap((b) => [b.min, b.max])) : undefined);
const corners = (center: Vec3, size: Vec3): Vec3[] =>
  [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) => [center[0] + (x * size[0]) / 2, center[1] + (y * size[1]) / 2, center[2] + (z * size[2]) / 2] as Vec3),
    ),
  );
const partOf = (catalog: ConstructionCatalog | undefined, item: ConstructionEquipment) =>
  catalog?.equipment.find((p) => p.id === item.partId);
const resolvedMass = (def: ConstructionFittingDefinition) => {
  try {
    return round(resolveCustomFitting(def).massKg ?? 0);
  } catch {
    return null;
  }
};
/** Published parts plus the design's own fitting definitions. */
const partsFor = (source: ConstructionSource, catalog: ConstructionCatalog | undefined) =>
  catalog && effectiveConstructionCatalog(source.construction, catalog);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}
export function closestIds(id: string, known: readonly string[], count = 3): string[] {
  const lower = id.toLowerCase();
  return known
    .map((candidate) => ({
      candidate,
      score:
        candidate.toLowerCase().includes(lower) || lower.includes(candidate.toLowerCase()) ? 0 : distance(lower, candidate.toLowerCase()),
    }))
    .filter((entry) => entry.score <= Math.max(3, Math.ceil(id.length / 2)))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, count)
    .map((entry) => entry.candidate);
}

interface Entry {
  table: QueryTable;
  id: string;
  kind: string;
  part?: string;
  record: object;
}
function entries(source: ConstructionSource, catalog?: ConstructionCatalog): Entry[] {
  const c = source.construction;
  return [
    ...c.primitives.map((record): Entry => ({ table: 'primitives', id: record.id, kind: record.kind, record })),
    ...c.equipment.map((record): Entry => ({
      table: 'equipment',
      id: record.id,
      kind: partOf(catalog, record)?.kind ?? 'unknown',
      part: record.partId,
      record,
    })),
    ...c.boundaries.map((record): Entry => ({ table: 'boundaries', id: record.id, kind: 'boundary', record })),
    ...c.loads.map((record): Entry => ({ table: 'loads', id: record.id, kind: 'load', record })),
    ...customFittingDefinitions(c).map((record): Entry => ({ table: 'fittings', id: record.id, kind: 'custom-fitting', record })),
  ];
}
/** Selectors intersect. Unknown IDs throw with the closest existing IDs; nothing is returned partially. */
function select(source: ConstructionSource, catalog: ConstructionCatalog | undefined, selector: Selector): Entry[] {
  const all = entries(source, catalog);
  if (selector.ids) {
    const known = new Set(all.map((e) => e.id));
    const unknown = selector.ids.filter((id) => !known.has(id));
    if (unknown.length)
      throw new Error(
        'Unknown ID' +
          (unknown.length > 1 ? 's' : '') +
          ': ' +
          unknown
            .map((id) => {
              const near = closestIds(id, [...known]);
              return id + (near.length ? ' (closest: ' + near.join(', ') + ')' : ' (no similar ID)');
            })
            .join('; ') +
          '. Run summary for every ID.',
      );
  }
  const ids = selector.ids && new Set(selector.ids);
  return all.filter(
    (e) =>
      (!ids || ids.has(e.id)) &&
      (!selector.kind || e.kind === selector.kind) &&
      (!selector.part || e.part === selector.part) &&
      (!selector.prefix || e.id.startsWith(selector.prefix)),
  );
}
const hasSelector = (s: Selector) => !!(s.ids || s.kind || s.part || s.prefix);

// ── Bounds ──────────────────────────────────────────────────────────────────
const EXACT_PRIMITIVES = new Set<ConstructionPrimitive['kind']>(['box', 'vertex', 'hollow-cube', 'balcony']);
export function primitiveBounds(p: ConstructionPrimitive): BoundsRow {
  const why: string[] = [];
  if (p.kind === 'custom-hull') why.push('section control points; lofted skin and bilge keels not sampled');
  else if (!p.mesh && !EXACT_PRIMITIVES.has(p.kind)) why.push('size envelope of a sloped or curved shape');
  return {
    id: p.id,
    table: 'primitives',
    kind: p.kind,
    ...box(envelopeVertices(p).map((v) => worldVertex(p, v))),
    approximate: why.length > 0,
    ...(why.length ? { why } : {}),
  };
}
export function equipmentBounds(item: ConstructionEquipment, part: ConstructionEquipmentPart | undefined): BoundsRow {
  if (!part)
    return {
      id: item.id,
      table: 'equipment',
      kind: 'unknown',
      part: item.partId,
      datum: vec(item.position),
      min: vec(item.position),
      max: vec(item.position),
      approximate: true,
      why: ['part absent from the catalog; datum only'],
    };
  const local = part.path ? equipmentPathBounds(part, item) : installedWallPart(part, item);
  const center = 'boundsCenter' in local ? local.boundsCenter : local.center;
  const world = (c: Vec3, s: Vec3) => box(corners(c, s).map((p) => pathWorldPoint(item, p)));
  const bounds = world(center, local.size),
    why: string[] = [];
  if (Math.abs(item.bearingDeg % 90) > 1e-6) why.push('box around a part turned off the ship axes');
  if (part.kind === 'gun' || part.kind === 'torpedo-launcher') why.push('stowed; training sweeps outside');
  const rise = item.gun?.barbetteHeightM ?? 0;
  if (rise > 0) {
    bounds.min[1] = round(bounds.min[1] - rise);
    why.push('includes the turret rise support');
  }
  if (part.path) why.push('path members only');
  if (part.kind === 'propeller') why.push('generated shafts not included');
  const spaces = part.path || item.wall ? undefined : union((part.occupancy ?? []).map((space) => world(space.center, space.size)));
  return {
    id: item.id,
    table: 'equipment',
    kind: part.kind,
    part: part.id,
    datum: vec(item.position),
    ...bounds,
    approximate: why.length > 0,
    ...(why.length ? { why } : {}),
    ...(spaces ? { occupancy: spaces } : {}),
  };
}
function allBounds(source: ConstructionSource, catalog: ConstructionCatalog | undefined, chosen?: Entry[]): BoundsRow[] {
  return (chosen ?? entries(source, catalog)).flatMap((e): BoundsRow[] =>
    e.table === 'primitives'
      ? [primitiveBounds(e.record as ConstructionPrimitive)]
      : e.table === 'equipment'
        ? [equipmentBounds(e.record as ConstructionEquipment, partOf(catalog, e.record as ConstructionEquipment))]
        : e.table === 'loads'
          ? [
              {
                id: e.id,
                table: 'loads',
                kind: 'load',
                ...box(corners((e.record as { center: Vec3 }).center, (e.record as { size: Vec3 }).size)),
                approximate: false,
              },
            ]
          : [],
  );
}
const NOTE = 'Source-level axis-aligned boxes in ship coordinates. They do not replace the native compiler for fit, clearance or support.';
/** Hull-piece extents only, the same measure as the editor ledger's L/B/H. */
export function sourceBounds(source: ConstructionSource): (Aabb & { size: Vec3 }) | undefined {
  const b = union(source.construction.primitives.map(primitiveBounds));
  return b && { ...b, size: vec(b.max.map((n, k) => n - b.min[k])) };
}
export function constructionBounds(
  source: ConstructionSource,
  catalog: ConstructionCatalog | undefined,
  selector: Selector = {},
  all = false,
) {
  catalog = partsFor(source, catalog);
  const chosen = hasSelector(selector) ? select(source, catalog, selector) : undefined;
  const planes = (chosen ?? [])
    .filter((e) => e.table === 'boundaries')
    .map((e) => {
      const b = e.record as { axis: string; offset: number };
      return { id: e.id, table: e.table, plane: { axis: b.axis, offset: b.offset } };
    });
  const rows = allBounds(source, catalog, chosen ?? (all ? undefined : entries(source, catalog).filter((e) => e.table !== 'equipment')));
  return {
    note: NOTE,
    hull: sourceBounds(source),
    ...(chosen ? { selection: union(rows) } : {}),
    bounds: rows,
    ...(planes.length ? { planes } : {}),
    ...(!chosen && !all && source.construction.equipment.length
      ? { omitted: source.construction.equipment.length + ' equipment rows; select with --ids, --kind, --part or --prefix, or pass --all' }
      : {}),
  };
}

// ── Spatial queries ─────────────────────────────────────────────────────────
const gapTo = (a: Aabb, b: Aabb): Vec3 => vec([0, 1, 2].map((k) => Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k])));
const length = (gap: Vec3) => round(Math.hypot(...gap.map((n) => Math.max(0, n))));
export interface NearQuery {
  point?: Vec3;
  radius?: number;
  box?: Aabb;
  limit?: number;
  kind?: string;
}
export function constructionNear(source: ConstructionSource, catalog: ConstructionCatalog | undefined, query: NearQuery) {
  catalog = partsFor(source, catalog);
  if (!query.point === !query.box) throw new Error('Provide exactly one of a point with a radius, or a box.');
  if (query.point && !(Number.isFinite(query.radius) && query.radius! >= 0))
    throw new Error('A point query needs a radius of 0 m or more.');
  const region: Aabb = query.box ? box([query.box.min, query.box.max]) : { min: query.point!, max: query.point! };
  const reach = query.box ? 0 : query.radius!,
    middle = region.min.map((n, k) => (n + region.max[k]) / 2);
  const hits = allBounds(source, catalog)
    .filter((row) => !query.kind || row.kind === query.kind)
    .map((row) => ({
      row,
      distance: length(gapTo(row, region)),
      centre: Math.hypot(...row.min.map((n, k) => (n + row.max[k]) / 2 - middle[k])),
    }))
    .filter((hit) => hit.distance <= reach + 1e-9)
    .sort((a, b) => a.distance - b.distance || a.centre - b.centre);
  const limit = query.limit ?? 25;
  return {
    note: NOTE + ' distance is from the ' + (query.box ? 'box' : 'point') + ' to each record’s box (0 = inside or touching).',
    query: query.box ? { box: region } : { point: query.point, radius: reach },
    total: hits.length,
    ...(hits.length > limit ? { truncatedTo: limit } : {}),
    hits: hits
      .slice(0, limit)
      .map(({ row, distance }) => ({
        id: row.id,
        table: row.table,
        kind: row.kind,
        ...(row.part ? { part: row.part } : {}),
        distance,
        min: row.min,
        max: row.max,
        approximate: row.approximate,
      })),
  };
}
export function constructionBetween(source: ConstructionSource, catalog: ConstructionCatalog | undefined, idA: string, idB: string) {
  catalog = partsFor(source, catalog);
  const rows = allBounds(source, catalog, select(source, catalog, { ids: [idA, idB] }));
  const a = rows.find((r) => r.id === idA),
    b = rows.find((r) => r.id === idB);
  if (!a || !b) throw new Error('Both IDs must be hull pieces, equipment or loads; boundaries are planes without a box.');
  const gap = gapTo(a, b);
  return {
    note:
      NOTE +
      ' gap is per axis [x,y,z] between the two boxes; negative is the overlap depth on that axis. The boxes intersect only when all three are negative.',
    a: { id: a.id, min: a.min, max: a.max, approximate: a.approximate },
    b: { id: b.id, min: b.min, max: b.max, approximate: b.approximate },
    gap,
    boxesIntersect: gap.every((n) => n < 0),
    distance: length(gap),
    approximate: true,
  };
}

// ── Exact records ───────────────────────────────────────────────────────────
export function constructionGet(
  source: ConstructionSource,
  catalog: ConstructionCatalog | undefined,
  selector: Selector,
  options: { fields?: string[]; surfaces?: boolean } = {},
) {
  catalog = partsFor(source, catalog);
  if (!hasSelector(selector)) throw new Error('Select records with --ids, --kind, --part or --prefix.');
  const chosen = select(source, catalog, selector),
    fields = options.fields;
  if (fields) {
    const known = new Set(chosen.flatMap((e) => Object.keys(e.record)));
    const unknown = fields.filter((f) => !known.has(f));
    if (chosen.length && unknown.length)
      throw new Error('No selected record has field ' + unknown.join(', ') + '. Available: ' + [...known].sort().join(', ') + '.');
  }
  const project = (record: object) =>
    fields ? Object.fromEntries(Object.entries(record).filter(([key]) => key === 'id' || fields.includes(key))) : record;
  const records: Partial<Record<QueryTable, object[]>> = {};
  for (const e of chosen) (records[e.table] ??= []).push(project(e.record));
  const primitiveIds = new Set(chosen.filter((e) => e.table === 'primitives').map((e) => e.id));
  return {
    count: chosen.length,
    records,
    ...(options.surfaces ? { surfaces: source.construction.surfaces.filter((s) => primitiveIds.has(s.primitiveId)) } : {}),
  };
}

// ── Summary ─────────────────────────────────────────────────────────────────
export function constructionSummary(
  source: ConstructionSource,
  catalog: ConstructionCatalog | undefined,
  options: { kind?: string; positions?: 'all' | 'none'; sourceBytes?: number } = {},
) {
  const c = source.construction;
  catalog = partsFor(source, catalog);
  const counts = equipmentCounts(c),
    definitions = customFittingDefinitions(c);
  // Outfit is most of a finished ship's equipment; its placements are one `--kind deck-fitting` or `near` away.
  const placed = (kind: string) => (options.positions ? options.positions === 'all' : !!options.kind || kind !== 'deck-fitting');
  const assigned = new Map<string, number>();
  for (const s of c.surfaces) assigned.set(s.primitiveId, (assigned.get(s.primitiveId) ?? 0) + 1);
  const used = (n: number, limit: number) => ({ used: n, limit, free: limit - n });
  const groups = new Map<string, { part: string; kind: string; items: ConstructionEquipment[] }>();
  for (const item of c.equipment) {
    const part = partOf(catalog, item);
    let group = groups.get(item.partId);
    if (!group) groups.set(item.partId, (group = { part: item.partId, kind: part?.kind ?? 'unknown', items: [] }));
    group.items.push(item);
  }
  const kinds: Record<string, number> = {};
  for (const g of groups.values()) kinds[g.kind] = (kinds[g.kind] ?? 0) + g.items.length;
  const wanted = (kind: string) => !options.kind || options.kind === kind;
  return {
    name: source.name,
    constructionVersion: c.version,
    conventions: CONSTRUCTION_CONVENTIONS,
    hullBounds: sourceBounds(source),
    limits: {
      primitives: used(c.primitives.length, CONSTRUCTION_SOURCE_LIMITS.primitives),
      surfaces: used(c.surfaces.length, CONSTRUCTION_SOURCE_LIMITS.surfaces),
      equipment: used(counts.catalog, CONSTRUCTION_SOURCE_LIMITS.equipment),
      // Design-local fitting instances (`partId: "design:…"`) never count against `equipment`.
      customFittingInstances: used(counts.custom, CUSTOM_FITTING_LIMITS.instances),
      customFittingDefinitions: used(definitions.length, CUSTOM_FITTING_LIMITS.definitions),
      boundaries: used(c.boundaries.length, CONSTRUCTION_SOURCE_LIMITS.boundaries),
      loads: used(c.loads.length, CONSTRUCTION_SOURCE_LIMITS.loads),
      ...(options.sourceBytes !== undefined ? { sourceBytes: used(options.sourceBytes, CONSTRUCTION_SOURCE_LIMITS.sourceBytes) } : {}),
    },
    defaults: { thicknessMm: c.defaultThicknessMm, ...(c.paint ? { paint: c.paint } : {}), ...(c.finish ? { finish: c.finish } : {}) },
    primitiveColumns: ['id', 'kind', 'position', 'size', 'rotationDeg or [pitch,yaw,roll]', 'surface assignments'],
    primitives: c.primitives
      .filter((p) => wanted(p.kind))
      .map((p) => [
        p.id,
        p.kind,
        vec(p.position),
        vec(p.size),
        p.tilt ? vec([p.tilt.pitchDeg, p.rotationDeg, p.tilt.rollDeg]) : round(p.rotationDeg),
        assigned.get(p.id) ?? 0,
      ]),
    equipmentCounts: kinds,
    equipmentColumns: 'kind > catalog part > id: [x, y, z, bearingDeg]; an ID list means placements were withheld',
    // kind → catalog part → placements by ID, or IDs alone where placements are withheld.
    equipment: Object.fromEntries(
      Object.keys(kinds)
        .filter(wanted)
        .map((kind) => [
          kind,
          Object.fromEntries(
            [...groups.values()]
              .filter((g) => g.kind === kind)
              .map((g) => [
                g.part,
                placed(kind)
                  ? Object.fromEntries(g.items.map((item) => [item.id, [...vec(item.position), round(item.bearingDeg)]]))
                  : g.items.map((item) => item.id),
              ]),
          ),
        ]),
    ),
    ...(definitions.length && wanted('custom-fitting')
      ? {
          customFittingColumns: ['id', 'name', 'solids', 'tubes', 'massKg (null: the definition does not resolve)', 'instances', 'partId'],
          customFittings: definitions.map((def) => [
            def.id,
            def.name,
            def.solids.length,
            def.tubes.length,
            resolvedMass(def),
            customFittingInstances(c, def.id).length,
            customFittingPartId(def.id),
          ]),
        }
      : {}),
    boundaries: options.kind ? undefined : c.boundaries.map((b) => [b.id, b.axis, round(b.offset), b.thicknessMm]),
    loads: options.kind ? undefined : c.loads.map((l) => [l.id, l.name, round(l.massKg), vec(l.center), vec(l.size)]),
  };
}

/** JSON that keeps a record row on one line: scalar arrays and anything up to `width` characters stay inline. */
export function compactJson(value: unknown, width = 320, indent = ''): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (value === null || typeof value !== 'object') return flat;
  const items = Array.isArray(value) ? value : undefined;
  if (flat.length <= width || (items && items.every((item) => item === null || typeof item !== 'object'))) return flat;
  const inner = indent + ' ';
  const parts = items
    ? items.map((item) => compactJson(item, width, inner))
    : Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => JSON.stringify(key) + ':' + compactJson(item, width, inner));
  return (items ? '[' : '{') + '\n' + parts.map((part) => inner + part).join(',\n') + '\n' + indent + (items ? ']' : '}');
}

/** `ship:catalog` filters. Without options every part is returned unchanged, as before. */
export function catalogParts(
  catalog: ConstructionCatalog,
  options: { query?: string; kind?: string; ids?: string[]; brief?: boolean } = {},
) {
  const known = catalog.equipment.map((part) => part.id),
    unknown = (options.ids ?? []).filter((id) => !known.includes(id));
  if (unknown.length)
    throw new Error(
      'Unknown catalog part' +
        (unknown.length > 1 ? 's' : '') +
        ': ' +
        unknown
          .map((id) => {
            const near = closestIds(id, known);
            return id + (near.length ? ' (closest: ' + near.join(', ') + ')' : '');
          })
          .join('; ') +
        '.',
    );
  const kinds = [...new Set(catalog.equipment.map((part) => part.kind))];
  if (options.kind && !kinds.includes(options.kind as ConstructionEquipmentPart['kind']))
    throw new Error('Unknown equipment kind ' + options.kind + '. Kinds: ' + kinds.join(', ') + '.');
  const query = (options.query ?? '').toLowerCase();
  const parts = catalog.equipment.filter(
    (part) =>
      (!options.ids || options.ids.includes(part.id)) &&
      (!options.kind || part.kind === options.kind) &&
      [part.id, part.name, part.kind].some((value) => value.toLowerCase().includes(query)),
  );
  return options.brief
    ? parts.map(({ id, name, kind, placement, size, boundsCenter, wallMount, path }) => ({
        id,
        name,
        kind,
        placement,
        size,
        boundsCenter,
        ...(wallMount ? { wallMount } : {}),
        ...(path ? { path: path.kind } : {}),
      }))
    : parts;
}
