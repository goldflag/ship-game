import { expect, test } from 'bun:test';
import type { ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { surfaceCreases, surfaceOutline } from './surfaceOutline';
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

test('coplanar block seams cancel even at clipped T-junctions', () => {
  const surfaces = [face([[0,0,0],[2,0,0],[2,0,2],[0,0,2]]),
    {...face([[2,0,0],[3,0,0],[3,0,1],[2,0,1]]), primitiveId:'second'},
    {...face([[2,0,1],[3,0,1],[3,0,2],[2,0,2]]), primitiveId:'third'}];
  const edges = surfaceCreases(surfaces);
  expect(edges.length).toBeGreaterThan(0);
  expect(edges.some(({a,b}) => a[0] === 2 && b[0] === 2)).toBe(false);
});
for (const angle of [0, 19, 20, 21, 90]) test(`shared ${angle} degree edge uses the strict 20 degree threshold`, () => {
  const radians = angle * Math.PI / 180;
  const a = face([[0,0,0],[1,0,0],[1,0,1],[0,0,1]]);
  const b = {...face([[1,0,0],[1+Math.cos(radians),Math.sin(radians),0],[1+Math.cos(radians),Math.sin(radians),1],[1,0,1]]),
    primitiveId:'neighbor', normal:[-Math.sin(radians), Math.cos(radians), 0] as Vec3};
  expect(surfaceCreases([a,b]).some(({a,b}) => a[0] === 1 && b[0] === 1)).toBe(angle > 20);
});
