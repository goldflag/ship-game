import { bilgeKeelError } from './constructionBilgeKeels';
import { hullPaintBandsError } from './hullPaintBands';
import { constructionShipPaint, isConstructionSurfaceFinish } from './constructionPaints';
import { mirroredOrientation } from './constructionOrientation';
import { mirroredIndices } from './freeformShape';
import { mirroredBalcony } from './constructionBalcony';
import { cornerVertices } from './constructionVertex';
import { mirroredWall } from './constructionWallFittings';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import { outlineTopologyError } from './customHullTopology';
import type { ConstructionEquipment, ConstructionSource, ConstructionPrimitive, ConstructionSurface, ConstructionSurfaceAssignment, Vec3 } from './blueprint';
import { normalizedBearing } from '../ui/shipbuilding/editorNumbers';
import { CONSTRUCTION_SHAPES, shapeMirror } from './constructionShapes';
import { ConstructionStoreError, readConstructionSource, type ConstructionRevision, type ConstructionStore } from './constructionStore';
import { loadConstructionCatalog, removeRetiredDeckFittings } from './constructionEquipment';

export const CONSTRUCTION_FACES = ['port', 'starboard', 'bottom', 'top', 'bow', 'stern', 'slope'] as const;
export type ConstructionFace = ConstructionSurfaceAssignment['face'];
export const newConstructionId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const surfaceKey = (primitiveId: string, face: string, panelId?: string) => panelId === undefined ? `${primitiveId}:${face}` : `${primitiveId}:${encodeURIComponent(panelId)}:${face}`;
export const surfaceSelectionKey = (surface: Pick<ConstructionSurface, 'primitiveId' | 'face' | 'panelId'>) => surfaceKey(surface.primitiveId, surface.face, surface.panelId);
/** Source bounds, mirrored from the native compiler (crates/naval-sim/src/construction.rs). */
export const CONSTRUCTION_LIMITS = { primitives: 10_000, surfaces: 65_536, equipment: 128, boundaries: 24 } as const;

/** Native equipment supports stay visible but are not editable hull source assignments. */
export function editableConstructionSurfaces(source: ConstructionSource, surfaces: readonly ConstructionSurface[]): ConstructionSurface[] {
  const primitiveIds = new Set(source.construction.primitives.map(primitive => primitive.id));
  return surfaces.filter(surface => primitiveIds.has(surface.primitiveId) && CONSTRUCTION_FACES.includes(surface.face as ConstructionFace));
}

/** Compiled faces with the source's current assignments over them: between an edit and its compile, the last
 * compile's geometry can stay up showing the new thickness, paint or opening. A custom hull panel inherits its
 * whole face's assignment when it has none of its own, as the compiler does. */
export function projectConstructionSurfaces(source: ConstructionSource, surfaces: readonly ConstructionSurface[]): ConstructionSurface[] {
  const assignments = new Map(source.construction.surfaces.map(surface => [surfaceSelectionKey(surface), surface]));
  const primitiveIds = new Set(source.construction.primitives.map(primitive => primitive.id));
  return surfaces.map(surface => {
    if (!primitiveIds.has(surface.primitiveId)) return surface;
    const assignment = assignments.get(surfaceSelectionKey(surface)) ?? (surface.panelId !== undefined ? assignments.get(surfaceKey(surface.primitiveId, surface.face)) : undefined);
    // Match the native skin minimum and defaults, including when undo removes an assignment.
    const thicknessMm = Math.max(assignment?.thicknessMm ?? source.construction.defaultThicknessMm, source.construction.defaultThicknessMm);
    const material = assignment?.material ?? 'steel', paint = assignment?.paint ?? constructionShipPaint(source), open = !!assignment?.open;
    return surface.thicknessMm === thicknessMm && surface.material === material && surface.paint === paint && surface.open === !!open ? surface : { ...surface, thicknessMm, material, paint, open: !!open };
  });
}

/** Syntax check for safe editing only. Rust retains all geometry, fit, loading and launch validation. */
export function decodeConstructionSource(value: unknown): ConstructionSource {
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    return value as Record<string, unknown>;
  };
  const string = (value: unknown, path: string) => { if (typeof value !== 'string') throw new Error(`${path} must be text`); };
  const number = (value: unknown, path: string) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be finite`); };
  const vector = (value: unknown, path: string) => { if (!Array.isArray(value) || value.length !== 3) throw new Error(`${path} needs three coordinates`); value.forEach(v => number(v, path)); };
  const rows = (value: unknown, path: string) => { if (!Array.isArray(value)) throw new Error(`${path} must be an array`); return value.map(v => object(v, path)); };
  const source = object(value, 'Source');
  if (source.schemaVersion !== 1 || source.coordinates !== 'meters-y-up-bow-negative-z') throw new Error('Unsupported source version or coordinates');
  for (const key of ['id', 'name', 'revision']) string(source[key], key);
  const data = object(source.construction, 'Construction');
  if (data.version !== 1 && data.version !== 2) throw new Error('Unsupported construction source version');
  string(data.catalogRevision, 'Catalog'); number(data.defaultThicknessMm, 'Skin thickness');
  for (const p of rows(data.primitives, 'Primitives')) {
    string(p.id, 'Primitive ID'); vector(p.size, 'Primitive size'); vector(p.position, 'Primitive position'); number(p.rotationDeg, 'Primitive rotation');
    if (p.smoothGroup !== undefined) string(p.smoothGroup, 'Smooth group');
    if (typeof p.kind !== 'string' || (p.kind !== 'vertex' && p.kind !== 'custom-hull' && p.kind !== 'balcony' && !Object.hasOwn(CONSTRUCTION_SHAPES, p.kind))) throw new Error('Unsupported primitive kind');
    if (p.kind === 'balcony') {
      const balcony = object(p.balcony, 'Balcony');
      if (balcony.version !== 1) throw new Error('Unsupported balcony version');
      number(balcony.heightM, 'Edge height'); number(balcony.wallThicknessM, 'Wall thickness');
      const points = rows(balcony.points, 'Balcony points');
      if (points.length < 3 || points.length > 32) throw new Error('Balconies require 3–32 outline points');
      const ids = new Set<string>();
      for (const point of points) {
        string(point.id, 'Point ID'); number(point.x, 'Point X'); number(point.z, 'Point Z');
        if (ids.has(point.id as string) || !['open', 'wall', 'railing', 'triple-railing'].includes(String(point.edge))) throw new Error('Invalid balcony point identity or edge');
        ids.add(point.id as string);
      }
    } else if (p.balcony !== undefined) throw new Error('Balcony data belongs to a balcony block');
    if (p.tilt !== undefined) {
      const tilt = object(p.tilt, 'Block tilt');
      if (tilt.version !== 1) throw new Error('Unsupported block tilt version');
      for (const key of ['pitchDeg', 'rollDeg']) { number(tilt[key], key); if (Math.abs(tilt[key] as number) > 3600) throw new Error('Block tilt must be within ±3600°'); }
    }
    if (p.kind === 'custom-hull') {
      const hull = object(p.customHull, 'Custom hull');
      if (hull.version !== 1) throw new Error('Unsupported custom hull version');
      if (hull.redPaintY !== undefined) { number(hull.redPaintY, 'Red paint Y'); if (Math.abs(hull.redPaintY as number) > 500) throw new Error('Red paint Y must be between −500 and 500 m'); }
      if (hull.paintBands !== undefined) { const error = hullPaintBandsError(hull.paintBands); if (error) throw new Error(error); }
      if (hull.bilgeKeels !== undefined) { const keel = object(hull.bilgeKeels, 'Bilge keels'); const error = bilgeKeelError(keel as unknown as import('./blueprint').ConstructionBilgeKeels); if (error) throw new Error(error); }
      number(hull.rake, 'Bow rake'); number(hull.bulb, 'Bow bulb');
      const stations = rows(hull.stations, 'Hull sections');
      if (stations.length < 4 || stations.length > 24) throw new Error('Custom hulls require 4–24 sections');
      for (const station of stations) {
        string(station.id, 'Section ID'); number(station.t, 'Section position');
        const points = rows(station.points, 'Section points');
        for (const point of points) { number(point.x, 'Point X'); number(point.y, 'Point Y'); if (point.contour !== undefined) number(point.contour, 'Outline position'); }
      }
      const topology = outlineTopologyError(stations as unknown as import('./blueprint').ConstructionHullStation[]);
      if (topology) throw new Error(topology);
    } else if (p.customHull !== undefined) throw new Error('Section data belongs to a custom hull');
    if(p.mesh !== undefined) {
      const mesh=object(p.mesh,'Freeform topology');
      if(p.kind!=='vertex'||p.vertices!==undefined||p.shaping!==undefined||mesh.version!==1||!['prism','rings','polyhedron'].includes(String(mesh.family)))throw new Error('Unsupported freeform topology');
      string(mesh.label,'Shape label');
      if((mesh.label as string).length>80)throw new Error('Shape label is too long');
      if(!Array.isArray(mesh.vertices)||mesh.vertices.length<4||mesh.vertices.length>256||!Array.isArray(mesh.reference)||mesh.reference.length!==mesh.vertices.length)throw new Error('Freeform requires 4–256 vertices and matching mirror references');
      mesh.vertices.forEach(v=>vector(v,'Freeform vertex'));mesh.reference.forEach(v=>vector(v,'Mirror reference'));
      const index=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<(mesh.vertices as unknown[]).length;
      const faces=rows(mesh.faces,'Freeform faces'),ids=new Set<string>();
      if(faces.length<4||faces.length>256)throw new Error('Freeform requires 4–256 faces');
      for(const f of faces){string(f.id,'Face ID');if((f.id as string).length>80||ids.has(f.id as string)||!CONSTRUCTION_FACES.includes(f.name as ConstructionFace)||!Array.isArray(f.corners)||f.corners.length<3||f.corners.length>64||!f.corners.every(index)||new Set(f.corners).size!==f.corners.length)throw new Error('Invalid freeform face');ids.add(f.id as string);}
      if(!Array.isArray(mesh.rings)||mesh.rings.length>24||mesh.rings.some(r=>!Array.isArray(r)||!r.length||r.length>64||!r.every(index)))throw new Error('Invalid freeform rings');
    }
    if (p.shaping !== undefined) {
      const shape=object(p.shaping,'Freeform shaping');
      if(p.kind!=='vertex'||shape.version!==1||!['round','chamfer'].includes(String(shape.style)))throw new Error('Unsupported freeform shaping');
      number(shape.radius,'Radius');
      if(!Array.isArray(shape.edges)||shape.edges.length>12||shape.edges.some(e=>!Number.isInteger(e)||e<0||e>11)||new Set(shape.edges).size!==shape.edges.length)throw new Error('Invalid edge treatment selection');
    }
    if (p.vertices !== undefined) {
      if (p.kind !== 'vertex' || !Array.isArray(p.vertices) || p.vertices.length !== 8) throw new Error('Vertex hulls require eight local corners');
      p.vertices.forEach(v => vector(v, 'Hull corner'));
    }
  }
  if (data.finish !== undefined && !isConstructionSurfaceFinish(data.finish)) throw new Error('Unsupported surface finish');
  if (data.paint !== undefined && (typeof data.paint !== 'string' || !data.paint.length || data.paint.length > 64)) throw new Error('Ship paint must be a name of at most 64 characters');
  for (const surface of rows(data.surfaces, 'Surfaces')) {
    string(surface.primitiveId, 'Surface primitive'); string(surface.paint, 'Paint'); number(surface.thicknessMm, 'Armor thickness');
    if (!CONSTRUCTION_FACES.includes(surface.face as ConstructionFace) || !['steel', 'armor-steel'].includes(surface.material as string)) throw new Error('Unsupported surface face or material');
    if (surface.panelId !== undefined && (typeof surface.panelId !== 'string' || !surface.panelId.length || surface.panelId.length > 512 || !data.primitives || !(data.primitives as ConstructionPrimitive[]).some(p => p.id === surface.primitiveId && p.kind === 'custom-hull'))) throw new Error('Panel assignments require a custom hull and a bounded panel ID');
    if (surface.open !== undefined && typeof surface.open !== 'boolean') throw new Error('Opening must be true or false');
  }
  for (const part of rows(data.equipment, 'Equipment')) {
    string(part.id, 'Equipment ID'); string(part.partId, 'Equipment variant'); vector(part.position, 'Equipment position'); number(part.bearingDeg, 'Equipment bearing');
    if (part.wall !== undefined) {
      const wall = object(part.wall, 'Wall fitting');
      if (wall.version !== 1) throw new Error('Unsupported wall fitting version');
      for (const key of ['widthM', 'heightM']) { number(wall[key], key); if ((wall[key] as number) < .15 || (wall[key] as number) > 5) throw new Error('Wall fitting dimensions must be 0.15–5 m'); }
      if (wall.mirrorId !== undefined && (typeof wall.mirrorId !== 'string' || wall.mirrorId === part.id)) throw new Error('Invalid wall mirror partner');
      if (wall.turnDeg !== undefined && ![90, 180, 270].includes(wall.turnDeg as number)) throw new Error('Wall fittings turn in quarter turns of 90, 180 or 270°');
    }
    if (part.gun !== undefined) {
      const gun = object(part.gun, 'Gun installation');
      if (gun.battery !== undefined && !['main', 'secondary'].includes(gun.battery as string)) throw new Error('Unsupported gun battery');
      for (const key of ['barbetteHeightM', 'initialElevationDeg', 'traverseDeg', 'elevationMinDeg', 'elevationMaxDeg']) if (gun[key] !== undefined) number(gun[key], key);
      if (gun.traverseLimitsDeg !== undefined) {
        if (!Array.isArray(gun.traverseLimitsDeg) || gun.traverseLimitsDeg.length !== 2) throw new Error('Gun traverse limits require two angles');
        gun.traverseLimitsDeg.forEach(value => number(value, 'Gun traverse limit'));
      }
    }
    if (part.launcher !== undefined) {
      const launcher = object(part.launcher, 'Launcher installation');
      const angles = (value: unknown) => {
        if (!Array.isArray(value) || value.length !== 2) throw new Error('Launcher limits require two angles');
        value.forEach(v => number(v, 'Launcher angle'));
      };
      angles(launcher.traverseLimitsDeg);
      if (!Array.isArray(launcher.launchArcsDeg) || launcher.launchArcsDeg.length < 1 || launcher.launchArcsDeg.length > 8) throw new Error('Launcher requires 1–8 firing arcs');
      launcher.launchArcsDeg.forEach(angles);
    }
    if (part.path !== undefined) {
      const path = object(part.path, 'Equipment path');
      if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > 64) throw new Error('Equipment paths require 2–64 points');
      path.points.forEach(point => vector(point, 'Path point'));
      if (path.access !== undefined) {
        const access = object(path.access, 'Ladder settings');
        for (const [key,min,max] of [['widthM',.35,1.5],['standOffM',.12,.4],['grabHeightM',0,1.2]] as const) { number(access[key], key); if ((access[key] as number)<min || (access[key] as number)>max) throw new Error(`Invalid ladder ${key}`); }
        if (!['both','left','right','none'].includes(access.handrails as string)) throw new Error('Choose both, left, right or no handrails');
      }
      if (path.slackM !== undefined) number(path.slackM, 'Rope slack');
      if (path.heightM !== undefined) {
        number(path.heightM, 'Railing height');
        if ((path.heightM as number) < .3 || (path.heightM as number) > 3) throw new Error('Railing height must be between 0.3 and 3 m');
      }
      if (path.railCount !== undefined && path.railCount !== 2 && path.railCount !== 3) throw new Error('Choose two or three rails');
    }
    for (const link of ['magazineId', 'powerSourceId']) if (part[link] !== undefined) string(part[link], link);
  }
  for (const wall of rows(data.boundaries, 'Boundaries')) {
    string(wall.id, 'Boundary ID'); number(wall.offset, 'Boundary offset'); number(wall.thicknessMm, 'Boundary thickness');
    if (!['x', 'y', 'z'].includes(wall.axis as string)) throw new Error('Unsupported boundary axis');
  }
  for (const load of rows(data.loads, 'Loads')) {
    string(load.id, 'Load ID'); string(load.name, 'Load name'); vector(load.center, 'Load center'); vector(load.size, 'Load size'); number(load.massKg, 'Load mass');
  }
  return structuredClone(value) as ConstructionSource;
}

export function decodeSavedConstruction(revision: ConstructionRevision, catalogRevision = revision.catalogRevision): ConstructionSource {
  const source = readConstructionSource(revision, { schemaVersion: 1, catalogRevision, decode: decodeConstructionSource }).source;
  if (source.id !== (revision.sourceId ?? revision.designId)) throw new ConstructionStoreError('corrupt', 'The source and saved design identities disagree. Recover an earlier revision; the original is preserved.');
  if (source.construction.catalogRevision !== revision.catalogRevision) throw new ConstructionStoreError('catalog', 'The source and saved catalog identities disagree. Recover an earlier revision; the original is preserved.');
  return source;
}

export async function loadSavedConstruction(store: ConstructionStore, designId: string, catalogRevision?: string) {
  const saved = await store.load(designId);
  return { ...saved, source: decodeSavedConstruction(saved.revision, catalogRevision) };
}

/** Resolve the saved immutable catalog before showing any of its equipment dimensions. */
export async function loadSavedConstructionWithCatalog(store: ConstructionStore, designId: string, resolveCatalog = loadConstructionCatalog) {
  const saved = await loadSavedConstruction(store, designId);
  let catalog;
  try { catalog = await resolveCatalog(saved.revision.catalogRevision); }
  catch (cause) { throw new ConstructionStoreError('catalog', `The saved equipment revision could not be loaded. ${cause instanceof Error ? cause.message : String(cause)}. Download the original or recover a compatible revision; no equipment was substituted.`, { cause }); }
  if (!removeRetiredDeckFittings(saved.source)) return { ...saved, catalog };
  const source = saved.source;
  source.revision = newConstructionId('revision');
  // Keep the original immutable revision and use the normal CAS save, including
  // account storage IDs, so opening a stale tab cannot overwrite another edit.
  const revision = await store.save({ designId: saved.head.id, name: source.name, source,
    schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision,
    expectedRevisionId: saved.head.revisionId });
  return { source, catalog, revision, head: { ...saved.head, revisionId: revision.id, updatedAt: revision.createdAt } };
}

export function removeConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>): void {
  // Bulk deletion leaves the oldest hull block and its face assignments intact.
  const keep = source.construction.primitives.every(part => selected.has(part.id)) ? source.construction.primitives[0]?.id : undefined;
  source.construction.primitives = source.construction.primitives.filter(part => !selected.has(part.id) || part.id === keep);
  source.construction.surfaces = source.construction.surfaces.filter(surface => !selected.has(surface.primitiveId) || surface.primitiveId === keep);
  const removed = new Set(selected);
  for (const part of source.construction.equipment) if (selected.has(part.id) && part.wall?.mirrorId) removed.add(part.wall.mirrorId);
  source.construction.equipment = source.construction.equipment.filter(part => !removed.has(part.id));
  source.construction.boundaries = source.construction.boundaries.filter(wall => !selected.has(wall.id));
  source.construction.loads = source.construction.loads.filter(load => !selected.has(load.id));
  // Keep references in other equipment as editable fit errors rather than silently reconnecting systems.
}

export function moveConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, delta: Vec3): void {
  for (const item of source.construction.primitives) if (selected.has(item.id)) item.position = item.position.map((v, axis) => v + delta[axis]) as Vec3;
  const moved = new Set<string>();
  for (const item of source.construction.equipment) if (selected.has(item.id) && !moved.has(item.id)) {
    item.position = item.position.map((v, axis) => v + delta[axis]) as Vec3;
    moved.add(item.id);
    const twin = source.construction.equipment.find(p => p.id === item.wall?.mirrorId);
    if (twin) { twin.position = [-item.position[0], item.position[1], item.position[2]]; moved.add(twin.id); }
  }
  for (const load of source.construction.loads) if (selected.has(load.id)) load.center = load.center.map((v, axis) => v + delta[axis]) as Vec3;
}

export function rotateConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, angle = 90): void {
  for (const part of source.construction.primitives) if (selected.has(part.id)) part.rotationDeg = normalizedBearing(part.rotationDeg + angle);
  for (const part of source.construction.equipment) if (selected.has(part.id) && !part.wall) part.bearingDeg = normalizedBearing(part.bearingDeg + angle);
}

/** Source transform, not physical derivation. Corner profiles require an X/Z swap when reflected. */
export function mirroredPrimitive(primitive: ConstructionPrimitive): ConstructionPrimitive {
  if (primitive.kind === 'balcony') return { ...structuredClone(primitive), position: [-primitive.position[0], primitive.position[1], primitive.position[2]], ...mirroredOrientation(primitive), balcony: mirroredBalcony(primitive) };
  if(primitive.mesh){
    const out=structuredClone(primitive),m=out.mesh!;
    out.position[0]*=-1;Object.assign(out,mirroredOrientation(primitive));
    m.vertices.forEach(v=>v[0]*=-1);m.reference.forEach(v=>v[0]*=-1);
    m.faces.forEach(f=>{f.corners.reverse();if(f.name==='port')f.name='starboard';else if(f.name==='starboard')f.name='port';});
    // Keep corresponding prism outlines in the same winding after reflection.
    if(m.family==='prism')m.rings.forEach(r=>r.reverse());
    return out;
  }
  if (primitive.kind === 'vertex') {
    const out: ConstructionPrimitive = { ...structuredClone(primitive), position: [-primitive.position[0], primitive.position[1], primitive.position[2]], ...mirroredOrientation(primitive), vertices: [1,0,3,2,5,4,7,6].map(i => {const v=cornerVertices(primitive)[i];return [-v[0],v[1],v[2]];}) };
    if(out.shaping) {const s=out.shaping; s.edges=s.edges.map(i=>mirroredIndices('edge',[i],[true,false,false]).find(j=>j!==i)??i); }
    return out;
  }
  const mirror = shapeMirror(primitive.kind);
  return { ...structuredClone(primitive), position: [-primitive.position[0], primitive.position[1], primitive.position[2]],
    size: mirror.swap ? [primitive.size[2], primitive.size[1], primitive.size[0]] : [...primitive.size],
    ...mirroredOrientation(primitive, mirror.yaw) };
}

export function mirroredFace(face: ConstructionFace, kind: ConstructionPrimitive['kind']): ConstructionFace {
  const { yaw } = shapeMirror(kind);
  if (yaw === -90) return ({ port: 'bow', bow: 'port', starboard: 'stern', stern: 'starboard' } as Partial<Record<ConstructionFace, ConstructionFace>>)[face] ?? face;
  if (yaw === 90) return ({ port: 'stern', stern: 'port', starboard: 'bow', bow: 'starboard' } as Partial<Record<ConstructionFace, ConstructionFace>>)[face] ?? face;
  if (yaw === 180) return face === 'bow' ? 'stern' : face === 'stern' ? 'bow' : face;
  return face === 'port' ? 'starboard' : face === 'starboard' ? 'port' : face;
}

export function mirroredEquipment(part: ConstructionEquipment): ConstructionEquipment {
  return { ...structuredClone(part), position: [-part.position[0], part.position[1], part.position[2]], bearingDeg: normalizedBearing(-part.bearingDeg),
    ...(part.wall ? { wall: mirroredWall(part.wall) } : {}),
    ...(part.path ? { path: { ...part.path, ...(part.path.access ? { access: { ...part.path.access, handrails: part.path.access.handrails === 'left' ? 'right' : part.path.access.handrails === 'right' ? 'left' : part.path.access.handrails } } : {}), points: part.path.points.map(point => [-point[0], point[1], point[2]] as Vec3) } } : {}) };
}

export function copyConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, options: { mirror?: boolean; offset?: Vec3; ids?: ReadonlyMap<string, string> } = {}): string[] {
  const data = source.construction;
  const ids = new Map<string, string>();
  for (const item of [...data.primitives, ...data.equipment, ...data.loads]) if (selected.has(item.id)) ids.set(item.id, options.ids?.get(item.id) ?? newConstructionId('part'));
  const position = (v: Vec3): Vec3 => options.mirror ? [-v[0], v[1], v[2]] : v.map((n, i) => n + (options.offset ?? [1, 0, 0])[i]) as Vec3;
  const originals = data.primitives.filter(p => selected.has(p.id));
  const kinds = new Map(originals.map(p => [p.id, p.kind]));
  data.primitives.push(...originals.map(part => ({ ...(options.mirror ? mirroredPrimitive(part) : structuredClone(part)), id: ids.get(part.id)!, position: position(part.position) })));
  data.surfaces.push(...data.surfaces.filter(surface => kinds.has(surface.primitiveId)).map(surface => ({ ...surface, primitiveId: ids.get(surface.primitiveId)!, face: options.mirror ? mirroredFace(surface.face, kinds.get(surface.primitiveId)!) : surface.face, ...(surface.panelId ? { panelId: options.mirror ? mirroredPanelId(surface.panelId) : surface.panelId } : {}) })));
  data.equipment.push(...data.equipment.filter(part => selected.has(part.id)).map(part => ({ ...(options.mirror ? mirroredEquipment(part) : structuredClone(part)), id: ids.get(part.id)!, position: position(part.position),
    ...(part.wall ? { wall: { ...part.wall, mirrorId: undefined } } : {}),
    ...(part.magazineId ? { magazineId: ids.get(part.magazineId) ?? part.magazineId } : {}), ...(part.powerSourceId ? { powerSourceId: ids.get(part.powerSourceId) ?? part.powerSourceId } : {}) })));
  data.loads.push(...data.loads.filter(load => selected.has(load.id)).map(load => ({ ...structuredClone(load), id: ids.get(load.id)!, center: position(load.center) })));
  return [...ids.values()];
}

export function assignConstructionSurfaces(source: ConstructionSource, keys: ReadonlySet<string>, values: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>): void {
  for (const primitive of source.construction.primitives) for (const { face, panelId } of [...CONSTRUCTION_FACES.map(face => ({ face, panelId: undefined })), ...customHullPanels(primitive)]) {
    if (!keys.has(surfaceKey(primitive.id, face, panelId))) continue;
    let assignment = source.construction.surfaces.find(surface => surface.primitiveId === primitive.id && surface.face === face && surface.panelId === panelId);
    if (!assignment) {
      const inherited = source.construction.surfaces.find(surface => surface.primitiveId === primitive.id && surface.face === face && surface.panelId === undefined);
      assignment = { primitiveId: primitive.id, face, thicknessMm: source.construction.defaultThicknessMm, material: 'steel', paint: constructionShipPaint(source), ...inherited, ...(panelId ? { panelId } : {}) };
      source.construction.surfaces.push(assignment);
    }
    Object.assign(assignment, values);
  }
}
