/** Original estimated end closure recipe. Surface locations follow the authored
 * section loft; uniform 20 mm steel is a game estimate, not historical plating.
 * Existing belt/bow/stern armor IDs and protection remain intact. */
import { compileShip, type Vec3 } from '../../../src/ships/blueprint';
import { length, sub } from '../../../src/simulation/geometry';
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const path = new URL('./blueprint.json', import.meta.url);
const b = await Bun.file(path).json();
b.armor = b.armor.filter((a: { id: string }) => !a.id.startsWith('end-closure-'));
function clip(points: Vec3[], axis: number, value: number, sign: number): Vec3[] {
  const out: Vec3[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length], a = sign * (p[axis] - value), c = sign * (q[axis] - value);
    if (a >= 0) out.push(p);
    if ((a < 0) !== (c < 0)) out.push(p.map((v, k) => v + (q[k] - v) * a / (a - c)) as Vec3);
  });
  return out;
}
let count = 0;
const sections = b.hull.sections as { station: number; points: [number, number][] }[];
// Complete structural plating now follows every authored hull section at run
// time. Retire the old partial closure proxies when that coverage is enabled.
for (let i = 1; !b.structuralPlating && i < sections.length; i++) for (let k = 1; k < sections[i].points.length; k++) for (const sign of [-1, 1]) {
  const a = sections[i - 1], c = sections[i];
  const p = (s: typeof a, n: number): Vec3 => [sign * s.points[n][0], s.points[n][1], b.hull.length / 2 - s.station];
  for (const triangle of [[p(a, k - 1), p(c, k - 1), p(c, k)], [p(a, k - 1), p(c, k), p(a, k)]]) {
    // Outside the ends of the old protection envelopes: full closure. Beneath
    // their lower edges: the rising end floor. Regions are disjoint.
    const parts = [clip(triangle, 2, -110.5, -1), clip(triangle, 2, 112, 1),
      clip(clip(clip(triangle, 2, -110.5, 1), 2, -80.2, -1), 1, -.8, -1),
      clip(clip(clip(triangle, 2, 90.5, 1), 2, 112, -1), 1, -.8, -1)];
    for (const polygon of parts) for (let n = 2; n < polygon.length; n++) {
      const vertices = [polygon[0], polygon[n - 1], polygon[n]];
      if (length(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0]))) < 1e-6) continue;
      const lo = [0, 1, 2].map(axis => Math.min(...vertices.map(v => v[axis]))), hi = [0, 1, 2].map(axis => Math.max(...vertices.map(v => v[axis])));
      b.armor.push({ id: `end-closure-${count++}`, name: 'End closure · estimated', center: lo.map((v, j) => (v + hi[j]) / 2), size: lo.map((v, j) => Math.max(.001, hi[j] - v)), thicknessMm: 20,
        plate: { vertices, material: 'steel', exterior: true, surfaceId: 'end-shell' }, provenance: { sourceId: 'authored-hull', basis: 'estimated', note: 'Closes exposed end surfaces of the authored section loft. Uniform 20 mm game estimate; no historical thickness claim.' } });
    }
  }
}
compileShip(b, await Bun.file(new URL('../../parts/guns.json', import.meta.url)).json());
await Bun.write(path, JSON.stringify(b, null, 2) + '\n');
console.log(`Authored ${count} estimated end triangles; ${b.armor.length} total protection surfaces.`);
