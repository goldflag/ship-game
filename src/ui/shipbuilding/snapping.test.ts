import { expect, test } from 'bun:test';
import { DEFAULT_SNAPPING, SHIP_AXES, primitiveSnapFeatures, resolveSnap, type SnapFeature, type SnapSettings } from './snapping';
import { attachmentOffset, placementCenter } from './placement';
import { rotateVertex } from '../../ships/constructionVertex';
import type { Vec3 } from '../../ships/blueprint';

const center = (id: string, point: Vec3): SnapFeature => ({ id, owner: id, point, kind: 'center' });
const moving = [center('moving', [0, 0, 0])];
const project = (p: Vec3): [number, number] => [p[0] * 100, p[2] * 100];
const solve = (raw: Vec3, settings: Partial<SnapSettings> = {}, targets: SnapFeature[] = [], previous: string[] = []) => resolveSnap({
  raw, grid: raw.map(v => Math.round(v)) as Vec3, directions: [SHIP_AXES[0], SHIP_AXES[2]], moving, targets,
  settings: { ...DEFAULT_SNAPPING, ...settings }, project, previous,
});

test('Off preserves raw motion with passive guides and no magnetic alignment', () => {
  const result = solve([.031, 2.127, .043], { enabled: false }, [center('target', [.05, 2.127, 0])]);
  expect(result.delta).toEqual([.031, 2.127, .043]);
  expect(result.guides.length).toBeGreaterThan(0);
  expect(result.guides.every(g => !g.active)).toBe(true);
});
test('geometry wins over the grid on one axis without changing constrained height', () => {
  const result = solve([1.03, 2.127, 3.38], { centerline: false }, [center('target', [1.07, 2.127, 3.38])]);
  expect(result.delta).toEqual([1.07, 2.127, 3.38]);
  expect(result.latched).toHaveLength(2);
});
test('centerline uses the mounting socket, even with offset model bounds', () => {
  const piece = { kind: 'equipment' as const, size: [4, 3, 10] as Vec3, boundsCenter: [2, 1.5, -3] as Vec3, bearingDeg: 90,
    sockets: [{ id: 'attachment', kind: 'support' as const, position: [1, 0, 2] as Vec3, direction: [0, 1, 0] as Vec3 }] };
  const offset = attachmentOffset(piece, 90);
  const raw = placementCenter(piece, { point: [.03, 5, 2], normal: [0, 1, 0] }, null);
  const result = resolveSnap({ raw, grid: raw, directions: [SHIP_AXES[0]], moving: [center('mount', offset)], targets: [], settings: DEFAULT_SNAPPING, project });
  expect(result.delta[0] + offset[0]).toBeCloseTo(0, 10);
  expect(result.delta[1] + offset[1]).toBe(5);
});
test('snap holds beyond acquisition distance, releases, and does not jump to a closer competing target', () => {
  const settings = { centerline: false, grid: false };
  const targets = [center('a', [1, 0, 0]), center('b', [1.08, 0, 0])];
  const acquired = solve([.98, 0, 0], settings, targets);
  expect(acquired.delta[0]).toBe(1);
  expect(solve([1.075, 0, 0], settings, targets, acquired.latched).delta[0]).toBe(1);
  expect(solve([1.13, 0, 0], settings, [targets[0]], acquired.latched).delta[0]).toBe(1);
  expect(solve([1.15, 0, 0], settings, [targets[0]], acquired.latched).delta[0]).toBe(1.15);
});
test('acquisition scales with projection and ignores offscreen targets', () => {
  for (const scale of [10, 100, 1000]) {
    const run = (pixels: number) => resolveSnap({ raw: [pixels / scale, 0, 0], grid: [0, 0, 0], directions: [SHIP_AXES[0]], moving, targets: [],
      settings: { ...DEFAULT_SNAPPING, grid: false }, project: p => [p[0] * scale, p[2] * scale] });
    expect(run(7).delta[0]).toBe(0); expect(run(9).delta[0]).toBe(9 / scale);
  }
  expect(solve([1.04, 0, 0], { centerline: false, grid: false }, [center('distant', [1, 0, 10])]).delta[0]).toBe(1.04);
});
test('guides and targets can be independently disabled', () => {
  expect(solve([.03, 0, .27], { guides: false }).guides).toEqual([]);
  expect(solve([.03, 0, .27], { guides: false }).delta).toEqual([0, 0, 0]);
  expect(solve([.03, 0, .27], { centerline: false, geometry: false, grid: false }).delta).toEqual([.03, 0, .27]);
});
test('rotated freeform axes can reach the ship centerline without violating the local movement axis', () => {
  const direction = rotateVertex([1, 0, 0], 30), raw: Vec3 = [.02, 0, -.02 / Math.sqrt(3)];
  const result = resolveSnap({ raw, grid: raw, directions: [direction], moving, targets: [], settings: DEFAULT_SNAPPING, project });
  expect(result.delta[0]).toBeCloseTo(0, 10); expect(result.delta[2]).toBeCloseTo(0, 10);
});
test('actual source edges and corners participate in alignment', () => {
  const features = primitiveSnapFeatures({ id: 'box', kind: 'box', size: [2, 2, 2], position: [3, 0, 0], rotationDeg: 90 });
  expect(features.filter(f => f.kind === 'edge')).toHaveLength(12);
  expect(features.filter(f => f.kind === 'corner')).toHaveLength(8);
  const result = resolveSnap({ raw: [1.04, 0, 0], grid: [1, 0, 0], directions: [SHIP_AXES[0]], moving: [{ ...center('corner', [1, 1, 1]), kind: 'corner' }],
    targets: features, settings: { ...DEFAULT_SNAPPING, centerline: false }, project });
  expect(result.delta[0]).toBeCloseTo(1); expect(result.guides.some(g => g.active)).toBe(true);
});
test('free placement preserves decimal tangents and seats hulls on sloped supports', () => {
  const normal: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2], hit = { point: [.1234, 2, .4567] as Vec3, normal };
  const placed = placementCenter({ kind: 'hull', shape: 'box', size: [1, 1, 1], rotationDeg: 0 }, hit, null);
  expect(placed[0]).toBe(.1234); expect(placed[2]).toBe(.4567);
  expect(placed[1] + placed[2] - 1).toBeCloseTo(hit.point[1] + hit.point[2] - .05 / Math.SQRT1_2, 10);
});

test('grid on a rotated second axis cannot undo an acquired centerline', () => {
  const directions = [rotateVertex([1, 0, 0], 30), rotateVertex([0, 0, 1], 30)];
  const result = resolveSnap({ raw: [.02, 0, .23], grid: [.5, 0, .5], directions, moving, targets: [], settings: DEFAULT_SNAPPING, project });
  expect(result.delta[0]).toBeCloseTo(0, 10);
  expect(result.guides[0].active).toBe(true);
});
