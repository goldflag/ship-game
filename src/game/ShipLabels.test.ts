import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { projectShipLabel } from './ShipLabels';

test('ship labels follow camera projection and cull rear, offscreen and clipped ships', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.updateMatrixWorld();
  expect(projectShipLabel(new Vector3(0, 0, -5000), camera, 1600, 900)).toEqual({ x: 800, y: 450 });
  expect(projectShipLabel(new Vector3(0, 0, 5000), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -.1), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -70000), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(9000, 0, -5000), camera, 1600, 900)).toBeNull();
  const above = projectShipLabel(new Vector3(0, 60, -5000), camera, 1600, 900)!;
  expect(above.y).toBeLessThan(450);
  camera.lookAt(5000, 0, 0); camera.updateMatrixWorld();
  expect(projectShipLabel(new Vector3(5000, 0, 0), camera, 1600, 900)!.x).toBeCloseTo(800);
  expect(projectShipLabel(new Vector3(0, 0, -5000), camera, 1600, 900)).toBeNull();
});
