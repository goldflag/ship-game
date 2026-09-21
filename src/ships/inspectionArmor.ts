import type { Armor, Vec3 } from './blueprint';
import { dot, sub } from '../game/geometry';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const samePoint = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-7);

/** Rejoin only the two triangles of one authored face. The shared edge must be
 * the fan diagonal, so even a twisted hull panel keeps its original triangles. */
function quad(a: Vec3[], b: Vec3[]): Vec3[] | undefined {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (!samePoint(a[i], b[(j + 1) % 3]) || !samePoint(a[(i + 1) % 3], b[j])) continue;
    const points = [a[i], b[(j + 2) % 3], a[(i + 1) % 3], a[(i + 2) % 3]];
    const n1 = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    const n2 = cross(sub(points[2], points[0]), sub(points[3], points[0]));
    if (dot(n1, n2) <= 0) return;
    const normal = n1.map((v, axis) => v + n2[axis]) as Vec3;
    // Keep concave, overlapping or folded pieces separate.
    if (points.some((p, k) => dot(cross(sub(points[(k + 1) % 4], p), sub(points[(k + 2) % 4], points[(k + 1) % 4])), normal) <= 0)) return;
    return points;
  }
}

/** Presentation only: simulation armor records and their IDs remain untouched. */
export function inspectionArmor(armor: Armor[]): { armor: Armor; ids: string[] }[] {
  const panels = armor.map(a => ({ armor: a, ids: [a.id] }));
  const groups = new Map<string, number[]>(), consumed = new Set<number>();
  armor.forEach((a, i) => {
    const plate = a.plate;
    if (!plate?.surfaceId) return;
    const key = JSON.stringify([plate.surfaceId, a.name, a.thicknessMm, plate.material, plate.mountId, plate.exterior, a.exterior, a.provenance]);
    const group = groups.get(key) ?? [];
    group.push(i); groups.set(key, group);
  });
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    const [i, j] = group, a = armor[i], b = armor[j];
    if (a.plate!.vertices.length !== 3 || b.plate!.vertices.length !== 3) continue;
    const vertices = quad(a.plate!.vertices, b.plate!.vertices);
    if (!vertices) continue;
    const low = [0, 1, 2].map(axis => Math.min(...vertices.map(p => p[axis])));
    const high = [0, 1, 2].map(axis => Math.max(...vertices.map(p => p[axis])));
    panels[i] = { armor: { ...a, plate: { ...a.plate!, vertices },
      center: low.map((v, axis) => (v + high[axis]) / 2) as Vec3,
      size: low.map((v, axis) => Math.max(.00001, high[axis] - v)) as Vec3 }, ids: [a.id, b.id] };
    consumed.add(j);
  }
  return panels.filter((_, i) => !consumed.has(i));
}
