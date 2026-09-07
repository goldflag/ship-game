import { expect, test } from 'bun:test';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { BattlefieldCamera } from './BattlefieldCamera';
import { chartPoint, chartWorld } from '../ui/airChart';

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
