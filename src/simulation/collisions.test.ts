import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { resolveShipCollisions } from './collisions';
import { FIXED_DT, motionVelocity, stepShip } from './ship';
import { shipVelocity } from './bots';

const stop = { throttle: 0, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };

// A box-shaped authored hull gives exact contact distances and impulse outcomes,
// alongside the real preset regressions below.
function boxDefinition() {
  const definition = structuredClone(shipPreset('baltimore'));
  const hull = definition.hull;
  hull.halfBreadths = [[0, hull.beam / 2], [hull.length, hull.beam / 2]];
  return definition;
}

test('ramming a stationary broadside cannot sail through its hull', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  Object.assign(sim.ship, { z: 200, speed: 12 });
  Object.assign(sim.target.motion, { x: 0, z: 0, heading: Math.PI / 2 });
  // The player bow must stay outside the target's near side throughout contact,
  // including sustained engine pressure after the initial impact.
  for (let tick = 0; tick < 60 * 30; tick++) {
    sim.step({ throttle: 1, rudder: 0 }, intent);
    expect(sim.ship.z - sim.target.motion.z).toBeGreaterThanOrEqual(sim.definition.hull.length / 2 + sim.definition.hull.beam / 2 - .5);
  }
  expect(sim.ship.speed).toBeLessThan(12);
  expect(sim.target.motion.swaySpeed).toBeLessThan(-1);
});

test('equal head-on impacts cancel closing speed without bounce or arbitrary spin', () => {
  const sim = new CombatSimulation(boxDefinition());
  Object.assign(sim.ship, { speed: 12 });
  Object.assign(sim.target.motion, { x: 0, z: -sim.definition.hull.length + .1, heading: Math.PI, speed: 12 });
  resolveShipCollisions(sim.actors);
  expect(sim.ship.z - sim.target.motion.z).toBeGreaterThanOrEqual(sim.definition.hull.length);
  for (const actor of sim.actors) {
    expect(actor.motion.speed).toBeCloseTo(0, 8);
    expect(actor.motion.swaySpeed).toBeCloseTo(0, 8);
    expect(actor.motion.yawRate).toBeCloseTo(0, 8);
  }
});

test('a heavier hull moves less and contact conserves linear momentum', () => {
  const definition = boxDefinition(), heavy = structuredClone(definition);
  heavy.hull.massKg *= 4;
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [heavy] });
  Object.assign(sim.ship, { x: 0, z: 0, heading: 0, swaySpeed: 10 });
  Object.assign(sim.target.motion, { x: definition.hull.beam - .1, z: 0, heading: 0 });
  const initialTargetX = sim.target.motion.x;
  resolveShipCollisions(sim.actors);
  expect(sim.ship.swaySpeed).toBeCloseTo(2, 8);
  expect(sim.target.motion.swaySpeed).toBeCloseTo(2, 8);
  expect(-sim.ship.x).toBeCloseTo((sim.target.motion.x - initialTargetX) * 4, 8);
  const momentum = sim.actors.reduce((sum, actor) => sum + motionVelocity(actor.motion)[0] * actor.definition.hull.massKg, 0);
  expect(momentum).toBeCloseTo(10 * definition.hull.massKg, 3);
});

test('glancing sides preserve travel along the hull and outward motion is never pulled back', () => {
  const sim = new CombatSimulation(boxDefinition());
  Object.assign(sim.ship, { speed: 10, swaySpeed: 2 });
  Object.assign(sim.target.motion, { x: sim.definition.hull.beam - .1, z: 0 });
  resolveShipCollisions(sim.actors);
  expect(sim.ship.speed).toBe(10);
  expect(sim.target.motion.speed).toBe(0);
  expect(sim.ship.swaySpeed).toBeCloseTo(1, 8);
  sim.ship.swaySpeed = -2;
  sim.target.motion.x = sim.ship.x + sim.definition.hull.beam - .1;
  resolveShipCollisions(sim.actors);
  expect(sim.ship.swaySpeed).toBe(-2);
  expect(sim.target.motion.swaySpeed).toBeCloseTo(1, 8);
});

test('an off-center ram turns the struck hull and dissipates kinetic energy', () => {
  const sim = new CombatSimulation(boxDefinition());
  Object.assign(sim.ship, { x: 60, z: (sim.definition.hull.length + sim.definition.hull.beam) / 2 - .1, speed: 12 });
  Object.assign(sim.target.motion, { x: 0, z: 0, heading: Math.PI / 2 });
  const energy = () => sim.actors.reduce((sum, actor) => {
    const m = actor.motion, h = actor.definition.hull;
    return sum + .5 * h.massKg * (m.speed ** 2 + m.swaySpeed ** 2 + m.yawRate ** 2 * (h.length ** 2 + h.beam ** 2) / 12);
  }, 0);
  const before = energy();
  resolveShipCollisions(sim.actors);
  expect(sim.target.motion.yawRate).toBeLessThan(-.001);
  expect(sim.ship.speed).toBeLessThan(12);
  expect(energy()).toBeLessThan(before);
});

test('turning a stern into another ship creates contact even without forward motion', () => {
  const sim = new CombatSimulation(boxDefinition());
  const hull = sim.definition.hull;
  Object.assign(sim.ship, { yawRate: .02, rudder: 1 });
  Object.assign(sim.target.motion, { x: -hull.beam - .01, z: hull.length * .6 });
  sim.step(stop, intent);
  expect(sim.target.motion.swaySpeed).toBeLessThan(0);
  expect(sim.ship.yawRate).toBeLessThan(.019);
});

test('reverse propulsion cannot back through a broadside hull', () => {
  const sim = new CombatSimulation(boxDefinition());
  const clearance = (sim.definition.hull.length + sim.definition.hull.beam) / 2;
  Object.assign(sim.ship, { z: -clearance - .02, speed: -4 });
  Object.assign(sim.target.motion, { x: 0, z: 0, heading: Math.PI / 2 });
  for (let tick = 0; tick < 600; tick++) {
    sim.step({ throttle: -1, rudder: 0 }, intent);
    expect(sim.target.motion.z - sim.ship.z).toBeGreaterThanOrEqual(clearance - .01);
  }
  expect(sim.ship.speed).toBeGreaterThan(-4);
});

for (const id of ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6']) {
  test(`${id} can pass close alongside and its tapered ends don't collide like a box`, () => {
    const sim = new CombatSimulation(shipPreset(id)), hull = sim.definition.hull;
    Object.assign(sim.ship, { speed: 12 });
    Object.assign(sim.target.motion, { x: hull.beam + .2, z: 0 });
    const before = structuredClone(sim.actors.map(actor => actor.motion));
    resolveShipCollisions(sim.actors);
    expect(sim.actors.map(actor => actor.motion)).toEqual(before);
    // Only the narrow bow/stern regions share longitudinal space.
    Object.assign(sim.target.motion, { x: hull.beam * .8, z: -hull.length + 5 });
    const tapered = structuredClone(sim.actors.map(actor => actor.motion));
    resolveShipCollisions(sim.actors);
    expect(sim.actors.map(actor => actor.motion)).toEqual(tapered);
  });
}

test('allies, enemies and idle hulls collide; only wrecks below the other keel clear contact', () => {
  const sim = new CombatSimulation(boxDefinition(), { friendlyBots: [boxDefinition()], enemies: [boxDefinition()] });
  Object.assign(sim.ship, { heading: 0 });
  const ally = sim.actors[1], enemy = sim.target, beam = sim.definition.hull.beam;
  for (const other of [ally, enemy]) {
    Object.assign(ally.motion, { x: 1000, z: 0, heading: 0 });
    Object.assign(enemy.motion, { x: -1000, z: 0, heading: 0 });
    Object.assign(other.motion, { x: sim.ship.x + beam - .1, z: 0 });
    resolveShipCollisions(sim.actors);
    expect(other.motion.x - sim.ship.x).toBeGreaterThanOrEqual(beam);
  }
  enemy.damage.sunk = true;
  enemy.motion.x = sim.ship.x + beam - .1;
  resolveShipCollisions(sim.actors);
  expect(enemy.motion.x - sim.ship.x).toBeGreaterThanOrEqual(beam);
  enemy.motion.y = -50;
  enemy.motion.x = sim.ship.x + beam - .1;
  const before = { ...sim.ship };
  resolveShipCollisions(sim.actors);
  expect(sim.ship).toEqual(before);
});

test('ten-ship pile-ups and coincident spawns separate without invalid state', () => {
  const definition = boxDefinition(), beam = definition.hull.beam;
  const sim = new CombatSimulation(definition, { friendlyBots: Array(4).fill(definition), enemies: Array(5).fill(definition) });
  sim.actors.forEach((actor, i) => Object.assign(actor.motion, { x: i * (beam - .1), z: 0, heading: 0 }));
  for (let tick = 0; tick < 60; tick++) resolveShipCollisions(sim.actors);
  sim.actors.slice(1).forEach((actor, i) => expect(actor.motion.x - sim.actors[i].motion.x).toBeGreaterThanOrEqual(beam - .005));
  for (const actor of sim.actors) Object.assign(actor.motion, { x: 0, z: 0 });
  for (let tick = 0; tick < 120; tick++) resolveShipCollisions(sim.actors);
  for (const actor of sim.actors) expect(Object.values(actor.motion).filter(value => typeof value === 'number').every(Number.isFinite)).toBe(true);
  const positions = sim.actors.map(actor => actor.motion.x).sort((a, b) => a - b);
  positions.slice(1).forEach((x, i) => expect(x - positions[i]).toBeGreaterThanOrEqual(beam - .005));
});

test('collision movement is deterministic across display rates and reset clears contact motion', () => {
  const runs = [30, 60, 144].map(fps => {
    const sim = new CombatSimulation(boxDefinition());
    Object.assign(sim.ship, { z: 120, speed: 12 });
    Object.assign(sim.target.motion, { x: 0, z: 0, heading: Math.PI / 2 });
    for (let frame = 0; frame < fps * 10; frame++) sim.advance(1 / fps, { throttle: 1, rudder: 0 }, intent);
    return sim;
  });
  expect(runs[0].actors).toEqual(runs[1].actors);
  expect(runs[1].actors).toEqual(runs[2].actors);
  expect(Math.abs(runs[0].target.motion.swaySpeed)).toBeGreaterThan(1);
  runs[0].reset();
  for (const actor of runs[0].actors) {
    expect(actor.motion.swaySpeed).toBe(0);
    expect(actor.motion.yawRate).toBe(0);
  }
});

test('collision drift moves the ship, settles in water and is included in gun velocity', () => {
  const sim = new CombatSimulation(boxDefinition());
  sim.ship.swaySpeed = 4;
  sim.ship.heading = Math.PI / 2;
  stepShip(sim.ship, stop);
  expect(sim.ship.z).toBeCloseTo(sim.ship.swaySpeed * FIXED_DT, 10);
  expect(shipVelocity(sim.player)[2]).toBeCloseTo(sim.ship.swaySpeed, 10);
  const drift = sim.ship.swaySpeed;
  for (let tick = 0; tick < 600; tick++) stepShip(sim.ship, stop);
  expect(sim.ship.swaySpeed).toBeLessThan(drift / 10);
});
