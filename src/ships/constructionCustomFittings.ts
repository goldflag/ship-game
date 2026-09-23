import type {
  ConstructionCatalog,
  ConstructionData,
  ConstructionEquipment,
  ConstructionEquipmentPart,
  ConstructionFittingDefinition,
  ConstructionFittingSolid,
  ConstructionPrimitive,
  Vec3,
} from './blueprint';
import { decodeFittingMesh, FITTING_MESH_LIMITS, fittingMeshAreaMoments, fittingMeshBoxes } from './constructionFittingMesh';
import { meshFaces } from './constructionMesh';
import { primitivePoint } from './constructionOrientation';
import { CONSTRUCTION_SHAPES } from './constructionShapes';
import { cornerVertices, VERTEX_FACES } from './constructionVertex';
import { shapedFaces } from './freeformShape';

/** Design-local fittings: definitions in `construction.fittings`, fitted through ordinary equipment rows whose
 * `partId` is `design:<definition id>`. This module is the TypeScript resolver; it mirrors
 * `crates/naval-sim/src/construction_custom_fittings.rs`, which stays the authority on validity and loading. */
export const CUSTOM_FITTING_PREFIX = 'design:';
/** Mirrors the constants in `construction_custom_fittings.rs`; online designs use the same limits. */
export const CUSTOM_FITTING_LIMITS = {
  definitions: 256,
  solids: 256,
  tubes: 128,
  tubePoints: 256,
  boxes: 64,
  instances: 1_000,
  triangles: 32_000,
  tubeLengthM: 100,
  localM: 100,
  ...FITTING_MESH_LIMITS,
} as const;
/** Per-axis scale of a custom fitting instance, mirroring `INSTANCE_SCALE` in `construction_wall_fittings.rs`. */
export const CUSTOM_FITTING_SCALE = { min: 0.05, max: 20 } as const;
export const CUSTOM_FITTING_MATERIALS = { steel: 7850, aluminium: 2700, brass: 8500, wood: 700 } as const;
export const CUSTOM_FITTING_EXCLUDED_KINDS = ['custom-hull', 'balcony', 'ballast'] as const;
export const TUBE_SIDES = 12;

export const isCustomFittingPartId = (partId: string) => partId.startsWith(CUSTOM_FITTING_PREFIX);
export const customFittingPartId = (definitionId: string) => CUSTOM_FITTING_PREFIX + definitionId;
export const customFittingDefinitionId = (partId: string) => (isCustomFittingPartId(partId) ? partId.slice(CUSTOM_FITTING_PREFIX.length) : undefined);
export const customFittingDefinitions = (data: Pick<ConstructionData, 'fittings'>) => data.fittings ?? [];
export const customFittingOf = (data: Pick<ConstructionData, 'fittings'>, item: Pick<ConstructionEquipment, 'partId'>) =>
  customFittingDefinitions(data).find((def) => def.id === customFittingDefinitionId(item.partId));
export const customFittingInstances = (data: Pick<ConstructionData, 'equipment'>, definitionId: string) =>
  data.equipment.filter((item) => item.partId === customFittingPartId(definitionId));
/** Catalog and custom instance counts, which have separate limits. */
export function equipmentCounts(data: Pick<ConstructionData, 'equipment'>) {
  const custom = data.equipment.filter((item) => isCustomFittingPartId(item.partId)).length;
  return { catalog: data.equipment.length - custom, custom };
}

/** Whether `adding` fits: catalog instances and design-local instances have separate limits. */
export function equipmentOverLimit(data: Pick<ConstructionData, 'equipment'>, adding: readonly Pick<ConstructionEquipment, 'partId'>[], catalogLimit: number): boolean {
  const now = equipmentCounts(data),
    more = equipmentCounts({ equipment: adding as ConstructionEquipment[] });
  return (more.catalog > 0 && now.catalog + more.catalog > catalogLimit) || (more.custom > 0 && now.custom + more.custom > CUSTOM_FITTING_LIMITS.instances);
}
/** The hull-piece record the shared shape helpers understand. */
export const solidPrimitive = (solid: ConstructionFittingSolid): ConstructionPrimitive => {
  const { paint: _, ...shape } = solid;
  return shape;
};
/** Closed outward polygons of one solid in fitting-local metres: the same recipes the editor draws hull blocks with. */
export function fittingSolidFaces(solid: ConstructionFittingSolid): Vec3[][] {
  const part = solidPrimitive(solid);
  let faces: Vec3[][];
  if (part.mesh) faces = meshFaces(part.mesh, part.size).map((face) => face.points);
  else if (part.kind === 'vertex' && part.shaping) faces = shapedFaces({ ...part, position: [0, 0, 0], rotationDeg: 0, tilt: undefined }).map((face) => face.points);
  else if (part.kind === 'vertex') {
    const corners = cornerVertices(part);
    faces = VERTEX_FACES.flatMap((face) => {
      // The compiler's unbiased face-center fan, so warped faces enclose the same volume.
      const ring = face.corners.map((i) => corners[i].map((n, k) => n * part.size[k]) as Vec3);
      const center = ring.reduce((sum, v) => sum.map((n, k) => n + v[k] / 4) as Vec3, [0, 0, 0] as Vec3);
      return ring.map((v, i) => [v, ring[(i + 1) % 4], center]);
    });
  } else {
    const shape = CONSTRUCTION_SHAPES[part.kind];
    if (!shape || (CUSTOM_FITTING_EXCLUDED_KINDS as readonly string[]).includes(part.kind)) throw new Error(`solid ${solid.id} is a ${part.kind}; hull-only shapes cannot be fittings`);
    faces = shape.map((face) => face.map((point) => point.map((n, k) => n * part.size[k]) as Vec3));
  }
  return faces.map((face) => face.map((point) => primitivePoint(part, point)));
}

const finite = (v: unknown, limit: number): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit);
const paintOk = (paint: unknown) => paint === undefined || (typeof paint === 'string' && paint.length > 0 && paint.length <= 64);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
type Box = { center: Vec3; size: Vec3 };
/** At most `limit` boxes. Sorted along `axis` (stable), the neighbouring pair whose union adds the least empty
 * volume merges first, the earliest pair on ties. Mirrors `merged` in `construction_custom_fittings.rs` exactly. */
export function mergeFittingBoxes(input: Box[], limit: number, axis: number): Box[] {
  const boxes = [...input].sort((a, b) => a.center[axis] - b.center[axis]);
  const volume = (s: Vec3) => s[0] * s[1] * s[2];
  const union = (a: Box, b: Box): Box => {
    const lo = [0, 1, 2].map((k) => Math.min(a.center[k] - a.size[k] / 2, b.center[k] - b.size[k] / 2));
    const hi = [0, 1, 2].map((k) => Math.max(a.center[k] + a.size[k] / 2, b.center[k] + b.size[k] / 2));
    return { center: [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) as Vec3, size: [0, 1, 2].map((k) => hi[k] - lo[k]) as Vec3 };
  };
  while (boxes.length > limit) {
    let best = Infinity,
      at = 0;
    for (let i = 0; i < boxes.length - 1; i++) {
      const added = volume(union(boxes[i], boxes[i + 1]).size) - volume(boxes[i].size) - volume(boxes[i + 1].size);
      if (added < best) [best, at] = [added, i];
    }
    boxes.splice(at, 2, union(boxes[at], boxes[at + 1]));
  }
  return boxes;
}
class Bounds {
  lo: Vec3 = [Infinity, Infinity, Infinity];
  hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  point(p: Vec3, pad = 0) {
    for (let k = 0; k < 3; k++) {
      this.lo[k] = Math.min(this.lo[k], p[k] - pad);
      this.hi[k] = Math.max(this.hi[k], p[k] + pad);
    }
  }
  box(): Box {
    return { center: this.lo.map((n, k) => (n + this.hi[k]) / 2) as Vec3, size: this.hi.map((n, k) => n - this.lo[k]) as Vec3 };
  }
}

/** One definition as a synthesized catalog deck fitting. Throws the first fault, worded as the native diagnostic is. */
export function resolveCustomFitting(def: ConstructionFittingDefinition): ConstructionEquipmentPart {
  return resolvedCustomFitting(def).part;
}
/** A resolved definition with what the design budgets count. */
export interface ResolvedCustomFitting {
  part: ConstructionEquipmentPart;
  /** Solid faces, tubes and mesh triangles: what one instance draws. Solid faces are counted from the display
   * polygons, which can differ slightly from the native count of convex-cell faces. */
  triangles: number;
  meshTriangles: number;
  meshBytes: number;
}
/** Mesh-bearing definitions by record: resolving decodes and splits every mesh, and source records are replaced,
 * never edited in place. */
const resolvedMeshParts = new WeakMap<ConstructionFittingDefinition, ResolvedCustomFitting>();
export function resolvedCustomFitting(def: ConstructionFittingDefinition): ResolvedCustomFitting {
  if (!def.meshes?.length) return resolveDefinition(def);
  let hit = resolvedMeshParts.get(def);
  if (!hit) resolvedMeshParts.set(def, (hit = resolveDefinition(def)));
  return { ...hit, part: structuredClone(hit.part) };
}
function resolveDefinition(def: ConstructionFittingDefinition): ResolvedCustomFitting {
  const meshes = def.meshes ?? [];
  if (def.version !== 1 && def.version !== 2) throw new Error('has an unsupported version; this build reads versions 1 and 2');
  if (def.version === 1 && (meshes.length || def.centerOfGravity !== undefined)) throw new Error('has meshes or a centerOfGravity, which need version 2; set "version": 2');
  if (typeof def.name !== 'string' || !def.name.length || def.name.length > 80) throw new Error('needs a name of 1–80 characters');
  if (def.attach !== 'deck') throw new Error(`attaches to ${JSON.stringify(def.attach)}; this build supports "deck" only`);
  const L = CUSTOM_FITTING_LIMITS;
  if (def.solids.length > L.solids || def.tubes.length > L.tubes)
    throw new Error(`has ${def.solids.length} solids and ${def.tubes.length} tubes; the limits are ${L.solids} solids and ${L.tubes} tubes`);
  if (meshes.length > L.meshes) throw new Error(`has ${meshes.length} meshes; the limit is ${L.meshes}`);
  if (!def.solids.length && !def.tubes.length && !meshes.length) throw new Error('needs at least one solid, tube or mesh');
  const ids = new Set<string>();
  for (const { id } of [...def.solids, ...def.tubes, ...meshes]) {
    if (!ID.test(id)) throw new Error(`has a solid, tube or mesh ID ${JSON.stringify(id)} that is not 1–64 letters, digits, '-' or '_'`);
    if (ids.has(id)) throw new Error(`repeats the solid, tube or mesh ID ${id}`);
    ids.add(id);
  }
  if (meshes.length && def.massKg === undefined) throw new Error('has meshes, which have no volume to weigh; give it a massKg');
  const density = CUSTOM_FITTING_MATERIALS[def.material ?? 'steel'];
  if (!density) throw new Error(`has the unknown material ${JSON.stringify(def.material)}; use steel, aluminium, brass or wood`);
  const fill = def.fill ?? 1;
  if (!Number.isFinite(fill) || fill < 0.01 || fill > 1) throw new Error('needs a fill of 0.01–1');
  let volume = 0,
    triangles = 0;
  const first: Vec3 = [0, 0, 0];
  const all = new Bounds(),
    solidBoxes: Box[] = [],
    segmentBoxes: Box[] = [],
    tubeBoxes: Box[] = [];
  for (const solid of def.solids) {
    if (!finite(solid.size, 500) || solid.size.some((n) => n < 0.01) || !finite(solid.position, L.localM) || !Number.isFinite(solid.rotationDeg) || Math.abs(solid.rotationDeg) > 3600 || !paintOk(solid.paint))
      throw new Error(`solid ${solid.id} has invalid dimensions (0.01–500 m), shape, rotation, paint or a position beyond ${L.localM} m`);
    const bounds = new Bounds();
    let solidVolume = 0;
    for (const face of fittingSolidFaces(solid)) {
      triangles += Math.max(0, face.length - 2);
      face.forEach((point) => bounds.point(point));
      for (let i = 1; i < face.length - 1; i++) {
        const [a, b, c] = [face[0], face[i], face[i + 1]];
        const tetra = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        solidVolume += tetra;
        for (let k = 0; k < 3; k++) first[k] += (tetra * (a[k] + b[k] + c[k])) / 4;
      }
    }
    if (!(solidVolume > 1e-9)) throw new Error(`solid ${solid.id} encloses no volume`);
    volume += solidVolume;
    const box = bounds.box();
    solidBoxes.push(box);
    all.point(bounds.lo);
    all.point(bounds.hi);
  }
  for (const tube of def.tubes) {
    const points = tube.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > L.tubePoints || points.some((p) => !finite(p, L.localM)) || !Number.isFinite(tube.diameterM) || tube.diameterM < 0.01 || tube.diameterM > 2 || !paintOk(tube.paint))
      throw new Error(`tube ${tube.id} needs 2–${L.tubePoints} finite points within ${L.localM} m, a diameter of 0.01–2 m and a paint name of at most 64 bytes`);
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]));
    if (lengths.some((n) => n < 0.01) || lengths.reduce((a, b) => a + b, 0) > L.tubeLengthM)
      throw new Error(`tube ${tube.id} needs segments of at least 1 cm and a total length of at most ${L.tubeLengthM} m`);
    const radius = tube.diameterM / 2,
      bounds = new Bounds();
    lengths.forEach((length, i) => {
      const a = points[i],
        b = points[i + 1],
        segment = Math.PI * radius * radius * length;
      volume += segment;
      for (let k = 0; k < 3; k++) first[k] += (segment * (a[k] + b[k])) / 2;
      const span = new Bounds();
      span.point(a, radius);
      span.point(b, radius);
      segmentBoxes.push(span.box());
      bounds.point(span.lo);
      bounds.point(span.hi);
    });
    tubeBoxes.push(bounds.box());
    all.point(bounds.lo);
    all.point(bounds.hi);
    triangles += (points.length - 1) * TUBE_SIDES * 2 + 2 * (TUBE_SIDES - 2);
  }
  let meshTriangles = 0,
    meshBytes = 0,
    area = 0;
  const areaFirst: Vec3 = [0, 0, 0],
    meshBoxes: Box[] = [];
  for (const mesh of meshes) {
    const decoded = decodeFittingMesh(mesh, L.localM);
    meshTriangles += decoded.triangles.length / 3;
    meshBytes += mesh.data.length;
    const moments = fittingMeshAreaMoments(decoded);
    area += moments.area;
    for (let k = 0; k < 3; k++) areaFirst[k] += moments.first[k];
    for (const box of fittingMeshBoxes(decoded)) {
      all.point(box.center.map((n, k) => n - box.size[k] / 2) as Vec3);
      all.point(box.center.map((n, k) => n + box.size[k] / 2) as Vec3);
      meshBoxes.push(box);
    }
  }
  if (meshBytes > L.designMeshBytes) throw new Error(`carries ${meshBytes} encoded mesh bytes; a design holds at most ${L.designMeshBytes}`);
  if (meshes.length && !(area > 1e-9)) throw new Error('has meshes with no surface area');
  const { center, size } = all.box();
  if (size.some((n) => n > L.localM)) throw new Error(`spans more than ${L.localM} m`);
  if (all.lo[1] > 0.05) throw new Error(`starts ${all.lo[1].toFixed(3)} m above its datum; the lowest solid, tube or mesh must reach local y = 0, where the fitting seats on the deck`);
  const massKg = def.massKg ?? volume * density * fill;
  if (!Number.isFinite(massKg) || massKg < 0.001 || massKg > 1_000_000) throw new Error(`weighs ${massKg.toFixed(4)} kg; the mass must be 0.001–1,000,000 kg`);
  // Meshes have no volume: their area centroid stands for the whole definition.
  let centerOfGravity: Vec3;
  if (def.centerOfGravity !== undefined) {
    const cg = def.centerOfGravity;
    if (!Array.isArray(cg) || cg.length !== 3 || cg.some((n, k) => !Number.isFinite(n) || n < all.lo[k] - 0.01 || n > all.hi[k] + 0.01))
      throw new Error("has a centerOfGravity outside its shapes' bounds");
    centerOfGravity = [...cg];
  } else centerOfGravity = (meshes.length ? areaFirst.map((n) => n * (1 / area)) : first.map((n) => n / volume)) as Vec3;
  const text = JSON.stringify(def);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  const shapes = solidBoxes.length + meshBoxes.length;
  const part: ConstructionEquipmentPart = {
    id: customFittingPartId(def.id),
    name: def.name,
    kind: 'deck-fitting',
    size,
    boundsCenter: center,
    centerOfGravity,
    massKg,
    placement: 'deck',
    fitting:
      shapes + segmentBoxes.length <= L.boxes
        ? [...solidBoxes, ...meshBoxes, ...segmentBoxes]
        : shapes + tubeBoxes.length <= L.boxes
          ? [...solidBoxes, ...meshBoxes, ...tubeBoxes]
          : mergeFittingBoxes([...solidBoxes, ...meshBoxes, ...tubeBoxes], L.boxes, [1, 2].reduce((best, k) => (size[k] > size[best] ? k : best), 0)),
    modelUrl: `/models/components/design-local/${def.id}`,
    // Display identity only (geometry caches); the native compiler hashes the definition itself.
    contentHash: `design-${(hash >>> 0).toString(16)}-${text.length}`,
  };
  return { part, triangles: triangles + meshTriangles, meshTriangles, meshBytes };
}

/** What a design spends of the visual mesh budgets. Unresolvable definitions count nothing; the compiler names them. */
export function customFittingBudgets(data: Pick<ConstructionData, 'fittings' | 'equipment'>) {
  let meshTriangles = 0,
    meshBytes = 0,
    renderedTriangles = 0;
  for (const def of customFittingDefinitions(data)) {
    let resolved: ResolvedCustomFitting;
    try {
      resolved = resolvedCustomFitting(def);
    } catch {
      continue;
    }
    meshTriangles += resolved.meshTriangles;
    meshBytes += resolved.meshBytes;
    renderedTriangles += resolved.triangles * customFittingInstances(data, def.id).length;
  }
  return { meshTriangles, meshBytes, renderedTriangles };
}
/** The fault the native compiler will report for this definition, or undefined when it resolves. */
export function customFittingFault(def: ConstructionFittingDefinition): string | undefined {
  try {
    resolveCustomFitting(def);
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

const definitionOfPart = new WeakMap<ConstructionEquipmentPart, ConstructionFittingDefinition>();
/** The source definition behind a synthesized part of an effective catalog; undefined for published parts. */
export const customFittingDefinitionOfPart = (part: ConstructionEquipmentPart | undefined) => (part ? definitionOfPart.get(part) : undefined);
const resolved = new WeakMap<ConstructionCatalog, { definitions: readonly ConstructionFittingDefinition[]; key: string; catalog: ConstructionCatalog }>();
/** The catalog every part lookup of one design uses: the published parts plus that design's own
 * definitions. Identity is stable while the definitions are unchanged. Unresolvable definitions are
 * left out (their instances then read as missing parts); the compiler names the fault.
 * Never send this to the compiler: it takes the published catalog and resolves definitions itself. */
export function effectiveConstructionCatalog(data: Pick<ConstructionData, 'fittings'>, catalog: ConstructionCatalog): ConstructionCatalog {
  const definitions = customFittingDefinitions(data);
  const published = catalog.equipment.some((part) => isCustomFittingPartId(part.id)) ? publishedConstructionCatalog(catalog) : catalog;
  if (!definitions.length) return published;
  const cached = resolved.get(published);
  // The same table is the same catalog; a rebuilt table is compared by content (meshes make that text long).
  if (cached?.definitions === definitions) return cached.catalog;
  const key = JSON.stringify(definitions);
  if (cached?.key === key) return (cached.definitions = definitions), cached.catalog;
  const seen = new Set<string>(),
    parts: ConstructionEquipmentPart[] = [];
  for (const def of definitions.slice(0, CUSTOM_FITTING_LIMITS.definitions)) {
    if (!ID.test(def.id) || seen.has(def.id)) continue;
    seen.add(def.id);
    try {
      const part = resolveCustomFitting(def);
      definitionOfPart.set(part, def);
      parts.push(part);
    } catch {
      // Reported by the compiler as a `custom-fitting` diagnostic naming the definition.
    }
  }
  const effective = { ...published, equipment: [...published.equipment, ...parts] };
  stripped.set(effective, published);
  resolved.set(published, { definitions, key, catalog: effective });
  return effective;
}
const stripped = new WeakMap<ConstructionCatalog, ConstructionCatalog>();
/** The catalog as published, without any design-local parts. */
export function publishedConstructionCatalog(catalog: ConstructionCatalog): ConstructionCatalog {
  if (!catalog.equipment.some((part) => isCustomFittingPartId(part.id))) return catalog;
  let plain = stripped.get(catalog);
  if (!plain) stripped.set(catalog, (plain = { ...catalog, equipment: catalog.equipment.filter((part) => !isCustomFittingPartId(part.id)) }));
  return plain;
}

/** A new definition ID unused by any source row. */
export function newCustomFittingId(data: ConstructionData, base: string): string {
  const used = new Set([...data.primitives, ...data.equipment, ...data.boundaries, ...data.loads, ...customFittingDefinitions(data)].map((row) => row.id));
  const stem = base.replace(/-copy(-\d+)?$/, '').slice(0, 56);
  for (let n = 1; ; n++) {
    const id = n === 1 ? `${stem}-copy` : `${stem}-copy-${n}`;
    if (!used.has(id)) return id;
  }
}
