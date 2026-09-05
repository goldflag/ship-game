import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { FIXED_DT, motionVelocity } from '../simulation/ship';
import { updateMount } from '../simulation/weapons';
import type { Vec3 } from '../ships/blueprint';
import { gunAimPoints, type GunAimPoint } from './gunAim';
import { groupGunAim, placeGunAimLabels, projectGunAim } from './GunAimIndicators';

test('loaded guns show their current direction before traversing and converge on the commanded aim', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  const aim: Vec3 = [5000, .5, 0];
  const before = JSON.stringify(sim.player);
  const untrained = gunAimPoints(sim.player, sim.definition, 'main', aim);
  expect(untrained).toHaveLength(4);
  expect(untrained.every(point => point.status === 'turning' && !point.aligned)).toBe(true);
  expect(Math.abs(untrained[0].point[0] - aim[0])).toBeGreaterThan(4000);
  expect(JSON.stringify(sim.player)).toBe(before);
  const mount = sim.definition.mounts[0], state = sim.player.mounts[0];
  for (let i = 0; i < 2400; i++) updateMount(mount, state, sim.definition, sim.ship, aim, FIXED_DT);
  const trained = gunAimPoints(sim.player, sim.definition, 'main', aim)[0];
  expect(trained.aligned).toBe(true);
  expect(new Vector3(...trained.point).distanceTo(new Vector3(...aim))).toBeLessThan(.01);
  state.status = 'reloading'; state.reload = 18;
  const reloading = gunAimPoints(sim.player, sim.definition, 'main', aim)[0];
  expect(reloading.aligned).toBe(true);
  expect(reloading.status).toBe('reloading');
  state.status = 'blocked';
  expect(gunAimPoints(sim.player, sim.definition, 'main', aim)[0].status).toBe('blocked');
});

test('trained turret centers stay on the reticle at every binocular magnification', () => {
  for (const shipId of ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6']) {
    const sim = new CombatSimulation(shipPreset(shipId)), aim: Vec3 = [shipId === 'enterprise-cv6' ? -1800 : 1800, .5, 0];
    const mount = sim.definition.mounts[0], state = sim.player.mounts[0];
    for (let i = 0; i < 3600; i++) updateMount(mount, state, sim.definition, sim.ship, aim, FIXED_DT);
    for (const zoom of [1, 2, 4, 6, 8, 12]) {
      const camera = new PerspectiveCamera(2 * Math.atan(Math.tan(52 * Math.PI / 360) / zoom) * 180 / Math.PI, 1.6, .25, 60000);
      camera.position.set(0, 36, 0); camera.lookAt(new Vector3(...aim)); camera.updateMatrixWorld();
      const point = gunAimPoints(sim.player, sim.definition, 'main', aim)[0];
      const projected = projectGunAim(new Vector3(...point.point), camera, 1440, 900);
      expect(Math.hypot(projected.x - 720, projected.y - 450)).toBeLessThan(.25);
    }
  }
});

test('aim circles agree with actual short-shot splashes, including inherited ship velocity', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  const aim: Vec3 = [0, .5, -10000];
  Object.assign(sim.ship, { heading: .3, speed: 12, swaySpeed: 2 });
  // Fire at the current short-shot splash point so selective fire permits it.
  const splashAim = gunAimPoints(sim.player, sim.definition, 'main', aim)[0].point;
  sim.step({ throttle: 1, rudder: 0 }, { aim: splashAim, fire: true, battery: 'main' });
  const shots = sim.events.filter(event => event.kind === 'shot' && event.message === 'Anton fired');
  expect(shots).toHaveLength(2);
  const prediction = gunAimPoints(sim.player, sim.definition, 'main', aim)[0];
  expect(prediction.point[1]).toBeCloseTo(0, 9);
  for (let i = 0; i < 1200 && sim.shells.some(shell => shots.some(shot => shot.shell?.id === shell.id)); i++) {
    sim.step({ throttle: 1, rudder: 0 }, { aim, fire: false, battery: 'main' });
  }
  const impacts = sim.events.filter(event => event.kind === 'splash' && shots.some(shot => shot.shell?.id === event.shell?.id));
  expect(impacts).toHaveLength(2);
  const average = new Vector3();
  impacts.forEach(impact => average.addScaledVector(new Vector3(...impact.position), 1 / impacts.length));
  expect(average.distanceTo(new Vector3(...prediction.point))).toBeLessThan(.1);
});

test('moving and turning ship solutions line up and switching batteries preserves turret numbering', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  Object.assign(sim.ship, { heading: .2, speed: 13, swaySpeed: 1.5 });
  const aim: Vec3 = [5000, 10, -2000];
  const mount = sim.definition.mounts[0], state = sim.player.mounts[0];
  for (let i = 0; i < 2400; i++) updateMount(mount, state, sim.definition, sim.ship, aim, FIXED_DT, motionVelocity(sim.ship));
  expect(gunAimPoints(sim.player, sim.definition, 'main', aim)[0].aligned).toBe(true);
  const secondary = gunAimPoints(sim.player, sim.definition, 'secondary', aim);
  expect(secondary.map(point => point.id)).toEqual(sim.definition.mounts.filter(mount => mount.battery === 'secondary').map(mount => mount.id));
  expect(secondary.map(point => point.number)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('in-view circles use their actual projected position; off-screen and aft cues never mirror', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const camera = new PerspectiveCamera(52, width / height, .5, 60000);
    camera.updateMatrixWorld();
    const point = new Vector3(0, 0, -1000);
    const center = projectGunAim(point, camera, width, height);
    expect(center).toMatchObject({ x: width / 2, y: height / 2, edge: false, behind: false });
    for (const z of [-100, 100]) {
      const right = projectGunAim(new Vector3(1000, 0, z), camera, width, height);
      expect(right.edge).toBe(true);
      expect(right.behind).toBe(z > 0);
      expect(right.x).toBeGreaterThan(width / 2);
      expect(right.x).toBeLessThan(width - 25);
      const left = projectGunAim(new Vector3(-1000, 0, z), camera, width, height);
      expect(left.x).toBeLessThan(width / 2);
      expect(left.x).toBeGreaterThan(25);
    }
  }
});

test('converging guns retain separate readiness/countdowns and readable labels without moving their aim', () => {
  const points: GunAimPoint[] = [0, 0, 5, 12].map((reload, i) => ({ id: String(i), number: i + 1, name: `Turret ${i + 1}`, point: [0, 0, -1000], aligned: false, status: reload ? 'reloading' : 'ready', reload }));
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const camera = new PerspectiveCamera(52, width / height, .5, 60000);
    camera.updateMatrixWorld();
    const groups = groupGunAim(points, camera, width, height);
    expect(groups.map(group => group.points.map(point => point.number))).toEqual([[1, 2], [3], [4]]);
    expect(groups.map(group => group.reload)).toEqual([0, 5, 12]);
    expect(groups.every(group => group.x === width / 2 && group.y === height / 2)).toBe(true);
    // Different statuses need separate labels even at an identical aim position.
    points[0].aligned = true; points[1].status = 'disabled';
    const mixed = groupGunAim(points, camera, width, height);
    expect(mixed).toHaveLength(4);
    const boxes = placeGunAimLabels(mixed.map(group => ({ ...group, width: 120, height: 19 })), width, height);
    boxes.forEach((box, i) => {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
      for (const other of boxes.slice(i + 1)) expect(box.x >= other.x + other.width || box.x + box.width <= other.x || box.y >= other.y + other.height || box.y + box.height <= other.y).toBe(true);
    });
    points[0].aligned = false; points[1].status = 'ready';
  }
});
