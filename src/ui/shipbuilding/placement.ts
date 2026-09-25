import { seatBalconyCenter } from './balconyPlacement';
import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { mirroredPrimitive } from '../../ships/constructionEditor';
import { orientVector } from '../../ships/constructionOrientation';
import { balconyFaces } from '../../ships/constructionBalcony';
import { normalizedBearing, gridCoordinate } from './editorNumbers';
import type { BuilderPlacement } from './builderScene';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { customHullFaces, customHullPrimitive } from '../../ships/customHullModel';
import { makeHull } from '../../ships/customHullStarter';
import { CORNER_SIGNS, VERTEX_FACES, cornerVertices } from '../../ships/constructionVertex';

/** An unwarped vertex hull is the unit box; its warped corners live on the source piece. */
const VERTEX_SHAPE: Vec3[][] = VERTEX_FACES.map(face => face.corners.map(i => CORNER_SIGNS[i].map(v => v / 2) as Vec3));

/** Placement arithmetic for the cursor ghost: pieces sit on the face under the
 * pointer, snapped to the grid in the face plane. Rust still validates the result. */
export interface PlacementHit { point: Vec3; normal: Vec3; snapOrigin?: Vec3 }

/** Resolve a rendered pick against its compiler-authored support surface. */
export function physicalPlacementHit(hit: PlacementHit, surface?: Pick<ConstructionSurface, 'normal' | 'vertices'>): PlacementHit {
  if (!surface) return hit;
  // GPU vertices are Float32; their ray hits can lie just outside the exact
  // solid. Use the native plane and normal for physical placement, retaining
  // the picked side when inspecting an interior face.
  const n = surface.normal;
  const squaredLength = n.reduce((sum, value) => sum + value * value, 0);
  const distance = hit.point.reduce((sum, value, i) => sum + (value - surface.vertices[0][i]) * n[i], 0) / squaredLength;
  const sign = hit.normal.reduce((sum, value, i) => sum + value * n[i], 0) < 0 ? -1 : 1;
  return { ...hit, point: hit.point.map((value, i) => value - distance * n[i]) as Vec3, normal: n.map(value => value * sign) as Vec3 };
}

export const dominantAxis = (normal: Vec3): 0 | 1 | 2 => {
  const [x, y, z] = normal.map(Math.abs);
  return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
};
export function rotateY(vector: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return [vector[0] * cos + vector[2] * sin, vector[1], -vector[0] * sin + vector[2] * cos];
}
/** Bearings are clockwise from the bow; three.js rotation.y is counter-clockwise. */
export const bearingRadians = (bearingDeg: number) => -bearingDeg * Math.PI / 180;

const hullFacesCache = new Map<string, Vec3[][]>();
function hullFaces(piece: Extract<BuilderPlacement, { kind: 'hull' }>): Vec3[][] {
  const key = `${piece.shape}:${piece.size.join(',')}:${piece.rotationDeg}:${piece.tilt?.pitchDeg ?? 0}:${piece.tilt?.rollDeg ?? 0}`;
  let faces = hullFacesCache.get(key);
  if (!faces) {
    faces = piece.shape === 'balcony' ? balconyFaces(piece.size).filter(face => face.every(v => v[1] <= piece.size[1] / 2)).map(face => face.map(v => orientVector(piece, v))) : piece.shape === 'custom-hull'
      ? customHullFaces({ ...customHullPrimitive(makeHull()), size: piece.size }).map(face => face.vertices.map(v => orientVector(piece, v)))
      : (piece.shape === 'vertex' ? VERTEX_SHAPE : CONSTRUCTION_SHAPES[piece.shape]).map(face => face.map(vertex => orientVector(piece, vertex.map((v, i) => v * piece.size[i]) as Vec3)));
    if (hullFacesCache.size >= 32) hullFacesCache.delete(hullFacesCache.keys().next().value!);
    hullFacesCache.set(key, faces);
  }
  return faces;
}

/** Axis-aligned extents of a piece in ship coordinates. */
export function pieceExtents(piece: BuilderPlacement): Vec3 {
  if (piece.kind === 'boundary') return [0, 0, 0];
  if (piece.kind === 'hull') {
    // Ghost blocks turn in quarter turns about any ship axis, so each local axis lands on one ship axis.
    const extents: Vec3 = [0, 0, 0];
    piece.size.forEach((length, local) => orientVector(piece, [+(local === 0), +(local === 1), +(local === 2)]).forEach((n, k) => { extents[k] += Math.abs(n) * length; }));
    return extents.map(value => Math.round(value * 1e9) / 1e9) as Vec3;
  }
  const cos = Math.abs(Math.cos(bearingRadians(piece.bearingDeg))), sin = Math.abs(Math.sin(bearingRadians(piece.bearingDeg)));
  return [piece.size[0] * cos + piece.size[2] * sin, piece.size[1], piece.size[0] * sin + piece.size[2] * cos];
}

/** The point of a fitting that meets its support: the attachment socket, else the base of its bounds. */
export function attachmentOffset(part: Pick<ConstructionEquipmentPart, 'sockets' | 'boundsCenter' | 'size'>, bearingDeg: number): Vec3 {
  const socket = part.sockets?.find(socket => socket.id === 'attachment')?.position;
  const local: Vec3 = socket ? [...socket] : [part.boundsCenter[0], part.boundsCenter[1] - part.size[1] / 2, part.boundsCenter[2]];
  return rotateY(local, bearingRadians(bearingDeg));
}

/** Where the piece's datum goes so that it rests on the hit face. */
export function placementCenter(piece: BuilderPlacement, hit: PlacementHit, step: number | null): Vec3 {
  const normal = hit.normal;
  const axis = dominantAxis(normal), sign = Math.sign(normal[axis]) || 1;
  if (piece.kind === 'boundary') {
    const offset = gridCoordinate(hit.point[{ x: 0, y: 1, z: 2 }[piece.axis]], step);
    return hit.point.map((value, index) => index === { x: 0, y: 1, z: 2 }[piece.axis] ? offset : value) as Vec3;
  }
  const extents = pieceExtents(piece);
  if (piece.kind === 'hull') {
    const center = hit.point.map((value, index) => index === axis
      ? value + sign * extents[index] / 2
      : step === null ? value : gridCoordinate(value - extents[index] / 2 - (hit.snapOrigin?.[index] ?? 0), step) + extents[index] / 2 + (hit.snapOrigin?.[index] ?? 0)) as Vec3;
    if (piece.shape === 'balcony' && Math.abs(normal[1]) < .9) return seatBalconyCenter(piece, center, hit.point, normal);
    const faces = hullFaces(piece);
    const dot = (v: Vec3) => v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2];
    let support = Infinity;
    for (const face of faces) for (const vertex of face) support = Math.min(support, dot(vertex));
    const hasContactFace = faces.some(face => face.every(point => Math.abs(dot(point) - support) < 1e-7));
    // A tangent sphere (or a pointed/edge contact) needs a small physical seat.
    // Flat mating faces retain exact face-to-face placement. Keep the two grid
    // coordinates and resolve only the coordinate normal to the hit plane.
    const seat = hasContactFace ? 0 : Math.min(.05, Math.min(...piece.size) * .05);
    center[axis] += (dot(hit.point) - dot(center) - support - seat) / normal[axis];
    return center;
  }
  const attach = attachmentOffset(piece, piece.bearingDeg), inset = piece.inset ?? 0;
  if (piece.wall) {
    const position = hit.point.map((v, k) => k === axis ? v - attach[k] : gridCoordinate(v - attach[k], step)) as Vec3;
    position[axis] -= position.reduce((sum, v, k) => sum + (v + attach[k] - hit.point[k]) * normal[k], 0) / normal[axis];
    return position;
  }
  if (piece.propellerDiameterM && normal[1] < -0.5) {
    const diameter = piece.propellerDiameterM;
    // Hang the complete blade sweep below the hull; native compilation extends
    // the forward shaft and braces to actual closed hull faces after placement.
    return hit.point.map((value, index) => index === 1
      ? value - diameter * .65
      : gridCoordinate(value - attach[index], step)) as Vec3;
  }
  // Vertical hits seat the attachment point on the face; wall hits push the whole envelope off the face.
  const center = rotateY(piece.boundsCenter, bearingRadians(piece.bearingDeg));
  const position = hit.point.map((value, index) => index === axis
    ? (axis === 1 ? value + sign * inset - attach[index] : value + sign * (extents[index] / 2 + inset) - center[index])
    : gridCoordinate(value - attach[index], step)) as Vec3;
  // Snapping X/Z changes the deck height on a slope. Seat the socket at the
  // snapped location while retaining the fitting's authored vertical inset.
  if (axis === 1) position[1] -= ((position[0] + attach[0] - hit.point[0]) * normal[0]
    + (position[2] + attach[2] - hit.point[2]) * normal[2]) / normal[1];
  return position;
}

/** A rectangle of pieces between two placements, stepping by the piece's own extents in the face plane. */
export function fillLattice(start: Vec3, end: Vec3, extents: Vec3, axis: 0 | 1 | 2, limit = 128): Vec3[] {
  const points: Vec3[] = [];
  const [a, b] = [0, 1, 2].filter(index => index !== axis) as [number, number];
  const steps = (index: number) => extents[index] > 0 ? Math.floor(Math.abs(end[index] - start[index]) / extents[index] + 1e-6) : 0;
  const direction = (index: number) => Math.sign(end[index] - start[index]) || 1;
  for (let i = 0; i <= steps(a); i++) for (let j = 0; j <= steps(b); j++) {
    if (points.length >= limit) return points;
    const point = [...start] as Vec3;
    point[a] = start[a] + direction(a) * i * extents[a];
    point[b] = start[b] + direction(b) * j * extents[b];
    points.push(point.map(value => Number(value.toFixed(6))) as Vec3);
  }
  return points;
}

/** Advance by complete piece footprints from the last placed point. Sub-footprint
 * pointer samples accumulate instead of inserting overlapping pieces. */
export function strokeSegment(previous: Vec3, next: Vec3, extents: Vec3, axis: 0 | 1 | 2, limit = 128): Vec3[] {
  const [a, b] = [0, 1, 2].filter(index => index !== axis) as [number, number];
  const distance = Math.max(...[a, b].map(index => extents[index] > 0 ? Math.abs(next[index] - previous[index]) / extents[index] : 0));
  const count = Math.min(limit, Math.floor(distance + 1e-6));
  const points: Vec3[] = [];
  for (let step = 1; step <= count; step++) {
    const point = [...next] as Vec3;
    for (const index of [a, b]) point[index] = Number((previous[index] + (next[index] - previous[index]) * step / distance).toFixed(6));
    points.push(point);
  }
  return points;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameVector = (a: Vec3, b: Vec3) => a.every((value, index) => near(value, b[index]));

/** Pieces by kind and rounded position, so a twin lookup does not scan a 10,000-piece design. */
const twinIndexes = new WeakMap<ConstructionPrimitive[], { count: number; cells: Map<string, ConstructionPrimitive[]> }>();
const TWIN_CELL = 1e4;
const twinCell = (kind: string, cell: number[]) => `${kind}|${cell.map(n => n || 0).join(',')}`;
function twinCandidates(primitives: ConstructionPrimitive[], expected: ConstructionPrimitive): ConstructionPrimitive[] {
  let index = twinIndexes.get(primitives);
  if (!index || index.count !== primitives.length) {
    index = { count: primitives.length, cells: new Map() };
    for (const p of primitives) { const key = twinCell(p.kind, p.position.map(v => Math.round(v * TWIN_CELL))), cell = index.cells.get(key); if (cell) cell.push(p); else index.cells.set(key, [p]); }
    twinIndexes.set(primitives, index);
  }
  // A position within the matching tolerance of a cell edge may round either way.
  const [xs, ys, zs] = expected.position.map(v => [...new Set([Math.round((v - 1e-6) * TWIN_CELL), Math.round((v + 1e-6) * TWIN_CELL)])]);
  return xs.flatMap(x => ys.flatMap(y => zs.flatMap(z => index.cells.get(twinCell(expected.kind, [x, y, z])) ?? [])));
}
const UNIT_AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** Pitch, yaw and roll name one orientation in more than one way, so twins compare the turned axes. */
const sameOrientation = (a: ConstructionPrimitive, b: ConstructionPrimitive) => UNIT_AXES.every(axis => sameVector(orientVector(a, axis), orientVector(b, axis)));
const sameCorners = (a: Vec3[], b: Vec3[]) => a.length === b.length && a.every((corner, i) => sameVector(corner, b[i]));
/** A cage without corners of its own is the unit cube, which its reflection spells out. */
const sameShape = (a: ConstructionPrimitive, b: ConstructionPrimitive) => (['mesh', 'customHull', 'shaping', 'balcony'] as const).every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]))
  && (a.kind !== 'vertex' || !!a.mesh || sameCorners(cornerVertices(a), cornerVertices(b)));

/** The existing piece that mirrors this one across the centerline: another piece, or itself when it straddles the centerline. `claimed` twins belong to another piece of the same edit. */
export function mirrorTwin(source: ConstructionSource, primitive: ConstructionPrimitive, claimed?: ReadonlySet<string>): ConstructionPrimitive | undefined {
  const expected = mirroredPrimitive(primitive);
  const matches = (candidate: ConstructionPrimitive) => candidate.kind === expected.kind && sameVector(candidate.size, expected.size) && sameVector(candidate.position, expected.position) && sameOrientation(candidate, expected) && sameShape(candidate, expected);
  return twinCandidates(source.construction.primitives, expected).find(candidate => candidate.id !== primitive.id && !claimed?.has(candidate.id) && matches(candidate)) ?? (matches(primitive) ? primitive : undefined);
}
export function mirrorTwinEquipment(source: ConstructionSource, part: ConstructionEquipment): ConstructionEquipment | undefined {
  return source.construction.equipment.find(candidate => candidate.id !== part.id && candidate.partId === part.partId
    && sameVector(candidate.position, [-part.position[0], part.position[1], part.position[2]]) && near(normalizedBearing(candidate.bearingDeg), normalizedBearing(-part.bearingDeg)));
}
/** True when a mirrored placement would land somewhere else than the original. */
export const offCenterline = (position: Vec3) => Math.abs(position[0]) > 1e-6;
