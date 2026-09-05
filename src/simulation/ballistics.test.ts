import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { ballisticStep, dispersedDirection, dispersedSpeed, travelFactor } from './ballistics';
import { botAim, shipVelocity } from './bots';
import { add, dot, length, normalize, scale, sub } from './geometry';
import { solveBallistic, updateMount, muzzleWorld, shotDirection } from './weapons';
import { CombatSimulation } from './combat';

test('shared drag solution reaches elevated and lowered targets and composes across ticks', () => {
  const from: Vec3 = [32, 14, -200];
  for (const gun of catalog.parts) for (const range of [100, 1000, 5000, 15000]) for (const height of [-10, 0, 60]) {
    const target: Vec3 = [from[0] + range, height, from[2] + range * .2];
    const k = gun.ballistics.dragPerSecond;
    const solution = solveBallistic(from, target, gun.muzzleSpeed, k);
    if (!solution) { expect(range).toBeGreaterThan(1000); continue; }
    const v = scale(solution.direction, gun.muzzleSpeed);
    const exact = ballisticStep(from, v, solution.time, k);
    expect(length(sub(exact.position, target))).toBeLessThan(.0001);
    let flight = { position: from, velocity: v };
    for (let i = 0; i < 120; i++) flight = ballisticStep(flight.position, flight.velocity, solution.time / 120, k);
    expect(length(sub(exact.position, flight.position))).toBeLessThan(1e-7);
    expect(length(sub(exact.velocity, flight.velocity))).toBeLessThan(1e-7);
    if (height <= from[1]) expect(length(exact.velocity)).toBeLessThan(gun.muzzleSpeed + 1);
  }
  const vacuum = ballisticStep([0, 0, 0], [800, 0, 0], 10);
  expect(vacuum.position).toEqual([8000, -490.5, 0]);
  expect(solveBallistic(from, [10000, 0, 0], 100, .1)).toBeNull();
});

test('aiming a moving mount includes drag on inherited velocity', () => {
  const def = compileShip(blueprint, catalog), actor = new CombatSimulation(def).player;
  const mount = def.mounts[0], state = actor.mounts[0], inherited: Vec3 = [12, 0, -5];
  const aim: Vec3 = [4500, 2, -7000];
  for (let i = 0; i < 600; i++) updateMount(mount, state, def, actor.motion, aim, 1 / 60, inherited);
  const from = muzzleWorld(mount, state, 0, actor.motion), k = mount.weapon.ballistics!.dragPerSecond;
  let time = length(sub(aim, from)) / mount.weapon.muzzleSpeed;
  for (let i = 0; i < 10; i++) time = solveBallistic(from, sub(aim, scale(inherited, travelFactor(time, k))), mount.weapon.muzzleSpeed, k)!.time;
  const end = ballisticStep(from, add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), inherited), time, k);
  expect(length(sub(end.position, aim))).toBeLessThan(.1);
});

test('dispersion is bounded, unbiased and reproducible for horizontal and near-vertical fire', () => {
  const sigma = .0012;
  for (const direction of [[0, 0, -1], normalize([.05, 1, .01])] as Vec3[]) {
    let mean: Vec3 = [0, 0, 0], squares = 0;
    for (let shot = 0; shot < 10000; shot++) {
      const d = dispersedDirection(direction, sigma, 123456, shot);
      expect(d).toEqual(dispersedDirection(direction, sigma, 123456, shot));
      const angle = Math.acos(Math.min(1, dot(direction, d)));
      expect(angle).toBeLessThanOrEqual(3 * sigma);
      mean = add(mean, sub(d, direction)); squares += angle * angle;
    }
    expect(length(scale(mean, 1 / 10000))).toBeLessThan(sigma * .04);
    expect(Math.sqrt(squares / 10000)).toBeGreaterThan(sigma * 1.3);
    expect(Math.sqrt(squares / 10000)).toBeLessThan(sigma * 1.5);
  }
  expect(dispersedDirection([0, 0, -1], sigma, 1, 0)).not.toEqual(dispersedDirection([0, 0, -1], sigma, 2, 0));
});

test('battle reset repeats its seed and different seeds alter launches without changing shot count', () => {
  const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def, undefined, 42);
  const fire = (s: CombatSimulation) => {
    s.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: true, battery: 'main' });
    return s.events.filter(e => e.kind === 'shot').map(e => e.shell!.velocity);
  };
  const first = fire(sim); sim.reset();
  expect(fire(sim)).toEqual(first);
  const other = fire(new CombatSimulation(def, undefined, 43));
  expect(other.length).toBe(first.length); expect(other).not.toEqual(first);
});

test('versioned gun calibration validates limits and preserves omitted-field compatibility', () => {
  for (const [field, invalid] of [['dragPerSecond', -.01], ['dragPerSecond', .51], ['dispersionRad', NaN], ['dispersionRad', .021], ['muzzleSpeedSigmaFraction', -.01], ['muzzleSpeedSigmaFraction', .051], ['penetrationReferenceSpeedMps', 0], ['penetrationReferenceSpeedMps', 10001], ['basis', '']] as const) {
    const parts = structuredClone(catalog);
    Object.assign(parts.parts[0].ballistics, { [field]: invalid });
    expect(() => compileShip(blueprint, parts)).toThrow();
  }
  const legacy = structuredClone(catalog);
  legacy.parts.forEach(part => delete (part as { ballistics?: unknown }).ballistics);
  expect(compileShip(blueprint, legacy).mounts.every(m => m.weapon.ballistics === undefined)).toBe(true);
  expect(() => new CombatSimulation(compileShip(blueprint, catalog), undefined, -1)).toThrow();
});

test('authored penetration reference affects launch budget without changing the trajectory', () => {
  const launch = (referenceSpeed?: number) => {
    const def = compileShip(blueprint, catalog);
    def.mounts.forEach(m => { m.weapon.ballistics!.penetrationReferenceSpeedMps = referenceSpeed; });
    const sim = new CombatSimulation(def, undefined, 5);
    sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: true, battery: 'main' });
    return sim.shells[0];
  };
  const muzzle = launch(), reference = launch(500);
  expect(reference.velocity).toEqual(muzzle.velocity);
  expect(reference.position).toEqual(muzzle.position);
  expect(reference.penetrationMm).toBeGreaterThan(muzzle.penetrationMm * 1.9);
  expect(reference.penetrationMm).toBeLessThan(muzzle.penetrationMm * 2.1);
});

test('seeded muzzle-speed variation makes a range-dominated pattern around the nominal aim', () => {
  const from: Vec3 = [0, 14, 0], target: Vec3 = [15000, 0, 0], k = .0178;
  const solution = solveBallistic(from, target, 820, k)!;
  let along = 0, across = 0, speedMean = 0, short = 0, long = 0;
  for (let shot = 0; shot < 1000; shot++) {
    const speed = dispersedSpeed(820, .003, 77, shot);
    expect(speed).toEqual(dispersedSpeed(820, .003, 77, shot));
    expect(Math.abs(speed / 820 - 1)).toBeLessThanOrEqual(.009 + 1e-12);
    const velocity = scale(dispersedDirection(solution.direction, .00075, 77, shot), speed);
    let low = 0, high = 100;
    for (let i = 0; i < 30; i++) { const mid = (low + high) / 2; if (ballisticStep(from, velocity, mid, k).position[1] > 0) low = mid; else high = mid; }
    const point = ballisticStep(from, velocity, (low + high) / 2, k).position;
    along += (point[0] - target[0]) ** 2; across += point[2] ** 2; speedMean += speed;
    short += Number(point[0] < target[0]); long += Number(point[0] > target[0]);
  }
  expect(Math.sqrt(along / across)).toBeGreaterThan(3);
  expect(Math.abs(speedMean / 1000 - 820)).toBeLessThan(.3);
  expect(short).toBeGreaterThan(400); expect(long).toBeGreaterThan(400);
});

test('cached per-gun lead follows a moving target and reacquires a jumped aim point', () => {
  const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def), actor = sim.player, target = sim.target;
  Object.assign(actor.motion, { x: 0, y: 0, z: 0, heading: .2, speed: 12 });
  Object.assign(target.motion, { x: 4500, y: 0, z: -10000, heading: -.5, speed: 15 });
  const mount = def.mounts[0], state = actor.mounts[0], k = mount.weapon.ballistics!.dragPerSecond;
  for (let i = 0; i < 1800; i++) {
    for (const ship of [actor, target]) { const v = shipVelocity(ship); ship.motion.x += v[0] / 60; ship.motion.z += v[2] / 60; }
    const aim = botAim(actor, target, mount, state);
    updateMount(mount, state, def, actor.motion, aim, 1 / 60, shipVelocity(actor));
  }
  const from = muzzleWorld(mount, state, 0, actor.motion), time = state.aimCache!.time;
  const end = ballisticStep(from, add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), shipVelocity(actor)), time, k).position;
  const future = add([target.motion.x, .8, target.motion.z], scale(shipVelocity(target), time));
  expect(length(sub(end, future))).toBeLessThan(1);
  const jumped: Vec3 = [actor.motion.x + 1000, 4, actor.motion.z - 3000];
  for (let i = 0; i < 600; i++) updateMount(mount, state, def, actor.motion, jumped, 1 / 60, shipVelocity(actor));
  const newEnd = ballisticStep(muzzleWorld(mount, state, 0, actor.motion), add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), shipVelocity(actor)), state.aimCache!.time, k).position;
  expect(length(sub(newEnd, jumped))).toBeLessThan(.1);
  updateMount(mount, state, def, actor.motion, undefined, 1 / 60);
  expect(state.aimCache).toBeUndefined();
});
