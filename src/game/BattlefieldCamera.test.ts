import { expect, test } from 'bun:test';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { BattlefieldCamera } from './BattlefieldCamera';
import { chartPoint, chartWorld } from '../ui/airChart';

test('camera ascends continuously, reverses from the displayed pose, and respects reduced motion', () => {
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  camera.position.set(0, 50, 300); camera.lookAt(0, 0, 0);
  const ship = camera.clone(), map = new BattlefieldCamera(camera);
  map.beginTransition(); map.enter([{ x: 0, z: 0 }], 1280, 800);
  const destination = camera.clone(); map.applyTransition(0);
  expect(camera.position.toArray()).toEqual(ship.position.toArray());
  map.update(); map.applyTransition(.7);
  expect(camera.position.y).toBeGreaterThan(ship.position.y);
  expect(camera.position.y).toBeLessThan(destination.position.y);
  const mid = camera.clone();
  map.beginTransition(); map.exit();
  camera.position.copy(ship.position); camera.quaternion.copy(ship.quaternion); map.applyTransition(0);
  expect(camera.position.toArray()).toEqual(mid.position.toArray());
  camera.position.copy(ship.position); camera.quaternion.copy(ship.quaternion); camera.fov = ship.fov;
  map.applyTransition(1.4);
  expect(camera.position.distanceTo(ship.position)).toBeLessThan(1e-8);
  expect(camera.quaternion.angleTo(ship.quaternion)).toBeLessThan(1e-7);
  expect(camera.fov).toBe(ship.fov); expect(camera.far).toBe(ship.far);
  expect(map.transitioning).toBe(false);
  map.beginTransition(true); map.enter([{ x: 0, z: 0 }], 1280, 800); map.applyTransition(0);
  expect(map.transitioning).toBe(false);
  expect(camera.position.toArray()).toEqual(destination.position.toArray());
});

for (const [width, height] of [[1440, 900], [700, 550], [390, 844]]) test(`tilted battlefield projects targets and water commands consistently at ${width}×${height}`, () => {
  const camera = new PerspectiveCamera(17, width / height, .5, 60000);
  const map = new BattlefieldCamera(camera);
  const fleet = [{ x: -3000, z: -2000 }, { x: 5000, z: 13000 }];
  map.enter(fleet, width, height);
  for (const p of fleet) {
    const projected = new Vector3(p.x, 0, p.z).project(camera);
    const [x, y] = chartPoint(map.view, width, height, p.x, p.z);
    expect((projected.x + 1) * width / 2).toBeCloseTo(x, 6);
    expect((1 - projected.y) * height / 2).toBeCloseTo(y, 6);
    expect(Math.abs(projected.x)).toBeLessThan(1); expect(Math.abs(projected.y)).toBeLessThan(1);
  }
  // Compare inverse UI projection with independent Three.js ray/sea intersections,
  // including the corners where perspective differs most from a flat chart.
  for (const [u, v] of [[.02, .02], [.98, .02], [.02, .98], [.98, .98], [.5, .5]]) {
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(u * 2 - 1, 1 - v * 2), camera);
    const water = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
    const [x, z] = chartWorld(map.view, width, height, width * u, height * v);
    expect(x).toBeCloseTo(water.x, 6); expect(z).toBeCloseTo(water.z, 6);
  }
  const air = new Vector3(500, 420, 6000).project(camera);
  const projectedAir = chartPoint(map.view, width, height, 500, 6000, 420);
  expect(projectedAir[0]).toBeCloseTo((air.x + 1) * width / 2, 6);
  expect(projectedAir[1]).toBeCloseTo((1 - air.y) * height / 2, 6);
  const before = chartWorld(map.view, width, height, width * .7, height * .3);
  const altitude = camera.position.y;
  map.zoom(-300, width * .7, height * .3, width, height); map.update();
  const after = chartWorld(map.view, width, height, width * .7, height * .3);
  expect(after[0]).toBeCloseTo(before[0], 6); expect(after[1]).toBeCloseTo(before[1], 6);
  expect(camera.position.y).toBeLessThan(altitude);
  const direction = camera.getWorldDirection(new Vector3());
  expect(direction.y).toBeCloseTo(-Math.cos(20 * Math.PI / 180), 8);
  expect(direction.z).toBeCloseTo(-Math.sin(20 * Math.PI / 180), 8);
  const grab = chartWorld(map.view, width, height, width * .3, height * .7);
  map.pan(60, -35, width, height, width * .3 + 60, height * .7 - 35); map.update();
  const dragged = chartWorld(map.view, width, height, width * .3 + 60, height * .7 - 35);
  expect(dragged[0]).toBeCloseTo(grab[0], 6); expect(dragged[1]).toBeCloseTo(grab[1], 6);
  map.exit(); expect(camera.fov).toBe(17); expect(camera.far).toBe(60000); expect(camera.up.toArray()).toEqual([0, 1, 0]);
});
