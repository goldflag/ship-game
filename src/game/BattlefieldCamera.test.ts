import { expect, test } from 'bun:test';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { BattlefieldCamera } from './BattlefieldCamera';
import { chartPoint, chartWorld } from '../ui/airChart';

test('angle limits allow a low horizon view and reset retains map position and zoom', () => {
  const camera = new PerspectiveCamera(52, 390 / 844, .5, 60000);
  const map = new BattlefieldCamera(camera);
  map.view = { x: 50000, z: -50000, radius: 40000 };
  map.orbit(500, -100000); map.update();
  expect(map.view.tilt! * 180 / Math.PI).toBeCloseTo(80);
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(x, y), camera);
    const sea = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
    if (y > 0) expect(sea).toBeNull();
    else { expect(sea).toBeTruthy(); expect(sea.clone().project(camera).z).toBeLessThan(1); }
  }
  map.orbit(0, 100000); expect(map.view.tilt).toBe(0);
  map.setTilt(NaN); expect(map.view.tilt).toBe(0);
  map.resetAngle();
  expect(map.view).toEqual({ x: 50000, z: -50000, radius: 40000, tilt: Math.PI / 9, bearing: 0 });
  map.fit([{ x: 0, z: 0 }], 390, 844);
  expect(map.view.tilt).toBe(Math.PI / 9); expect(map.view.bearing).toBe(0);
});

test('sky and horizon navigation stays finite and pans in the same direction as water', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const radius of [600, 8000, 40000]) {
    const camera = new PerspectiveCamera(52, width / height, .5, 60000);
    const map = new BattlefieldCamera(camera);
    const view = { x: 0, z: 0, radius, tilt: 80 * Math.PI / 180, bearing: 0 };
    const horizon = height / 2 - height / (2 * Math.tan(26 * Math.PI / 180)) / Math.tan(view.tilt);
    for (const y of [0, horizon - .01, horizon, horizon + .01]) {
      map.view = { ...view }; map.pan(10, 10, width, height, width / 2, y);
      expect(map.view.x).toBeLessThan(0); expect(map.view.z).toBeLessThan(0);
      expect(Math.abs(map.view.x)).toBeLessThan(50000); expect(Math.abs(map.view.z)).toBeLessThan(50000);
      map.view = { ...view }; map.zoom(-200, width / 2, y, width, height);
      expect(Number.isFinite(map.view.x)).toBe(true); expect(Number.isFinite(map.view.z)).toBe(true);
      expect(map.view.radius).toBeLessThanOrEqual(radius);
    }
  }
});

test('orbit angles preserve water picking, cursor zoom and screen-space panning', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const tilt of [0, 20, 55, 80]) for (const bearing of [0, 90, 225]) {
    const camera = new PerspectiveCamera(52, width / height, .5, 60000);
    const map = new BattlefieldCamera(camera);
    map.view = { x: 300, z: -600, radius: 8000, tilt: tilt * Math.PI / 180, bearing: bearing * Math.PI / 180 };
    map.update();
    const direction = camera.getWorldDirection(new Vector3());
    expect(direction.y).toBeCloseTo(-Math.cos(tilt * Math.PI / 180), 8);
    expect(direction.x).toBeCloseTo(-Math.sin(tilt * Math.PI / 180) * Math.sin(bearing * Math.PI / 180), 8);
    for (const [u, v] of [[.02, .02], [.98, .98], [.5, .5]]) {
      const ray = new Raycaster(); ray.setFromCamera(new Vector2(u * 2 - 1, 1 - v * 2), camera);
      const water = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
      if (!water) continue;
      const point = chartWorld(map.view, width, height, width * u, height * v);
      expect(point[0]).toBeCloseTo(water.x, 5); expect(point[1]).toBeCloseTo(water.z, 5);
    }
    const point = new Vector3(500, 420, -1000).project(camera);
    const overlay = chartPoint(map.view, width, height, 500, -1000, 420);
    expect(overlay[0]).toBeCloseTo((point.x + 1) * width / 2, 6);
    expect(overlay[1]).toBeCloseTo((1 - point.y) * height / 2, 6);
    const anchor = chartWorld(map.view, width, height, width * .6, height * .6);
    map.zoom(-200, width * .6, height * .6, width, height);
    map.pan(20, 10, width, height, width * .6 + 20, height * .6 + 10);
    const dragged = chartWorld(map.view, width, height, width * .6 + 20, height * .6 + 10);
    expect(dragged[0]).toBeCloseTo(anchor[0], 6); expect(dragged[1]).toBeCloseTo(anchor[1], 6);
  }
});

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
  const totalAngle = ship.quaternion.angleTo(destination.quaternion);
  expect(camera.quaternion.angleTo(ship.quaternion)).toBeCloseTo(totalAngle / 2, 7);
  expect(camera.quaternion.angleTo(destination.quaternion)).toBeCloseTo(totalAngle / 2, 7);
  const mid = camera.clone();
  map.beginTransition(); map.exit();
  camera.position.copy(ship.position); camera.quaternion.copy(ship.quaternion); map.applyTransition(0);
  expect(camera.position.toArray()).toEqual(mid.position.toArray());
  expect(camera.quaternion.angleTo(mid.quaternion)).toBeLessThan(1e-7);
  camera.position.copy(ship.position); camera.quaternion.copy(ship.quaternion); camera.fov = ship.fov;
  map.applyTransition(.7);
  expect(camera.quaternion.angleTo(ship.quaternion)).toBeCloseTo(mid.quaternion.angleTo(ship.quaternion) / 2, 7);
  camera.position.copy(ship.position); camera.quaternion.copy(ship.quaternion); camera.fov = ship.fov;
  map.applyTransition(.7);
  expect(camera.position.distanceTo(ship.position)).toBeLessThan(1e-8);
  expect(camera.quaternion.angleTo(ship.quaternion)).toBeLessThan(1e-7);
  expect(camera.fov).toBe(ship.fov); expect(camera.far).toBe(ship.far);
  expect(map.transitioning).toBe(false);
  map.beginTransition(true); map.enter([{ x: 0, z: 0 }], 1280, 800); map.applyTransition(0);
  expect(map.transitioning).toBe(false);
  expect(camera.position.toArray()).toEqual(destination.position.toArray());
  expect(camera.quaternion.angleTo(destination.quaternion)).toBeLessThan(1e-7);
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

test('fleet zoom reaches ship details without the old 300 metre stop and keeps the cursor anchored', () => {
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000), map = new BattlefieldCamera(camera);
  map.view = { x: 300, z: -600, radius: 300, tilt: .7, bearing: 1 };
  const anchor = chartWorld(map.view, 1440, 900, 800, 600);
  map.zoom(-4000, 800, 600, 1440, 900); map.update();
  expect(map.view.radius).toBeLessThan(2);
  const after = chartWorld(map.view, 1440, 900, 800, 600);
  expect(after[0]).toBeCloseTo(anchor[0], 6); expect(after[1]).toBeCloseTo(anchor[1], 6);
  expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
});
