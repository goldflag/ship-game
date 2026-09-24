import { expect, test } from 'bun:test';
import { coplanarStructureOverlaps, type StructureLike } from './structureOverlap';

const block = (id: string, x0: number, z0: number, x1: number, z1: number, baseY: number, top: number): StructureLike =>
  ({ id, footprint: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], baseY, height: top - baseY });

test('two blocks sharing an exposed top plane are reported with the exposed area', () => {
  const found = coplanarStructureOverlaps([block('house', -4, -10, 4, 10, 8, 11), block('gallery', -6, -6, 6, 6, 10.9, 11)]);
  expect(found).toHaveLength(1);
  expect(found[0].structures).toEqual(['house', 'gallery']);
  expect(found[0].top).toBe(11);
  // The overlap is 8 m by 12 m, sampled at 0.1 m.
  expect(found[0].areaM2).toBeCloseTo(96, 0);
});

test('a block standing on the shared plane hides it; different tops and disjoint blocks are clean', () => {
  const house = block('house', -4, -10, 4, 10, 8, 11), gallery = block('gallery', -6, -6, 6, 6, 10.9, 11);
  // A bridge standing on the plane over the whole overlap: nothing exposed, like Iowa's bridge house.
  expect(coplanarStructureOverlaps([house, gallery, block('bridge', -5, -7, 5, 7, 11, 13)])).toHaveLength(0);
  // A partial cover leaves the rest reported.
  const partial = coplanarStructureOverlaps([house, gallery, block('bridge', -4, -6, 0, 6, 11, 13)]);
  expect(partial[0].areaM2).toBeCloseTo(48, 0);
  expect(coplanarStructureOverlaps([house, block('platform', -6, -6, 6, 6, 11.5, 11.7)])).toHaveLength(0);
  expect(coplanarStructureOverlaps([house, block('aft', -4, 12, 4, 20, 8, 11)])).toHaveLength(0);
});

test('concave footprints are sampled, not boxed', () => {
  // An L-shaped house and a block in the notch of the L share a top but not an area.
  const l: StructureLike = { id: 'l', footprint: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], baseY: 5, height: 3 };
  expect(coplanarStructureOverlaps([l, block('notch', 5, 5, 9, 9, 6, 8)])).toHaveLength(0);
});
