import type { ConstructionBalcony, ConstructionBalconyPoint, ConstructionPrimitive, Vec3 } from './blueprint';

export const defaultBalcony = (): ConstructionBalcony => ({
  version: 1, heightM: 1.1, wallThicknessM: .06,
  points: [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, z], i) => ({ id: `corner-${i + 1}`, x, z, edge: i === 3 ? 'open' : 'wall' })),
});
/** The initial open side faces the ship centerline, including rotated placements. */
export function placementBalcony(position: Vec3, rotationDeg: number): ConstructionBalcony {
  const balcony = defaultBalcony(), angle = rotationDeg * Math.PI / 180;
  const side = Math.sign(position[0]) || 1;
  const inward = [-side * Math.cos(angle), -side * Math.sin(angle)];
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const edge = directions.reduce((best, direction, i) => direction[0] * inward[0] + direction[1] * inward[1] > directions[best][0] * inward[0] + directions[best][1] * inward[1] ? i : best, 0);
  balcony.points.forEach((point, i) => { point.edge = i === edge ? 'open' : 'wall'; });
  return balcony;
}
type Point = Pick<ConstructionBalconyPoint, 'x' | 'z'>;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const onSegment = (a: Point, b: Point, c: Point) => Math.abs(cross(a, b, c)) < 1e-9 && c.x >= Math.min(a.x, b.x) - 1e-9 && c.x <= Math.max(a.x, b.x) + 1e-9 && c.z >= Math.min(a.z, b.z) - 1e-9 && c.z <= Math.max(a.z, b.z) + 1e-9;

/** Ear clipping preserves concave outlines. Native compilation repeats validation. */
export function balconyTriangles(points: Point[]): number[][] {
  if (points.length < 3 || points.length > 32) throw new Error('Use 3–32 outline points.');
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) > 2 || Math.abs(a.z) > 2) throw new Error('Keep outline points within twice the block width and length.');
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-6) throw new Error('Move overlapping points apart.');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) throw new Error('Outline edges cross. Move the points apart.');
    }
  }
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.z - b.x * a.z; }, 0);
  if (Math.abs(area) < 1e-8) throw new Error('The platform needs a closed outline with area.');
  const ring = points.map((_, i) => i); if (area < 0) ring.reverse();
  const triangles: number[][] = [];
  while (ring.length > 3) {
    const ear = ring.findIndex((b, i) => {
      const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
      return cross(points[a], points[b], points[c]) > 1e-10 && !ring.some(k => k !== a && k !== b && k !== c && cross(points[a], points[b], points[k]) >= -1e-10 && cross(points[b], points[c], points[k]) >= -1e-10 && cross(points[c], points[a], points[k]) >= -1e-10);
    });
    if (ear < 0) throw new Error('Simplify the outline or move points apart.');
    triangles.push([ring[(ear + ring.length - 1) % ring.length], ring[ear], ring[(ear + 1) % ring.length]]); ring.splice(ear, 1);
  }
  triangles.push(ring); return triangles;
}

export function balconyProblem(balcony: ConstructionBalcony): string | undefined {
  try { balconyTriangles(balcony.points); } catch (error) { return (error as Error).message; }
  if (balcony.heightM < .2 || balcony.heightM > 5) return 'Edge height must be 0.2–5 m.';
  if (balcony.wallThicknessM < .01 || balcony.wallThicknessM > .5) return 'Wall thickness must be 0.01–0.5 m.';
}

/** Shared corner offsets keep the deck under every edge and mitre adjoining walls.
 * Bound sharp corners to avoid long spikes on narrow or nearly reversing edges. */
export function balconyPlan(size: Vec3, balcony: ConstructionBalcony) {
  const points = balcony.points.map(p => ({ x: p.x * size[0], z: p.z * size[2] }));
  const n = points.length;
  const sign = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % n].z - points[(i + 1) % n].x * p.z, 0) > 0 ? 1 : -1;
  const lengths = points.map((p, i) => Math.hypot(points[(i + 1) % n].x - p.x, points[(i + 1) % n].z - p.z));
  const normals = points.map((p, i) => ({ x: sign * (points[(i + 1) % n].z - p.z) / lengths[i], z: -sign * (points[(i + 1) % n].x - p.x) / lengths[i] }));
  const half = balcony.wallThicknessM / 2;
  const offsets = normals.map((b, i) => {
    const previous = (i + n - 1) % n, a = normals[previous], denominator = 1 + a.x * b.x + a.z * b.z;
    if (denominator < 1e-8) return { x: b.x * half, z: b.z * half };
    const x = (a.x + b.x) * half / denominator, z = (a.z + b.z) * half / denominator;
    const scale = Math.min(1, Math.min(half * 4, Math.min(lengths[previous], lengths[i]) * .45) / Math.hypot(x, z));
    return { x: x * scale, z: z * scale };
  });
  const deck = points.map((p, i) => ({ x: p.x + offsets[i].x, z: p.z + offsets[i].z }));
  const walls = points.map((p, i) => {
    const j = (i + 1) % n, q = points[j];
    const end = (index: number, neighbor: number) => balcony.points[neighbor].edge === 'wall' ? offsets[index] : { x: normals[i].x * half, z: normals[i].z * half };
    const a = end(i, (i + n - 1) % n), b = end(j, j);
    return [{ x: p.x + a.x, z: p.z + a.z }, { x: q.x + b.x, z: q.z + b.z }, { x: q.x - b.x, z: q.z - b.z }, { x: p.x - a.x, z: p.z - a.z }];
  });
  return { deck, walls };
}

/** Display-only faces. Rust derives the union, weight, armor and collision geometry. */
export function balconyFaces(size: Vec3, balcony = defaultBalcony()): Vec3[][] {
  const points = balcony.points, faces: Vec3[][] = [], top = size[1] / 2;
  let triangles: number[][];
  try { triangles = balconyTriangles(points); } catch { return []; }
  const plan = balconyPlan(size, balcony);
  const at = (i: number, y: number): Vec3 => [plan.deck[i].x, y, plan.deck[i].z];
  for (const [a, b, c] of triangles) { faces.push([at(c, top), at(b, top), at(a, top)], [at(a, -top), at(b, -top), at(c, -top)]); }
  const positive = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.z - b.x * a.z; }, 0) > 0;
  const box = (center: Vec3, dimensions: Vec3, yaw = 0) => {
    const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(q => {
      const [x, y, z] = q.map((n, k) => n * dimensions[k] / 2); return [center[0] + Math.cos(yaw) * x + Math.sin(yaw) * z, center[1] + y, center[2] - Math.sin(yaw) * x + Math.cos(yaw) * z] as Vec3;
    });
    for (const f of [[3,2,1,0],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]]) faces.push(f.map(i => v[i]));
  };
  points.forEach((p, i) => {
    const j = (i + 1) % points.length;
    const a: Vec3 = [p.x * size[0], top, p.z * size[2]], b: Vec3 = [points[j].x * size[0], top, points[j].z * size[2]];
    const side = [at(i, -top), at(i, top), at(j, top), at(j, -top)]; faces.push(positive ? side : side.reverse());
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), height = balcony.heightM;
    const center: Vec3 = [(a[0] + b[0]) / 2, top + height / 2, (a[2] + b[2]) / 2];
    if (p.edge === 'wall') {
      const outline = positive ? [...plan.walls[i]].reverse() : plan.walls[i];
      const bottom = outline.map(p => [p.x, top, p.z] as Vec3), upper = outline.map(p => [p.x, top + height, p.z] as Vec3);
      faces.push(upper, [...bottom].reverse());
      for (let k = 0; k < 4; k++) { const next = (k + 1) % 4; faces.push([bottom[k], bottom[next], upper[next], upper[k]]); }
    }
    if (p.edge === 'railing' || p.edge === 'triple-railing') {
      const count = Math.min(64, Math.max(1, Math.ceil(length / 2)));
      for (let k = 0; k <= count; k++) box([a[0] + dx * k / count, center[1], a[2] + dz * k / count], [.04, height, .04], yaw);
      for (const fraction of p.edge === 'railing' ? [.5, 1] : [1 / 3, 2 / 3, 1]) box([center[0], top + height * fraction - .02, center[2]], [.04, .04, length], yaw);
    }
  });
  return faces;
}

export function mirroredBalcony(primitive: ConstructionPrimitive): ConstructionBalcony {
  const source = primitive.balcony ?? defaultBalcony();
  // Reflection preserves point IDs and the outgoing edge associated with each point.
  return { ...structuredClone(source), points: source.points.map(p => ({ ...p, x: -p.x })) };
}
