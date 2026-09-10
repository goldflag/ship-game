import { expect, test } from 'bun:test';
import { FleetWakeFoam, type WakeShip } from './FleetWakeFoam';
import { PreparedPoseGroup } from './FrameScene';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { DataTexture, PerspectiveCamera } from 'three/webgpu';

function cpuImage(foam: FleetWakeFoam) {
  if (!(foam.texture instanceof DataTexture)) throw new Error('CPU wake fixture requires a data texture');
  return foam.texture.image;
}

function ship(x: number, speed = 15): WakeShip {
  const definition = shipPreset('bismarck');
  const motion = { ...new CombatSimulation(definition).ship, x, speed };
  return { definition, motion, root: new PreparedPoseGroup() };
}
function tileHasFoam(foam: FleetWakeFoam, slot: number): boolean {
  const size = cpuImage(foam).width, res = size / 8;
  const pixels = cpuImage(foam).data as Uint8Array;
  for (let row = 0; row < res; row++) {
    const start = (Math.floor(slot / 8) * res + row) * size + slot % 8 * res;
    if (pixels.subarray(start, start + res).some(value => value > 0)) return true;
  }
  return false;
}

test('all 60 ships have independent trails across a wide battlefield, even with the player stopped', () => {
  const foam = new FleetWakeFoam(256);
  const ships = Array.from({ length: 60 }, (_, i) => ship(i * 650, i === 0 ? 0 : 15));
  foam.update(ships, .1, []);
  for (let frame = 0; frame < 30; frame++) {
    ships.forEach(s => { s.motion.z -= s.motion.speed * .1; });
    foam.update(ships, .1, []);
  }
  expect(tileHasFoam(foam, 0)).toBe(false);
  for (let i = 1; i < ships.length; i++) expect(tileHasFoam(foam, i)).toBe(true);
  const beforePause = (cpuImage(foam).data as Uint8Array).slice();
  foam.update(ships, 0, []);
  expect(cpuImage(foam).data).toEqual(beforePause);
  // A teleported hull clears only its own trail, never its neighbours'.
  ships[1].motion.x += 1000;
  foam.update(ships, .1, []);
  expect(tileHasFoam(foam, 1)).toBe(false);
  expect(tileHasFoam(foam, 2)).toBe(true);
  // Repacking the atlas must replace a removed hull's tile immediately.
  foam.update([ships[2], ships[0]], .1, []);
  expect(tileHasFoam(foam, 0)).toBe(true);
  expect(tileHasFoam(foam, 1)).toBe(false);
  foam.reset();
  expect((cpuImage(foam).data as Uint8Array).some(value => value > 0)).toBe(false);
  foam.dispose();
});

test('stopped and submerged ships emit no new trail; existing foam fades away', () => {
  const foam = new FleetWakeFoam(256), ships = [ship(0), ship(5000)];
  ships[1].motion.y = -4;
  foam.update(ships, .1, []);
  for (let i = 0; i < 30; i++) {
    ships.forEach(s => { s.motion.z -= 1.5; });
    foam.update(ships, .1, []);
  }
  expect(tileHasFoam(foam, 0)).toBe(true);
  expect(tileHasFoam(foam, 1)).toBe(false);
  ships[0].motion.speed = 0;
  for (let i = 0; i < 560; i++) foam.update(ships, .1, []);
  expect(tileHasFoam(foam, 0)).toBe(false);
  foam.dispose();
});

test('distant wake refreshes retain the full curved trail and zoom restores nearby cadence', () => {
  const detailed = new FleetWakeFoam(256), distant = new FleetWakeFoam(256);
  const ships = [ship(0)], camera = new PerspectiveCamera(52, 1, .5, 60000);
  camera.position.set(0, 1000, 6000);
  let detailedUpdates = 0, distantUpdates = 0;
  for (let tick = 0; tick < 300; tick++) {
    const motion = ships[0].motion; motion.heading += .003;
    motion.x += Math.sin(motion.heading) * motion.speed / 60;
    motion.z -= Math.cos(motion.heading) * motion.speed / 60;
    const a = detailed.texture.version, b = distant.texture.version;
    detailed.update(ships, 1 / 60, []); distant.update(ships, 1 / 60, [], camera);
    detailedUpdates += Number(detailed.texture.version !== a); distantUpdates += Number(distant.texture.version !== b);
  }
  expect(distantUpdates).toBeLessThan(detailedUpdates / 2);
  camera.zoom = 10; camera.updateProjectionMatrix();
  // Both publish the same accumulated path when inspected closely.
  detailed.update(ships, .21, []); distant.update(ships, .21, [], camera);
  expect(cpuImage(distant).data).toEqual(cpuImage(detailed).data);
  const version = distant.texture.version;
  distant.update(ships, .06, [], camera);
  expect(distant.texture.version).toBeGreaterThan(version);
  detailed.dispose(); distant.dispose();
});
