import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { mirroredPrimitive } from '../../ships/constructionEditor';
import { normalizedBearing, snapCoordinate } from './editorNumbers';
import type { BuilderPlacement } from './primitiveGeometry';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { customHullFaces, customHullPrimitive, makeHull } from '../../ships/customHullModel';
import { CORNER_SIGNS, VERTEX_FACES } from '../../ships/constructionVertex';

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
  const key = `${piece.shape}:${piece.size.join(',')}:${piece.rotationDeg}`;
  let faces = hullFacesCache.get(key);
  if (!faces) {
    faces = piece.shape === 'custom-hull'
      ? customHullFaces({ ...customHullPrimitive(makeHull(0)), size: piece.size }).map(face => face.vertices.map(v => rotateY(v, piece.rotationDeg * Math.PI / 180)))
      : (piece.shape === 'vertex' ? VERTEX_SHAPE : CONSTRUCTION_SHAPES[piece.shape]).map(face => face.map(vertex => rotateY(vertex.map((v, i) => v * piece.size[i]) as Vec3, piece.rotationDeg * Math.PI / 180)));
    if (hullFacesCache.size >= 32) hullFacesCache.delete(hullFacesCache.keys().next().value!);
    hullFacesCache.set(key, faces);
  }
  return faces;
}

/** Axis-aligned extents of a piece in ship coordinates. */
export function pieceExtents(piece: BuilderPlacement): Vec3 {
  if (piece.kind === 'boundary') return [0, 0, 0];
  if (piece.kind === 'hull') return Math.round(piece.rotationDeg / 90) % 2 ? [piece.size[2], piece.size[1], piece.size[0]] : [...piece.size];
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
export function placementCenter(piece: BuilderPlacement, hit: PlacementHit, step: number): Vec3 {
  const normal = hit.normal;
  const axis = dominantAxis(normal), sign = Math.sign(normal[axis]) || 1;
  if (piece.kind === 'boundary') {
    const offset = snapCoordinate(hit.point[{ x: 0, y: 1, z: 2 }[piece.axis]], step);
    return hit.point.map((value, index) => index === { x: 0, y: 1, z: 2 }[piece.axis] ? offset : value) as Vec3;
  }
  const extents = pieceExtents(piece);
  if (piece.kind === 'hull') {
    const center = hit.point.map((value, index) => index === axis
      ? value + sign * extents[index] / 2
      : snapCoordinate(value - extents[index] / 2 - (hit.snapOrigin?.[index] ?? 0), step) + extents[index] / 2 + (hit.snapOrigin?.[index] ?? 0)) as Vec3;
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
  if (piece.propellerDiameterM && normal[1] < -0.5) {
    const diameter = piece.propellerDiameterM;
    // Hang the complete blade sweep below the hull; native compilation extends
    // the forward shaft and braces to actual closed hull faces after placement.
    return hit.point.map((value, index) => index === 1
      ? value - diameter * .65
      : snapCoordinate(value - attach[index], step)) as Vec3;
  }
  // Vertical hits seat the attachment point on the face; wall hits push the whole envelope off the face.
  const center = rotateY(piece.boundsCenter, bearingRadians(piece.bearingDeg));
  return hit.point.map((value, index) => index === axis
    ? (axis === 1 ? value + sign * inset - attach[index] : value + sign * (extents[index] / 2 + inset) - center[index])
    : snapCoordinate(value - attach[index], step)) as Vec3;
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

/** The existing piece that mirrors this one across the centerline: another piece, or itself when it straddles the centerline. */
export function mirrorTwin(source: ConstructionSource, primitive: ConstructionPrimitive): ConstructionPrimitive | undefined {
  const expected = mirroredPrimitive(primitive);
  const matches = (candidate: ConstructionPrimitive) => candidate.kind === expected.kind && JSON.stringify(candidate.vertices) === JSON.stringify(expected.vertices) && JSON.stringify(candidate.customHull) === JSON.stringify(expected.customHull) && sameVector(candidate.size, expected.size)
    && sameVector(candidate.position, expected.position) && near(normalizedBearing(candidate.rotationDeg), expected.rotationDeg);
  return source.construction.primitives.find(candidate => candidate.id !== primitive.id && matches(candidate)) ?? (matches(primitive) ? primitive : undefined);
}
export function mirrorTwinEquipment(source: ConstructionSource, part: ConstructionEquipment): ConstructionEquipment | undefined {
  return source.construction.equipment.find(candidate => candidate.id !== part.id && candidate.partId === part.partId
    && sameVector(candidate.position, [-part.position[0], part.position[1], part.position[2]]) && near(normalizedBearing(candidate.bearingDeg), normalizedBearing(-part.bearingDeg)));
}
/** True when a mirrored placement would land somewhere else than the original. */
export const offCenterline = (position: Vec3) => Math.abs(position[0]) > 1e-6;
