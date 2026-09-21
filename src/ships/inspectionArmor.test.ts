import { expect, test } from 'bun:test';
import type { Armor, Vec3 } from './blueprint';
import { inspectionArmor } from './inspectionArmor';

const half = (id: string, vertices: Vec3[], thicknessMm = 100): Armor => ({
  id, name: 'Hull panel', center: [0, 0, 0], size: [2, 2, 1], thicknessMm,
  plate: { surfaceId: 'hull:port:0', material: 'Wh', exterior: true, vertices },
});
const a = half('a', [[0, 0, 0], [2, 0, 0], [2, 2, .2]]);
const b = half('b', [[0, 0, 0], [2, 2, .2], [0, 2, 0]]);

test('a viewer quad retains its original diagonal and source IDs in either input order', () => {
  for (const input of [[a, b], [b, a]]) {
    const result = inspectionArmor(input);
    expect(result).toHaveLength(1);
    expect(result[0].ids).toEqual(input.map(a => a.id));
    const points = result[0].armor.plate!.vertices;
    const triangle = (vertices: Vec3[]) => vertices.map(v => v.join(',')).sort().join(';');
    expect([triangle([points[0], points[1], points[2]]), triangle([points[0], points[2], points[3]])].sort())
      .toEqual(input.map(a => triangle(a.plate!.vertices)).sort());
    expect(result[0].armor.center).toEqual([1, 1, .1]);
    expect(result[0].armor.size).toEqual([2, 2, .2]);
  }
});

test('separate armor properties, authorship and disconnected pieces stay separate', () => {
  const variants: Armor[] = [
    { ...b, thicknessMm: 200 },
    { ...b, plate: { ...b.plate!, material: 'steel' } },
    { ...b, plate: { ...b.plate!, surfaceId: 'hull:port:1' } },
    { ...b, plate: { ...b.plate!, surfaceId: undefined } },
    { ...b, plate: { ...b.plate!, mountId: 'turret' } },
    half('disconnected', b.plate!.vertices.map(([x, y, z]) => [x + 5, y, z])),
    half('overlapping', a.plate!.vertices),
  ];
  for (const other of variants) expect(inspectionArmor([a, other]).map(p => p.armor)).toEqual([a, other]);
});

test('clipped faces with more pieces are not filled into a rectangle across an opening', () => {
  const extra = half('third', [[0, 3, 0], [2, 3, 0], [0, 4, 0]]);
  expect(inspectionArmor([a, b, extra]).map(p => p.armor)).toEqual([a, b, extra]);
});
