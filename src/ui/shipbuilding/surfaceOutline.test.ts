import { expect, test } from 'bun:test';
import type { ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { surfaceOutline } from './surfaceOutline';
const face = (vertices: Vec3[]): ConstructionSurface => ({ id: 'face', primitiveId: 'hull', face: 'top', vertices, normal: [0, 1, 0], areaM2: 1, thicknessMm: 100, material: 'armor-steel', paint: 'naval-gray', open: false });
test('a triangulated panel has four outline edges and no internal diagonal', () => {
  const edges = surfaceOutline([face([[0,0,0],[2,0,0],[2,0,2]]), face([[0,0,0],[2,0,2],[0,0,2]])]);
  expect(edges).toHaveLength(4);
  expect(edges.every(({a,b}) => a[0] === b[0] || a[2] === b[2])).toBe(true);
});
test('clipped T-junctions do not expose pieces of an internal diagonal', () => {
  const edges = surfaceOutline([face([[0,0,0],[2,0,0],[2,0,2]]), face([[0,0,0],[1,0,1],[0,0,2]]), face([[1,0,1],[2,0,2],[0,0,2]])]);
  expect(edges).toHaveLength(4);
  expect(edges.every(({a,b}) => a[0] === b[0] || a[2] === b[2])).toBe(true);
});
