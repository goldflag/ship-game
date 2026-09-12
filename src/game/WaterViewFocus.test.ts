import { expect, test } from 'bun:test';
import { Group, PerspectiveCamera } from 'three/webgpu';
import type { ShipView } from './ShipView';
import { WaterViewFocus } from './WaterViewFocus';

function ship(x: number, z: number): ShipView {
  const root = new Group(); root.position.set(x, 0, z);
  return { root, definition: { hull: { length: 250 } }, inspection: { mode: 'exterior' } } as ShipView;
}

test('zoom focuses the visible hull, restores nearby coverage on exit, and rejects hidden/offscreen/behind ships', () => {
  const ssr = { maxDistance: 150 }, focus = new WaterViewFocus(ssr);
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.position.set(0, 29, 0); camera.zoom = 24;
  camera.lookAt(0, 0, -20000); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const target = ship(0, -20000), nearby = ship(500, -200), behind = ship(0, 1000), neighbor = ship(220, -20000);
  expect(focus.update([nearby, behind, neighbor, target], camera, true)).toBe(target.root.position);
  expect(ssr.maxDistance).toBeCloseTo(40000, 0);
  target.root.visible = false;
  expect(focus.update([target, nearby, behind], camera, true)).toBeUndefined();
  expect(ssr.maxDistance).toBe(150);
  target.root.visible = true;
  expect(focus.update([target], camera, false)).toBeUndefined();
  expect(ssr.maxDistance).toBe(150);
  camera.lookAt(220, 0, -20000); camera.updateMatrixWorld();
  expect(focus.update([target, neighbor], camera, true)).toBe(neighbor.root.position);
});
