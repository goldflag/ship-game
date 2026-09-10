import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { Vec3 } from '../ships/blueprint';
import { projectAirMapPolygon } from './AirMapPolygon';

function camera() { const c = new PerspectiveCamera(90, 2, 1, 10); c.updateMatrixWorld(); return c; }
function coordinates(path: string): [number, number][] {
  const numbers = path.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  return Array.from({ length: numbers.length / 2 }, (_, i) => [numbers[2 * i], numbers[2 * i + 1]]);
}
function area(path: string): number {
  const points = coordinates(path);
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
}
function rectangle(left: number, right: number, bottom: number, top: number, z = -2): Vec3[] {
  return [[left, bottom, z], [right, bottom, z], [right, top, z], [left, top, z]];
}
function assertClosedViewportPath(path: string) {
  expect(path.match(/M/g)).toHaveLength(1); expect(path.endsWith('Z')).toBe(true);
  for (const [x, y] of coordinates(path)) { expect(x).toBeGreaterThanOrEqual(-1e-10); expect(x).toBeLessThanOrEqual(200 + 1e-10); expect(y).toBeGreaterThanOrEqual(-1e-10); expect(y).toBeLessThanOrEqual(100 + 1e-10); }
}

test('a polygon enclosing the viewport fills it even when no original edge is visible', () => {
  const points = rectangle(-100, 100, -100, 100), before = structuredClone(points);
  const path = projectAirMapPolygon(points, camera(), 200, 100);
  assertClosedViewportPath(path); expect(area(path)).toBeCloseTo(20000, 8);
  expect(coordinates(path)).toHaveLength(4); expect(points).toEqual(before);
});

test('adjacent partially visible cells cover the viewport without diagonal fill gaps', () => {
  const c = camera();
  const cells = [rectangle(-10, 0, -10, 0), rectangle(0, 10, -10, 0), rectangle(-10, 0, 0, 10), rectangle(0, 10, 0, 10)];
  const paths = cells.map(points => projectAirMapPolygon(points, c, 200, 100));
  paths.forEach(assertClosedViewportPath);
  for (const path of paths) expect(area(path)).toBeCloseTo(5000, 8);
  expect(paths.reduce((total, path) => total + area(path), 0)).toBeCloseTo(20000, 8);
});

test('a water polygon crossing behind the eye clips to near/far and viewport edges as one fill', () => {
  const path = projectAirMapPolygon([[-100, -1, 20], [100, -1, 20], [100, -1, -20], [-100, -1, -20]], camera(), 200, 100);
  assertClosedViewportPath(path);
  // y=-1 projects to y=100 at depth1 and y=55 at depth10.
  expect(area(path)).toBeCloseTo(200 * 45, 7);
  expect(Math.min(...coordinates(path).map(p => p[1]))).toBeCloseTo(55, 8);
});

test('near-plane intersection preserves the projected trapezoid rather than dropping crossing edges', () => {
  const path = projectAirMapPolygon([[-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -2], [-.5, .5, -2]], camera(), 200, 100);
  assertClosedViewportPath(path);
  // At depth1 the clipped edge has y=-1/6, width50px; depth2 edge width25px.
  expect(area(path)).toBeCloseTo((50 + 25) / 2 * (175 / 3 - 37.5), 8);
});

test('far-plane intersection retains only the in-range part of a tilted polygon', () => {
  const path = projectAirMapPolygon([[-2, -1, -5], [2, -1, -5], [2, 1, -15], [-2, 1, -15]], camera(), 200, 100);
  assertClosedViewportPath(path); expect(area(path)).toBeCloseTo(300, 8);
});

test('camera translation and orbit preserve viewport coverage and do not mutate camera matrices', () => {
  const c = camera(); c.position.set(15, 8, 23); c.lookAt(-10, 0, -20); c.updateMatrixWorld();
  const points = rectangle(-100, 100, -100, 100).map(p => new Vector3(...p).applyMatrix4(c.matrixWorld).toArray() as Vec3);
  const view = c.matrixWorldInverse.toArray(), projection = c.projectionMatrix.toArray();
  const path = projectAirMapPolygon(points, c, 200, 100);
  assertClosedViewportPath(path); expect(area(path)).toBeCloseTo(20000, 7);
  expect(c.matrixWorldInverse.toArray()).toEqual(view); expect(c.projectionMatrix.toArray()).toEqual(projection);
});

test('fully hidden, out-of-range, degenerate and nonfinite polygons have no fill', () => {
  for (const points of [rectangle(-1, 1, -1, 1, 2), rectangle(-1, 1, -1, 1, -20), rectangle(20, 30, -1, 1),
    [[0, 0, -2], [1, 0, -2], [2, 0, -2]], [[0, 0, -2], [1, 0, -2], [NaN, 1, -2]]] as Vec3[][]) {
    expect(projectAirMapPolygon(points, camera(), 200, 100)).toBe('');
  }
});
