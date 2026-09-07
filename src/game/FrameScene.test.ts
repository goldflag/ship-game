import { expect, test } from 'bun:test';
import { Group, Vector3 } from 'three/webgpu';
import { FrameScene, PreparedPoseGroup } from './FrameScene';

test('capture and main passes share the latest pose; the next frame and explicit updates refresh it', () => {
  const scene = new FrameScene(), buoy = new Group();
  scene.add(buoy);
  let updates = 0;
  const update = buoy.updateMatrixWorld;
  buoy.updateMatrixWorld = function (force) { updates++; update.call(this, force); };
  scene.beginFrame();
  buoy.position.y = 4; // Water changes its visual pose before the first capture.
  for (let i = 0; i < 5; i++) scene.updateMatrixWorld();
  expect(new Vector3().setFromMatrixPosition(buoy.matrixWorld).y).toBe(4);
  expect(updates).toBe(1);
  scene.endFrame();
  scene.beginFrame(); buoy.position.y = 6; scene.updateMatrixWorld();
  expect(new Vector3().setFromMatrixPosition(buoy.matrixWorld).y).toBe(6);
  buoy.position.y = 7; scene.updateMatrixWorld(true);
  expect(new Vector3().setFromMatrixPosition(buoy.matrixWorld).y).toBe(7);
  scene.endFrame(); buoy.position.y = 8; scene.updateMatrixWorld();
  expect(new Vector3().setFromMatrixPosition(buoy.matrixWorld).y).toBe(8);
});

test('completed ship poses are retained while late water objects still update', () => {
  const scene = new FrameScene(), ship = new PreparedPoseGroup(), joint = new Group(), buoy = new Group();
  ship.add(joint); scene.add(ship, buoy);
  let visits = 0;
  const update = joint.updateMatrixWorld;
  joint.updateMatrixWorld = function(force) { visits++; update.call(this, force); };
  ship.position.x = 12; joint.position.y = 3; ship.updateMatrixWorld(true);
  scene.beginFrame(); buoy.position.y = 2; scene.updateMatrixWorld(); scene.endFrame();
  expect(visits).toBe(1);
  expect(new Vector3().setFromMatrixPosition(joint.matrixWorld).toArray()).toEqual([12, 3, 0]);
  expect(new Vector3().setFromMatrixPosition(buoy.matrixWorld).y).toBe(2);
  ship.position.x = 14; ship.updateMatrixWorld(true);
  expect(visits).toBe(2);
  expect(new Vector3().setFromMatrixPosition(joint.matrixWorld).x).toBe(14);
});
