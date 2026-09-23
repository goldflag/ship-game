/** The data half of the Blender front end, with no Blender and no compiler in it: what a scene holds
 * (`blenderScene`) and what an edited scene means for the source (`blenderEdits`). The Python scripts
 * in `blender/` only move this data in and out of Blender; the Blender-side identity hashes live in
 * `blender/scene.py`. `blenderFrontEnd.ts` runs the processes. */
import type {
  ConstructionCatalog,
  ConstructionEquipment,
  ConstructionLoad,
  ConstructionPrimitive,
  ConstructionResult,
  ConstructionSource,
  ConstructionSurfaceAssignment,
  Vec3,
} from '../../src/ships/blueprint';
import { CONSTRUCTION_SHAPES } from '../../src/ships/constructionShapes';
import { CONSTRUCTION_PAINTS, constructionShipPaint } from '../../src/ships/constructionPaints';
import { CONSTRUCTION_FACES } from '../../src/ships/constructionEditor';
import { CORNER_SIGNS, VERTEX_FACES } from '../../src/ships/constructionVertex';
import { meshFaces } from '../../src/ships/constructionMesh';
import { shapedFaces } from '../../src/ships/freeformShape';
import { balconyFaces } from '../../src/ships/constructionBalcony';
import { customHullFaces } from '../../src/ships/customHullModel';
import { orientVector, unorientVector } from '../../src/ships/constructionOrientation';
import { effectiveConstructionCatalog, customFittingDefinitions } from '../../src/ships/constructionCustomFittings';
import { mayFloat, type PlacementItem } from '../../src/ships/constructionPlacement';
import { blenderWorld, blenderYawToBearing, degrees360, blenderYawToRotation, bearingToBlenderYaw, rotationToBlenderYaw, sizeToBlender, toBlender } from './blenderFrame';
import { meshToSolid } from './meshSolid';
import type { MeshTriangle } from './meshFile';

export const SCENE_VERSION = 1;
/** `block` hull pieces are exported; `reference` pieces (the custom hull, balconies) are locked and never
 * exported; `equipment` empties become equipment rows; `load` boxes become loads; `proxy` is display only. */
export type SceneRole = 'block' | 'reference' | 'equipment' | 'load' | 'proxy';
const EXPORTED: readonly SceneRole[] = ['block', 'equipment', 'load'];
/** Collections the import creates; an object without a role takes the role of its collection. */
export const ROLE_COLLECTIONS: Record<string, SceneRole> = { Blocks: 'block', Equipment: 'equipment', Loads: 'load', Reference: 'reference' };

/** Vertices and polygons in the object's own Blender-local axes. */
export interface SceneMesh {
  vertices: Vec3[];
  faces: number[][];
}
export interface SceneObject {
  id: string;
  role: SceneRole;
  /** Primitive kind, equipment part kind, or `load`. */
  kind: string;
  location: Vec3;
  /** Blender Z rotation in degrees. */
  yawDeg: number;
  mesh?: SceneMesh;
  paint?: string;
  partId?: string;
  seat?: boolean;
  /** Equipment display box in the empty's local axes. */
  proxy?: { center: Vec3; size: Vec3 };
  massKg?: number;
  loadName?: string;
}
/** `scene.json`: everything the Blender import script needs, already in Blender axes. */
export interface SceneDocument {
  version: typeof SCENE_VERSION;
  ship: string;
  name: string;
  revision: string;
  fileRevision: string;
  catalogRevision: string;
  shipPaint: string;
  paints: { id: string; color: string }[];
  objects: SceneObject[];
  /** IDs of every exported role at import; one missing from a later export was deleted in Blender. */
  imported: string[];
}

type Polygon = Vec3[];

/** Closed local polygons of a hull piece, before yaw and position, in construction axes. The display
 * recipes are the editor's: exact corners for blocks and compound solids, the native shape library
 * for presets. Tilt is applied here so the Blender object only carries yaw. */
export function primitivePolygons(p: ConstructionPrimitive): Polygon[] {
  const scale = (v: readonly number[]) => v.map((n, k) => n * p.size[k]) as Vec3;
  let polygons: Polygon[];
  if (p.solid) {
    // Faces two parts share cancel: the outer skin is what remains.
    const solid = p.solid,
      count = new Map<string, number>();
    const key = (corners: number[]) => [...corners].sort((a, b) => a - b).join(',');
    for (const part of solid.parts) for (const face of part.faces) count.set(key(face.corners), (count.get(key(face.corners)) ?? 0) + 1);
    polygons = solid.parts.flatMap((part) => part.faces.filter((face) => count.get(key(face.corners)) === 1).map((face) => face.corners.map((i) => scale(solid.vertices[i]))));
  } else if (p.mesh) polygons = meshFaces(p.mesh, p.size).map((face) => face.points);
  else if (p.kind === 'vertex' && p.shaping) polygons = shapedFaces({ ...p, position: [0, 0, 0], rotationDeg: 0 }).map((face) => face.points);
  else if (p.kind === 'vertex') {
    const corners = p.vertices ?? CORNER_SIGNS.map((v) => v.map((n) => n / 2) as Vec3);
    polygons = VERTEX_FACES.map((face) => face.corners.map((i) => scale(corners[i])));
  } else if (p.kind === 'balcony') polygons = balconyFaces(p.size, p.balcony);
  else if (p.kind === 'custom-hull' && p.customHull)
    polygons = customHullFaces({ ...p, position: [0, 0, 0], rotationDeg: 0 }).map((face) => face.vertices);
  else polygons = (CONSTRUCTION_SHAPES[p.kind] ?? []).map((face) => face.map(scale));
  return p.tilt ? polygons.map((polygon) => polygon.map((v) => orientVector({ rotationDeg: 0, tilt: p.tilt }, v))) : polygons;
}

/** Weld polygons into one indexed mesh; polygons that collapse below three corners are dropped. */
export function weldPolygons(polygons: Polygon[], grid = 1e-7): SceneMesh {
  const vertices: Vec3[] = [],
    index = new Map<string, number>();
  const at = (v: Vec3) => {
    const key = v.map((n) => Math.round(n / grid)).join(',');
    let i = index.get(key);
    if (i === undefined) {
      i = vertices.length;
      index.set(key, i);
      vertices.push(v);
    }
    return i;
  };
  const faces = polygons
    .map((polygon) => polygon.map(at).filter((i, k, all) => i !== all[(k + all.length - 1) % all.length]))
    .filter((face) => new Set(face).size >= 3);
  return { vertices, faces };
}

const round = (v: readonly number[], digits = 9) => v.map((n) => Number(n.toFixed(digits)) + 0) as Vec3;
/** Blender stores single-precision floats: 4.55 comes back as 4.550000191. Scene values are snapped to
 * 10 µm and 0.00001° so that a block placed on a deck touches it exactly, as it did in Blender. */
const snap = (v: readonly number[], step = 1e-5) => round(v.map((n) => Math.round(n / step) * step));
const snapAngle = (degrees: number) => degrees360(Math.round(degrees / 1e-5) * 1e-5);
/** An object's world transform in construction coordinates, snapped. */
function sceneWorld(o: { matrix: number[][] }) {
  const world = blenderWorld(o.matrix);
  return { ...world, location: snap(world.location), yawDeg: snapAngle(world.yawDeg), point: (v: readonly number[]) => snap(world.point(v)) };
}

/** The scene an import writes. Hull pieces are drawn from the source recipes, not from the compiled
 * surfaces: those are the exterior of the union, so a piece touching another comes back as an open
 * shell that could not be exported again. The compile supplies each piece's paint and the exact
 * native skin of the reference hull. */
export function blenderScene(current: { source: ConstructionSource; hash: string }, result: ConstructionResult, catalog: ConstructionCatalog): SceneDocument {
  const { source } = current,
    data = source.construction;
  const shipPaint = constructionShipPaint(source);
  const effective = effectiveConstructionCatalog(data, catalog);
  const surfaces = new Map<string, ConstructionResult['surfaces']>();
  for (const surface of result.surfaces) surfaces.set(surface.primitiveId, [...(surfaces.get(surface.primitiveId) ?? []), surface]);
  const paintOf = (id: string) => {
    const area = new Map<string, number>();
    for (const surface of surfaces.get(id) ?? []) area.set(surface.paint, (area.get(surface.paint) ?? 0) + surface.areaM2);
    const assigned = data.surfaces.find((s) => s.primitiveId === id)?.paint;
    return [...area].sort((a, b) => b[1] - a[1])[0]?.[0] ?? assigned ?? shipPaint;
  };
  const objects: SceneObject[] = [];
  for (const p of data.primitives) {
    const reference = p.kind === 'custom-hull' || p.kind === 'balcony';
    const skin = reference ? surfaces.get(p.id) : undefined;
    if (skin?.length) {
      // The native skin, already in ship coordinates: the object sits at the origin with no yaw.
      const mesh = weldPolygons(skin.map((s) => s.vertices.map((v) => toBlender(v))), 1e-6);
      objects.push({ id: p.id, role: 'reference', kind: p.kind, location: [0, 0, 0], yawDeg: 0, mesh, paint: paintOf(p.id) });
      continue;
    }
    const mesh = weldPolygons(primitivePolygons(p).map((polygon) => polygon.map((v) => toBlender(v))));
    objects.push({
      id: p.id,
      role: reference ? 'reference' : 'block',
      kind: p.kind,
      location: round(toBlender(p.position)),
      yawDeg: rotationToBlenderYaw(p.rotationDeg),
      mesh: { vertices: mesh.vertices.map((v) => round(v)), faces: mesh.faces },
      paint: paintOf(p.id),
    });
  }
  for (const e of data.equipment) {
    const part = effective.equipment.find((candidate) => candidate.id === e.partId);
    const scale = e.scale ?? [1, 1, 1];
    objects.push({
      id: e.id,
      role: 'equipment',
      kind: part?.kind ?? 'unknown',
      location: round(toBlender(e.position)),
      yawDeg: bearingToBlenderYaw(e.bearingDeg),
      partId: e.partId,
      // Equipment that must stand on structure is reseated after a move; a fitting that may float keeps its datum.
      seat: part ? !mayFloat(source, effective, e, part) : false,
      ...(part
        ? { proxy: { center: round(toBlender(part.boundsCenter.map((n, k) => n * scale[k]))), size: round(sizeToBlender(part.size.map((n, k) => n * scale[k]))) } }
        : {}),
    });
  }
  for (const load of data.loads) {
    const [x, y, z] = sizeToBlender(load.size).map((n) => n / 2);
    const corners = CORNER_SIGNS.map((s) => [s[0] * x, s[1] * y, s[2] * z] as Vec3);
    objects.push({
      id: load.id,
      role: 'load',
      kind: 'load',
      location: round(toBlender(load.center)),
      yawDeg: 0,
      mesh: { vertices: corners, faces: VERTEX_FACES.map((face) => [...face.corners]) },
      massKg: load.massKg,
      loadName: load.name,
    });
  }
  const used = new Set(objects.map((o) => o.paint).filter((paint): paint is string => !!paint));
  const paints = [
    ...CONSTRUCTION_PAINTS.map(({ id, color }) => ({ id, color })),
    ...[...used].filter((id) => !CONSTRUCTION_PAINTS.some((paint) => paint.id === id)).map((id) => ({ id, color: '#7c8c91' })),
  ];
  return {
    version: SCENE_VERSION,
    ship: source.id,
    name: source.name,
    revision: source.revision,
    fileRevision: current.hash,
    catalogRevision: data.catalogRevision,
    shipPaint,
    paints,
    objects,
    imported: objects.filter((o) => EXPORTED.includes(o.role)).map((o) => o.id),
  };
}

// ---------------------------------------------------------------------------------------------
// Export: what the edited scene asks of the source
// ---------------------------------------------------------------------------------------------

/** One object as `blender/export_scene.py` dumps it. Geometry is the evaluated mesh (modifiers
 * applied) in the object's local axes; `matrix` is `matrix_world`, row-major. */
export interface DumpObject {
  name: string;
  type: string;
  collections: string[];
  parent?: string | null;
  props: Record<string, unknown>;
  matrix: number[][];
  /** Hashes of the object as it is now, by the same function the import stored them with. */
  shapeHash: string;
  meshHash: string;
  mesh?: { vertices: Vec3[]; faces: number[][]; faceMaterials: number[]; materials: (string | null)[] };
}
export interface SceneDump {
  version: number;
  file: string;
  scene: Record<string, unknown>;
  objects: DumpObject[];
}
export interface ExportOptions {
  maxPlanes?: number;
  maxParts?: number;
  /** Material names that are not construction paint IDs, mapped to one. */
  materials?: Record<string, string>;
}
export interface ExportReport {
  unchanged: string[];
  moved: string[];
  reshaped: { id: string; as: 'eight-corner block' | 'compound solid'; parts?: number; planes?: number; notes?: string[] }[];
  added: { id: string; object: string; role: SceneRole }[];
  removed: string[];
  equipment: string[];
  loads: string[];
  painted: { id: string; paint: string }[];
  reassigned: { object: string; from: string; to: string }[];
  ignored: { object: string; reason: string }[];
  failures: { object: string; id?: string; error: string }[];
  warnings: string[];
}
export interface SceneEdits {
  after: ConstructionSource;
  report: ExportReport;
  /** Equipment rows to seat with the native resolver against `after` before the batch is built. */
  seat: PlacementItem[];
}

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;
const propString = (o: DumpObject, key: string) => (typeof o.props[key] === 'string' && o.props[key] ? (o.props[key] as string) : undefined);
const propNumber = (o: DumpObject, key: string) => (typeof o.props[key] === 'number' && Number.isFinite(o.props[key]) ? (o.props[key] as number) : undefined);
/** Blender copies a data block as `name.001`; the suffix is not part of a paint or part ID. */
const withoutCopySuffix = (name: string) => name.replace(/\.\d{3,}$/, '');

/** The role of an object: its `constructionRole` property, else the import collection it sits in. */
export function objectRole(o: DumpObject): SceneRole | undefined {
  const role = propString(o, 'constructionRole');
  if (role) return (['block', 'reference', 'equipment', 'load', 'proxy'] as const).find((r) => r === role);
  for (const collection of o.collections) if (ROLE_COLLECTIONS[withoutCopySuffix(collection)]) return ROLE_COLLECTIONS[withoutCopySuffix(collection)];
  return undefined;
}

/** Eight corners in canonical order (bow face then stern face, CORNER_SIGNS) when the mesh is a
 * hexahedron: eight vertices, one in each octant around their centroid, whose polygons are the six
 * faces of a box (as quads, or split into triangles). */
export function hexahedronCorners(vertices: Vec3[], faces: number[][]): Vec3[] | undefined {
  if (vertices.length !== 8) return undefined;
  const centre = [0, 1, 2].map((k) => vertices.reduce((sum, v) => sum + v[k], 0) / 8);
  const span = Math.max(...[0, 1, 2].map((k) => Math.max(...vertices.map((v) => v[k])) - Math.min(...vertices.map((v) => v[k]))));
  const order: number[] = [];
  for (const signs of CORNER_SIGNS) {
    const match = vertices.findIndex((v) => v.every((n, k) => (n - centre[k]) * signs[k] > span * 1e-6));
    if (match < 0 || order.includes(match)) return undefined;
    order.push(match);
  }
  const boxFaces = VERTEX_FACES.map((face) => new Set(face.corners.map((i) => order[i])));
  const covered = boxFaces.map(() => new Set<number>());
  for (const face of faces) {
    const owner = boxFaces.findIndex((box) => face.every((i) => box.has(i)));
    if (owner < 0 || face.length > 4) return undefined;
    face.forEach((i) => covered[owner].add(i));
  }
  if (covered.some((set, k) => set.size !== boxFaces[k].size)) return undefined;
  return order.map((i) => vertices[i]);
}

/** Construct a vertex hull piece from world-space geometry, keeping `yawDeg` as its yaw. */
function blockFromGeometry(
  id: string,
  world: { triangles: MeshTriangle[]; vertices: Vec3[]; faces: number[][]; origin: Vec3; yawDeg: number },
  label: string,
  options: ExportOptions,
): { record: ConstructionPrimitive; as: 'eight-corner block' | 'compound solid'; parts?: number; planes?: number; notes?: string[] } {
  const rotationDeg = blenderYawToRotation(world.yawDeg);
  const local = (v: Vec3) => unorientVector({ rotationDeg }, v.map((n, k) => n - world.origin[k]) as Vec3);
  const place = (centre: Vec3) => round(orientVector({ rotationDeg }, centre).map((n, k) => n + world.origin[k]));
  const corners = hexahedronCorners(world.vertices.map(local), world.faces);
  if (corners) {
    const lo = [0, 1, 2].map((k) => Math.min(...corners.map((v) => v[k]))),
      hi = [0, 1, 2].map((k) => Math.max(...corners.map((v) => v[k])));
    const size = round(hi.map((n, k) => n - lo[k]));
    if (size.some((n) => !(n > 1e-4))) throw new Error('The block is flat: every hull piece needs thickness on all three axes.');
    const centre = [0, 1, 2].map((k) => (hi[k] + lo[k]) / 2) as Vec3;
    const vertices = corners.map((v) => round(v.map((n, k) => (n - centre[k]) / size[k]), 12));
    return { record: { id, kind: 'vertex', size, position: place(centre), rotationDeg, vertices }, as: 'eight-corner block' };
  }
  const triangles = world.triangles.map((t) => ({ ...t, a: local(t.a), b: local(t.b), c: local(t.c) }));
  const solid = meshToSolid(triangles, { label, maxParts: options.maxParts, maxPlanes: options.maxPlanes });
  return {
    record: { id, kind: 'vertex', size: round(solid.size), position: place(solid.center), rotationDeg, solid: { ...solid.solid, vertices: solid.solid.vertices.map((v) => round(v)) } },
    as: 'compound solid',
    parts: solid.parts,
    planes: solid.planes,
    ...(solid.notes.length ? { notes: solid.notes } : {}),
  };
}

/** Everything the scene asks for, as a new source; seating is left to the native resolver. Pure. */
export function blenderEdits(before: ConstructionSource, dump: SceneDump, catalog: ConstructionCatalog, options: ExportOptions = {}): SceneEdits {
  const after = structuredClone(before),
    data = after.construction;
  const effective = effectiveConstructionCatalog(data, catalog);
  const report: ExportReport = {
    unchanged: [], moved: [], reshaped: [], added: [], removed: [], equipment: [], loads: [], painted: [], reassigned: [], ignored: [], failures: [], warnings: [],
  };
  const seat: PlacementItem[] = [];
  const shipPaint = constructionShipPaint(before);
  if (dump.scene.constructionShip !== undefined && dump.scene.constructionShip !== before.id)
    throw new Error(`The scene was imported from ${String(dump.scene.constructionShip)}, not ${before.id}.`);
  if (dump.scene.constructionRevision !== undefined && dump.scene.constructionRevision !== before.revision)
    report.warnings.push(
      'The source changed since this scene was imported; objects left unchanged in Blender keep the current source, changed ones replace their records.',
    );
  const imported = new Set<string>(typeof dump.scene.constructionImported === 'string' ? (JSON.parse(dump.scene.constructionImported) as string[]) : []);

  const taken = new Set<string>([...data.primitives, ...data.equipment, ...data.loads, ...data.boundaries, ...customFittingDefinitions(data)].map((row) => row.id));
  const fresh = (wanted: string) => {
    const base = (wanted.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'piece').slice(0, 56);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = base + '-' + n;
    taken.add(id);
    return id;
  };

  // Identity: the constructionId property. Blender copies properties with the object, so of several
  // objects claiming one ID the original keeps it (its import name, else its unchanged hash) and
  // every copy is a new record.
  const claims = new Map<string, DumpObject[]>();
  const candidates: { o: DumpObject; role: SceneRole; id?: string }[] = [];
  for (const o of dump.objects) {
    const role = objectRole(o);
    if (!role) {
      if (o.type === 'MESH' || o.type === 'EMPTY') report.ignored.push({ object: o.name, reason: 'no constructionRole and not in a Blocks, Equipment or Loads collection' });
      continue;
    }
    if (role === 'proxy') continue;
    if (role === 'reference') {
      if (o.props.shapeHash !== undefined && o.shapeHash !== o.props.shapeHash)
        report.warnings.push(`${o.name} is a reference and is never exported; reshape the hull through ship:loft or hull-station commands.`);
      continue;
    }
    const id = propString(o, 'constructionId');
    if (id) claims.set(id, [...(claims.get(id) ?? []), o]);
    candidates.push({ o, role, id });
  }
  const original = new Map<string, DumpObject>();
  for (const [id, objects] of claims) {
    const chosen =
      objects.find((o) => o.name === o.props.importName) ??
      objects.find((o) => o.shapeHash === o.props.shapeHash) ??
      [...objects].sort((a, b) => a.name.localeCompare(b.name))[0];
    original.set(id, chosen);
  }

  const primitiveIndex = new Map(data.primitives.map((p, i) => [p.id, i]));
  const equipmentIndex = new Map(data.equipment.map((e, i) => [e.id, i]));
  const loadIndex = new Map(data.loads.map((l, i) => [l.id, i]));
  const present = new Set<string>();

  const materialPaint = (o: DumpObject): { paint?: string; paints: string[] } => {
    const mesh = o.mesh;
    if (!mesh || !mesh.materials.length) return { paints: [] };
    const names = mesh.materials.map((name) => {
      if (!name) return undefined;
      const mapped = options.materials?.[name] ?? options.materials?.[withoutCopySuffix(name)];
      if (mapped) return mapped;
      const bare = withoutCopySuffix(name);
      if (CONSTRUCTION_PAINTS.some((paint) => paint.id === bare) || bare === shipPaint) return bare;
      throw new Error(
        `material "${name}" is not a construction paint ID (${CONSTRUCTION_PAINTS.map((p) => p.id).join(', ')}); rename it, or map it with --materials`,
      );
    });
    const counts = new Map<string, number>();
    for (const index of mesh.faceMaterials) {
      const paint = names[index];
      if (paint) counts.set(paint, (counts.get(paint) ?? 0) + 1);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([paint]) => paint);
    return { paint: ranked[0], paints: ranked };
  };
  /** Every face of one piece takes `paint`, keeping each face's armor. Panel rows go when the piece has no panels. */
  const paintPiece = (primitive: ConstructionPrimitive, paint: string) => {
    const keep = (s: ConstructionSurfaceAssignment) => s.primitiveId !== primitive.id || s.panelId === undefined || !!primitive.solid;
    data.surfaces = data.surfaces.filter(keep);
    for (const face of CONSTRUCTION_FACES) {
      const row = data.surfaces.find((s) => s.primitiveId === primitive.id && s.face === face && s.panelId === undefined);
      if (row) row.paint = paint;
      else data.surfaces.push({ primitiveId: primitive.id, face, thicknessMm: 0, material: 'steel', paint });
    }
    report.painted.push({ id: primitive.id, paint });
  };
  const worldGeometry = (o: DumpObject) => {
    const world = sceneWorld(o);
    const vertices = o.mesh!.vertices.map((v) => world.point(v));
    const names = o.mesh!.materials;
    const triangles: MeshTriangle[] = o.mesh!.faces.flatMap((face, f) =>
      face.slice(1, -1).map((_, i) => ({
        a: vertices[face[0]],
        b: vertices[face[i + 1]],
        c: vertices[face[i + 2]],
        ...(names.length > 1 && names[o.mesh!.faceMaterials[f]] ? { group: withoutCopySuffix(names[o.mesh!.faceMaterials[f]]!) } : {}),
      })),
    );
    return { world, vertices, triangles };
  };

  for (const { o, role, id: claimed } of candidates) {
    const isOriginal = !!claimed && original.get(claimed) === o;
    const known = isOriginal && (role === 'block' ? primitiveIndex.has(claimed) : role === 'equipment' ? equipmentIndex.has(claimed) : loadIndex.has(claimed));
    if (isOriginal && !known && imported.has(claimed) && o.shapeHash === o.props.shapeHash) {
      // Deleted from the source since the import and untouched in Blender: the deletion stands.
      report.warnings.push(`${o.name}: ${claimed} was removed from the source after the import; the untouched object does not bring it back.`);
      present.add(claimed);
      continue;
    }
    let id: string;
    if (known) id = claimed!;
    else {
      if (claimed && !isOriginal) {
        id = fresh(claimed + '-copy');
        report.reassigned.push({ object: o.name, from: claimed, to: id });
      } else if (claimed && VALID_ID.test(claimed) && !taken.has(claimed)) {
        // A record deleted from the source since import, or an ID typed by hand: create it under that ID.
        id = claimed;
        taken.add(id);
      } else id = fresh(role === 'equipment' ? (propString(o, 'partId') ?? withoutCopySuffix(o.name)).replace(/^design:/, '') : withoutCopySuffix(o.name));
      report.added.push({ id, object: o.name, role });
    }
    present.add(id);
    const unchanged = known && o.shapeHash === o.props.shapeHash;
    try {
      if (role === 'block') {
        if (o.type !== 'MESH' || !o.mesh) throw new Error('a block must be a mesh object');
        const { paint, paints } = materialPaint(o);
        if (unchanged) {
          report.unchanged.push(id);
          continue;
        }
        const index = primitiveIndex.get(id);
        const was = index === undefined ? undefined : data.primitives[index];
        // A copy made in Blender starts from the record it was copied from.
        const template = was ?? (claimed ? before.construction.primitives.find((p) => p.id === claimed) : undefined);
        const world = sceneWorld(o);
        let primitive: ConstructionPrimitive;
        if (template && o.meshHash === o.props.meshHash && world.offYaw < 1e-6) {
          // Moved or turned only: the record keeps its shape, tilt, armor and every other field.
          primitive = { ...structuredClone(template), id, position: round(world.location), rotationDeg: blenderYawToRotation(world.yawDeg) };
          if (!was)
            data.surfaces.push(...before.construction.surfaces.filter((s) => s.primitiveId === template.id).map((s) => ({ ...structuredClone(s), primitiveId: id })));
          else if (JSON.stringify(primitive) !== JSON.stringify(was)) report.moved.push(id);
        } else {
          if (was?.kind === 'ballast') throw new Error('a ballast block can be moved or turned but not reshaped');
          const geometry = worldGeometry(o);
          const built = blockFromGeometry(id, { ...geometry, faces: o.mesh.faces, origin: geometry.world.location, yawDeg: geometry.world.yawDeg }, propString(o, 'label') ?? withoutCopySuffix(o.name), options);
          primitive = { ...built.record, ...(was?.smoothGroup ? { smoothGroup: was.smoothGroup } : {}) };
          if (paints.length > 1 && built.as === 'eight-corner block')
            report.warnings.push(`${o.name}: an eight-corner block takes one paint; ${paint} was used for every face.`);
          report.reshaped.push({ id, as: built.as, ...(built.parts ? { parts: built.parts, planes: built.planes } : {}), ...(built.notes ? { notes: built.notes } : {}) });
        }
        if (index === undefined) data.primitives.push(primitive);
        else data.primitives[index] = primitive;
        const importedPaint = propString(o, 'constructionPaint');
        if (paint && (was ? paint !== importedPaint : paint !== shipPaint || paints.length > 1)) {
          if (primitive.solid && paints.length > 1) {
            // Several materials on a compound solid: each material is a surface group with its own paint.
            data.surfaces = data.surfaces.filter((s) => s.primitiveId !== id || s.panelId === undefined || !paints.includes(s.panelId));
            for (const group of paints) for (const face of CONSTRUCTION_FACES) data.surfaces.push({ primitiveId: id, face, panelId: group, thicknessMm: 0, material: 'steel', paint: group });
            report.painted.push({ id, paint: paints.join('+') });
          } else paintPiece(primitive, paint);
        } else if (!primitive.solid) data.surfaces = data.surfaces.filter((s) => s.primitiveId !== id || s.panelId === undefined);
      } else if (role === 'equipment') {
        if (o.type !== 'EMPTY') throw new Error('equipment must be an empty; its location is the datum and its Z rotation the bearing');
        if (unchanged) {
          report.unchanged.push(id);
          continue;
        }
        const index = equipmentIndex.get(id);
        const was = index === undefined ? undefined : data.equipment[index];
        const partId = propString(o, 'partId') ?? was?.partId ?? withoutCopySuffix(o.name);
        const part = effective.equipment.find((p) => p.id === partId);
        if (!part) throw new Error(`unknown part ${partId}; set the empty's partId property to a catalog or design: part (ship:catalog lists them)`);
        const world = sceneWorld(o);
        if (world.offYaw > 1e-6) report.warnings.push(`${o.name}: only the location and Z rotation of an equipment empty are read; tilt and scale were ignored.`);
        const bearing = blenderYawToBearing(world.yawDeg);
        const record: ConstructionEquipment = {
          ...(was && was.partId === partId ? structuredClone(was) : {}),
          id,
          partId,
          position: round(world.location),
          bearingDeg: was?.wall ? was.bearingDeg : bearing,
        };
        if (was?.wall && Math.abs(blenderYawToBearing(world.yawDeg) - was.bearingDeg) > 1e-6)
          report.warnings.push(`${o.name}: a wall fitting faces out of its wall; its bearing was kept.`);
        if (index === undefined) data.equipment.push(record);
        else data.equipment[index] = record;
        report.equipment.push(id);
        const wantsSeat = o.props.seat === undefined ? !mayFloat(after, effective, record, part) : !!o.props.seat;
        if (wantsSeat) seat.push({ equipment: record, select: 'nearest' });
      } else {
        if (o.type !== 'MESH' || !o.mesh) throw new Error('a load must be a box mesh');
        if (unchanged) {
          report.unchanged.push(id);
          continue;
        }
        const index = loadIndex.get(id);
        const was = index === undefined ? undefined : data.loads[index];
        const { world, vertices } = worldGeometry(o);
        if (world.offYaw > 1e-6 && Math.abs(world.yawDeg % 90) > 1e-6) report.warnings.push(`${o.name}: loads are axis-aligned boxes; the turned box's bounds were used.`);
        const lo = [0, 1, 2].map((k) => Math.min(...vertices.map((v) => v[k]))),
          hi = [0, 1, 2].map((k) => Math.max(...vertices.map((v) => v[k])));
        const massKg = propNumber(o, 'massKg') ?? was?.massKg;
        if (massKg === undefined) throw new Error('a new load needs a massKg property');
        const load: ConstructionLoad = {
          id,
          name: propString(o, 'loadName') ?? was?.name ?? withoutCopySuffix(o.name),
          center: round(hi.map((n, k) => (n + lo[k]) / 2)),
          size: round(hi.map((n, k) => n - lo[k])),
          massKg,
        };
        if (index === undefined) data.loads.push(load);
        else data.loads[index] = load;
        report.loads.push(id);
      }
    } catch (error) {
      report.failures.push({ object: o.name, id, error: (error as Error).message });
    }
  }

  // An imported record whose object is gone was deleted in Blender. Records added after the import
  // (by the editor or another agent) were never in the scene and are kept.
  const exists = new Set([...before.construction.primitives, ...before.construction.equipment, ...before.construction.loads].map((row) => row.id));
  for (const id of imported) if (!present.has(id) && exists.has(id)) report.removed.push(id);
  if (report.removed.length) {
    const gone = new Set(report.removed);
    data.primitives = data.primitives.filter((p) => !gone.has(p.id));
    data.equipment = data.equipment.filter((e) => !gone.has(e.id));
    data.loads = data.loads.filter((l) => !gone.has(l.id));
    data.surfaces = data.surfaces.filter((s) => !gone.has(s.primitiveId));
  }
  return { after, report, seat };
}
