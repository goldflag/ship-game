import type { Vec3 } from '../ships/blueprint';

export const SMOOTH_HULL_SHAPES = new Set(['cylinder', 'half-cylinder', 'quarter-cylinder', 'quarter-cylinder-wall',
  'half-hemisphere', 'quarter-hemisphere', 'sphere', 'hemisphere', 'sphere-octant', 'hemisphere-shell', 'half-hemisphere-shell', 'quarter-hemisphere-shell',
  'parabolic-shell', 'cone', 'hollow-cube', 'concave-corner', 'rounded-bridge', 'rounded-bridge-panel']);

interface Face { vertices: readonly Vec3[]; normal: Vec3; group: string }

/** Panel IDs own paint/armor assignments, not lighting seams. Join the curved
 * strips on each hull side, keeping the deck, keel and end caps sharp. */
export function customHullSmoothingGroup(panel: string): string {
  const edge = panel.split('@')[0];
  const start = Number(edge.split('~')[0]);
  return Number.isFinite(start) && start >= 0 && start < 8 ? (start < 4 ? 'port' : 'starboard') : edge;
}
const key = (point: Vec3, group: string) => `${group}:${point.map(v => Math.round(v * 1e6)).join(',')}`;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Smooth the lighting of adjacent curve facets, keeping caps, rims and separate
 * source parts sharp. Collision and displacement retain the native polygons. */
export function constructionVertexNormals(faces: readonly Face[], minimumDot = .72): (point: Vec3, normal: Vec3, group: string) => Vec3 {
  const neighbors = new Map<string, Vec3[]>();
  for (const face of faces) for (const point of face.vertices) {
    const id = key(point, face.group), normals = neighbors.get(id) ?? [];
    if (!normals.some(n => dot(n, face.normal) > .999999)) normals.push(face.normal);
    neighbors.set(id, normals);
  }
  return (point, normal, group) => {
    const sum: Vec3 = [0, 0, 0];
    for (const n of neighbors.get(key(point, group)) ?? [normal]) if (dot(n, normal) > minimumDot) {
      sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2];
    }
    const length = Math.hypot(...sum) || 1;
    return sum.map(n => n / length) as Vec3;
  };
}
