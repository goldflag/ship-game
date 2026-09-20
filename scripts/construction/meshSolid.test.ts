import { expect, test } from 'bun:test';
import { meshToSolid } from './meshSolid';
import type { MeshTriangle } from './meshFile';

type V = [number, number, number];
/** A closed, outward-wound axis-aligned box as twelve triangles. */
function box(lo: V, hi: V, group?: string): MeshTriangle[] {
  const c = (i: number): V => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const quads: [number, number, number, number][] = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  return quads.flatMap(q => [
    { a: c(q[0]), b: c(q[1]), c: c(q[2]), ...(group ? { group } : {}) },
    { a: c(q[0]), b: c(q[2]), c: c(q[3]), ...(group ? { group } : {}) },
  ]);
}
/** A closed surface over a set of unit cells on a lattice: neighbouring cells share whole faces,
 * so dropping every face that appears twice leaves exactly the union's boundary. That is how a
 * modeller would hand over an L or a tunnel — one shell, not several overlapping ones. */
function cells(...at: [number, number, number][]): MeshTriangle[] {
  const key = (t: MeshTriangle) => [t.a, t.b, t.c].map(v => v.join(':')).sort().join('|');
  const all = at.flatMap(([x, y, z]) => box([x, y, z], [x + 1, y + 1, z + 1]));
  const counts = new Map<string, number>();
  for (const t of all) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  return all.filter(t => counts.get(key(t)) === 1);
}
const column = (x: number, y: number): [number, number, number] => [x, y, 0];

test('a convex box imports as one part whose envelope is the box', () => {
  const report = meshToSolid(box([0, 0, 0], [2, 4, 6], 'skin'), { label: 'Box' });
  expect(report.parts).toBe(1);
  expect(report.size.map(n => Math.round(n))).toEqual([2, 4, 6]);
  expect(report.center).toEqual([1, 2, 3]);
  expect(report.volumeM3).toBeCloseTo(48, 6);
  expect(report.solid.parts[0].faces).toHaveLength(6);
  expect(new Set(report.solid.parts[0].faces.map(f => f.group))).toEqual(new Set(['skin']));
  // The frame is normalized, which is what the compiler requires.
  expect(Math.max(...report.solid.vertices.flat().map(Math.abs))).toBeCloseTo(0.5, 9);
});

test('a concave L decomposes into interior-disjoint convex parts that keep the volume', () => {
  const mesh = cells(column(0, 0), column(0, 1), column(0, 2), column(1, 0), column(2, 0));
  const report = meshToSolid(mesh, { label: 'L' });
  expect(report.parts).toBeGreaterThan(1);
  expect(report.parts).toBeLessThanOrEqual(4);
  expect(report.volumeM3).toBeCloseTo(5, 6);
  expect(report.size.map(n => Math.round(n))).toEqual([3, 3, 1]);
});

test('a tunnel keeps its hole: the parts enclose the ring, not the bore', () => {
  const ring = ([0, 1, 2] as const).flatMap(x => ([0, 1, 2] as const).map(y => column(x, y))).filter(([x, y]) => x !== 1 || y !== 1);
  const mesh = cells(...ring);
  const report = meshToSolid(mesh, { label: 'Tunnel' });
  expect(report.volumeM3).toBeCloseTo(8, 6);
  expect(report.parts).toBeGreaterThanOrEqual(4);
});

test('a thin plate survives welding at its own scale', () => {
  const report = meshToSolid(box([0, 0, 0], [20, 0.02, 5]), { label: 'Plate' });
  expect(report.parts).toBe(1);
  expect(report.volumeM3).toBeCloseTo(2, 6);
  expect(report.size[1]).toBeCloseTo(0.02, 9);
});

test('an inside-out mesh is reversed rather than refused, and says so', () => {
  const flipped = box([0, 0, 0], [1, 1, 1]).map(t => ({ a: t.a, b: t.c, c: t.b }));
  const report = meshToSolid(flipped, { label: 'Flipped' });
  expect(report.volumeM3).toBeCloseTo(1, 6);
  expect(report.notes.join(' ')).toContain('inside-out');
});

test('degenerate, open, non-manifold and self-intersecting inputs are refused by name', () => {
  expect(() => meshToSolid([], { label: 'Empty' })).toThrow('at least four triangles');
  const flat: MeshTriangle[] = Array.from({ length: 4 }, () => ({ a: [0, 0, 0] as V, b: [1, 0, 0] as V, c: [2, 0, 0] as V }));
  expect(() => meshToSolid(flat, { label: 'Flat' })).toThrow();
  const open = box([0, 0, 0], [1, 1, 1]).slice(0, 10);
  expect(() => meshToSolid(open, { label: 'Open' })).toThrow('not watertight');
  // Two boxes that interpenetrate are two shells, not one solid.
  const crossing = [...box([0, 0, 0], [2, 2, 2]), ...box([1.3, 1.1, 1.2], [3, 3, 3])];
  expect(() => meshToSolid(crossing, { label: 'Crossing' })).toThrow('intersects itself');
  const tooMany = cells(column(0, 0), column(0, 1), column(1, 0));
  expect(() => meshToSolid(tooMany, { label: 'L', maxPlanes: 4 })).toThrow('distinct face planes');
});

test('the same mesh imports to the same source every time', () => {
  const mesh = cells(column(0, 0), column(0, 1), column(0, 2), column(1, 0), column(2, 0)).map(t => ({ ...t, group: t.a[1] > 1.5 || t.b[1] > 1.5 || t.c[1] > 1.5 ? 'leg' : 'foot' }));
  const once = meshToSolid(mesh, { label: 'L' }), twice = meshToSolid(mesh, { label: 'L' });
  expect(JSON.stringify(once.solid)).toBe(JSON.stringify(twice.solid));
  expect(once.solid.parts.flatMap(p => p.faces.map(f => f.group)).filter(Boolean).length).toBeGreaterThan(0);
});
