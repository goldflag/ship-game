import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/type-viic/blueprint.json';
import battleship from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { orderDepth, submarinePropulsion } from './submarine';
import { FIXED_DT, motionVelocity, type HelmCommand } from './ship';
import { updateFlooding } from './damage';
import { firstTorpedoHit, tubeSolution, type Torpedo } from './torpedoes';
import { resolveShipCollisions } from './collisions';

const definition = compileShip(blueprint, catalog);
const aim: Vec3 = [0, 0, -1500];
const intent = { aim, battery: 'torpedo' as const, fire: false };
function run(sim: CombatSimulation, seconds: number, helm: HelmCommand = { throttle: .5, rudder: 0 }) {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) sim.step(helm, intent);
}

test('ballast takes time to flood, holds scope/deep depth, and surfaces without damage or false sinking', () => {
  for (const throttle of [0, .5, -1]) {
    const sim = new CombatSimulation(definition);
    orderDepth(sim.player, definition, 7);
    run(sim, 1, { throttle, rudder: 0 });
    expect(sim.ship.y).toBeGreaterThan(-.2);
    expect(sim.player.submarine!.ballastM3).toBeCloseTo(7);
    run(sim, 100, { throttle, rudder: 0 });
    expect(sim.ship.y).toBeCloseTo(-7, 1);
    expect(sim.player.damage.sunk).toBe(false);
    expect(sim.player.damage.compartments.every(c => c.waterM3 === 0)).toBe(true);
    orderDepth(sim.player, definition, 50);
    run(sim, 150, { throttle, rudder: 0 });
    expect(sim.ship.y).toBeCloseTo(-50, 1);
    expect(Math.abs(sim.ship.verticalSpeed!)).toBeLessThan(.02);
    expect(sim.player.damage.integrity).toBe(sim.player.damage.maxIntegrity);
    orderDepth(sim.player, definition, 0);
    run(sim, 100, { throttle, rudder: 0 });
    expect(sim.ship.y).toBeCloseTo(0, 2);
    expect(sim.player.submarine!.ballastM3).toBe(0);
    expect(sim.player.damage.sunk).toBe(false);
  }
});

test('emergency blow empties tanks faster, reverses a dive, and resets with the battle', () => {
  const normal = new CombatSimulation(definition), emergency = new CombatSimulation(definition);
  for (const sim of [normal, emergency]) { orderDepth(sim.player, definition, 80); run(sim, 25); }
  orderDepth(normal.player, definition, 0);
  orderDepth(emergency.player, definition, 0, true);
  run(normal, 4); run(emergency, 4);
  expect(emergency.player.submarine!.ballastM3).toBeLessThan(normal.player.submarine!.ballastM3);
  expect(emergency.ship.y).toBeGreaterThan(normal.ship.y);
  run(emergency, 60);
  expect(emergency.ship.y).toBeCloseTo(0, 2);
  emergency.reset();
  expect(emergency.player.submarine).toEqual({ targetDepthM: 0, ballastM3: 0, emergencyBlow: false, planes: 0, trimPitch: 0 });
  expect(emergency.ship.y).toBe(0);
});

test('submerged propulsion uses electric motors and its lower speed, independently of diesel damage', () => {
  const sim = new CombatSimulation(definition);
  sim.player.damage.modules.find(m => m.id === 'diesels')!.hp = 0;
  expect(submarinePropulsion(sim.player, definition)!.power).toBe(0);
  orderDepth(sim.player, definition, 7);
  run(sim, 120, { throttle: 1, rudder: 0 });
  expect(sim.ship.speed).toBeCloseTo(definition.submarine!.submergedHandling.forwardSpeed);
  expect(submarinePropulsion(sim.player, definition)!.power).toBe(1);
  sim.player.damage.modules.find(m => m.id === 'electric-motors')!.hp = 0;
  run(sim, 30, { throttle: 1, rudder: 0 });
  expect(sim.ship.speed).toBe(0);
  expect(motionVelocity({ ...sim.ship, verticalSpeed: -.3 })[1]).toBe(-.3);
});

test('submerged guns preserve ammunition; shallow torpedoes hit a surface hull while deep launches are blocked', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [compileShip(battleship, catalog)], spawnDistance: 1000 });
  sim.target.controller = 'idle';
  orderDepth(sim.player, definition, 7); run(sim, 120, { throttle: 0, rudder: 0 });
  const ammo = sim.player.mounts.map(m => m.ammo);
  for (let i = 0; i < 120; i++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, .5, -1000], battery: 'main', fire: true });
  expect(sim.player.mounts.map(m => m.ammo)).toEqual(ammo);
  expect(sim.player.mounts.every(m => m.status === 'submerged')).toBe(true);
  sim.requestFire(); run(sim, FIXED_DT, { throttle: 0, rudder: 0 });
  expect(sim.torpedoes).toHaveLength(1);
  expect(sim.torpedoes[0].position[1]).toBeLessThan(-7);
  run(sim, 50, { throttle: 0, rudder: 0 });
  expect(sim.events.some(e => e.kind === 'torpedo-hit')).toBe(true);
  expect(sim.target.damage.integrity).toBeLessThan(sim.target.damage.maxIntegrity);
  orderDepth(sim.player, definition, 50); run(sim, 150, { throttle: 0, rudder: 0 });
  const rounds = sim.player.torpedoTubes!.map(t => t.ammo);
  sim.requestFire(); run(sim, FIXED_DT);
  expect(sim.player.torpedoTubes!.every(t => t.status === 'too-deep')).toBe(true);
  expect(sim.player.torpedoTubes!.map(t => t.ammo)).toEqual(rounds);
});

test('diving hulls pass below surface hulls and shallow torpedoes, with depth-aware flooding', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [compileShip(battleship, catalog)], spawnDistance: 1000 });
  sim.target.controller = 'idle';
  sim.player.motion.y = -50; sim.target.motion.x = sim.ship.x; sim.target.motion.z = sim.ship.z;
  const torpedo: Torpedo = { id: 1, ownerId: sim.target.motion.id, tubeId: 'bow-tube-1', position: [0, -2, -100], velocity: [0, 0, 20], age: 0, distance: 400, weapon: definition.torpedoTubes![0].weapon };
  expect(firstTorpedoHit(torpedo, [0, -2, -100], [0, -2, 100], [sim.player])).toBeUndefined();
  resolveShipCollisions(sim.actors);
  expect(sim.ship.x).toBe(0); expect(sim.ship.z).toBe(0);
  const shallow = new CombatSimulation(definition).player, deep = sim.player;
  for (const actor of [shallow, deep]) { actor.damage.compartments[0].breachAreaM2 = .01; actor.damage.compartments[0].breachHeight = -1; updateFlooding(actor, definition, 1); }
  expect(deep.damage.compartments[0].waterM3).toBeGreaterThan(shallow.damage.compartments[0].waterM3);
  expect(deep.motion.y).toBe(-50);
  deep.damage.sunk = true; deep.motion.y = -90;
  updateFlooding(deep, definition, 1);
  expect(deep.motion.y).toBeLessThan(-90);
  orderDepth(deep, definition, 0, true);
  expect(deep.damage.sunk).toBe(true);
});

test('commands reject nonfinite input, clamp depth, and do not enable diving on a surface ship', () => {
  const sim = new CombatSimulation(definition);
  orderDepth(sim.player, definition, 1e8);
  expect(sim.player.submarine!.targetDepthM).toBe(definition.submarine!.maxDepthM);
  for (const n of [NaN, Infinity, -Infinity]) orderDepth(sim.player, definition, n);
  expect(sim.player.submarine!.targetDepthM).toBe(definition.submarine!.maxDepthM);
  orderDepth(sim.player, definition, -10); expect(sim.player.submarine!.targetDepthM).toBe(0);
  const surface = new CombatSimulation(compileShip(battleship, catalog));
  run(surface, 1, { throttle: 0, rudder: 0, depthM: 50 });
  expect(surface.player.submarine).toBeUndefined(); expect(surface.ship.y).toBeCloseTo(0);
});

test('diving is deterministic across display rates and bots dive while attacking', () => {
  const make = () => new CombatSimulation(definition, { friendlyBots: [], enemies: [definition], spawnDistance: 2000, seed: 12 });
  const a = make(), b = make();
  const command = { throttle: .5, rudder: .2, depthM: 25 };
  for (let i = 0; i < 1800; i++) a.advance(1 / 60, command, intent);
  for (let i = 0; i < 900; i++) b.advance(1 / 30, command, intent);
  expect(a.ship).toEqual(b.ship); expect(a.player.submarine).toEqual(b.player.submarine);
  expect(a.target.submarine!.targetDepthM).toBe(7);
  expect(a.target.motion.y).toBeLessThan(-5);
});

test('blueprint rejects unsafe or disconnected diving equipment', () => {
  for (const change of [
    (b: any) => b.submarine.maxDepthM = NaN,
    (b: any) => b.submarine.neutralBallastFraction = 1,
    (b: any) => b.submarine.surfaceEngineIds = ['missing'],
    (b: any) => b.submarine.submergedEngineIds = [],
    (b: any) => b.submarine.periscopeEye[1] = 2,
    (b: any) => b.submarine.maxTorpedoDepthM = 3,
    (b: any) => b.submarine.appendages.rudders = [...b.submarine.appendages.bowPlanes],
  ]) { const b = structuredClone(blueprint); change(b); expect(() => compileShip(b, catalog)).toThrow(/submarine/); }
});


test('pressure damages an uncontrollably deep boat; exposed tube mouths cannot launch into air', () => {
  const sim = new CombatSimulation(definition);
  sim.ship.y = -170; sim.player.submarine!.ballastM3 = 120;
  orderDepth(sim.player, definition, 150); run(sim, 1);
  expect(sim.player.damage.integrity).toBeLessThan(sim.player.damage.maxIntegrity);
  const tube = definition.torpedoTubes![0], state = sim.player.torpedoTubes![0];
  sim.ship.y = 0; sim.ship.pitch = .14;
  tubeSolution(sim.player, tube, state, aim, FIXED_DT);
  expect(state.status).toBe('above-water'); expect(state.ammo).toBe(3);
});
