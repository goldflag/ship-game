import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { aircraftAttitude, aircraftControls, flyAircraft, stepFlightMechanisms } from './aircraftFlight';
import { clearFighterLane, fighterGunAim, fighterTarget } from './aircraftTactics';
import { length, localToWorld, sub } from './geometry';
import { stepAircraft, type AirContext } from './aircraft';

function fixture() {
  const def = shipPreset('enterprise-cv6');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def], seed: 42 });
  sim.target.controller = 'idle';
  const p = sim.player.airWing!.planes[0], hostile = sim.target.airWing!.planes[0];
  for (const plane of [p, hostile]) { plane.phase = 'outbound'; plane.position = [0, 400, 0]; plane.velocity = [0, 0, -100]; plane.heading = 0; }
  return { sim, p, hostile };
}

test('bank rolls in before a coordinated turn, with finite pitch and speed response', () => {
  const { p } = fixture();
  flyAircraft(p, [3000, 900, -3000], 120, 1 / 60);
  expect(p.bank).toBeLessThan(0); expect(Math.abs(p.bank)).toBeLessThan(.02);
  expect(p.heading).toBeGreaterThan(0); expect(p.heading).toBeLessThan(.001);
  expect(p.pitch).toBeLessThan(.004); expect(length(p.velocity)).toBeLessThan(100.2);
  for (let i = 0; i < 180; i++) {
    const position = [...p.position] as typeof p.position;
    flyAircraft(p, [3000, 900, -3000], 120, 1 / 60);
    expect(length(sub(p.position, position))).toBeCloseTo(length(p.velocity) / 60, 8);
  }
  expect(p.heading).toBeGreaterThan(.3);
});

test('a steep descent begins pulling out before the sea and gear/brakes deploy gradually', () => {
  const { p } = fixture(); p.role = 'dive-bomber'; p.phase = 'attack'; p.payload = true; p.pitch = -.7;
  p.position = [0, 150, 0]; p.velocity = [0, -65, -80]; p.controls.gear = 0;
  stepFlightMechanisms(p, 1 / 60, false);
  expect(p.controls.brakes).toBeGreaterThan(0); expect(p.controls.brakes).toBeLessThan(.02);
  for (let i = 0; i < 300; i++) { flyAircraft(p, [0, 0, -2000], 100, 1 / 60, { dive: true }); expect(p.position[1]).toBeGreaterThan(20); }
  p.phase = 'landing'; stepFlightMechanisms(p, 1 / 60, false);
  expect(p.controls.gear).toBeGreaterThan(0); expect(p.controls.gear).toBeLessThan(.01);
  expect(p.controls.hook).toBeGreaterThan(0);
});

test('attitude and mechanisms interpolate across wrap and remain read-only during pause', () => {
  const { p } = fixture();
  p.previousAttitude = { heading: Math.PI - .1, pitch: -.2, bank: -.4 };
  p.heading = -Math.PI + .1; p.pitch = .2; p.bank = .4;
  p.previousControls = { ...p.controls, gear: 0, propeller: Math.PI - .2 };
  p.controls.gear = 1; p.controls.propeller = -Math.PI + .2;
  const before = structuredClone(p);
  expect(Math.abs(aircraftAttitude(p, .5).heading)).toBeCloseTo(Math.PI);
  expect(aircraftAttitude(p, .5).bank).toBeCloseTo(0);
  expect(aircraftControls(p, .5).gear).toBeCloseTo(.5);
  expect(aircraftControls(p, .5).propeller).toBeCloseTo(Math.PI);
  expect(p).toEqual(before);
});

test('fighters require a forward gun solution and hold fire through an ally', () => {
  const { sim, p, hostile } = fixture(); hostile.position = [300, 400, -300];
  expect(fighterGunAim(p, hostile).alignment).toBeLessThan(.8);
  hostile.position = [0, 400, 300]; expect(fighterGunAim(p, hostile).alignment).toBeLessThan(0);
  hostile.position = [0, 400, -350]; expect(fighterGunAim(p, hostile).alignment).toBeCloseTo(1);
  const friend = sim.player.airWing!.planes[1]; friend.phase = 'outbound'; friend.position = [0, 400, -150];
  expect(clearFighterLane(p, hostile.position, sim.aircraft)).toBe(false);
  friend.position[0] = 60; expect(clearFighterLane(p, hostile.position, sim.aircraft)).toBe(true);
});

test('fighters prioritize inbound loaded bombers, retain targets, and discard losses', () => {
  const { sim, p, hostile } = fixture(); hostile.position = [700, 400, 0];
  const bomber = sim.target.airWing!.planes.find(plane => plane.role === 'torpedo-bomber')!;
  bomber.phase = 'attack'; bomber.position = [0, 400, -1000]; bomber.velocity = [0, 0, 70];
  expect(fighterTarget(p, sim.aircraft, [0, 0, 0], 1 / 60)).toBe(bomber);
  hostile.position = [0, 400, -300];
  expect(fighterTarget(p, sim.aircraft, [0, 0, 0], 1 / 60)).toBe(bomber);
  bomber.phase = 'lost'; bomber.hp = 0;
  expect(fighterTarget(p, sim.aircraft, [0, 0, 0], 1 / 60)).toBe(hostile);
});

test('aircraft flight and pilot memory replay identically with no renderer', () => {
  function run() {
    const { sim } = fixture(); sim.reset(); sim.target.controller = 'bot'; sim.launchAircraft('vf-6'); sim.launchAircraft('vt-6');
    let id = 0;
    const ctx: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++id, emit: () => {} };
    for (let tick = 0; tick < 150 * 60; tick++) stepAircraft(ctx, 1 / 60, tick / 60);
    return sim.aircraft;
  }
  expect(run()).toEqual(run());
});

test('recovery follows a moving, rotated carrier and makes one continuous touchdown', () => {
  const { sim, p, hostile } = fixture(); hostile.phase = 'ready';
  sim.ship.heading = .7; sim.ship.speed = 9;
  p.phase = 'returning'; p.heading = .7;
  p.position = localToWorld([0, 170, 2450], sim.ship);
  p.velocity = [Math.sin(.7) * 65, 0, -Math.cos(.7) * 65];
  let recovered = 0, largestLandingStep = 0;
  const ctx: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => 1, emit: event => { if (event.kind === 'aircraft-recovered') recovered++; } };
  for (let tick = 0; tick < 180 * 60; tick++) {
    sim.ship.x += Math.sin(.7) * 9 / 60; sim.ship.z -= Math.cos(.7) * 9 / 60;
    const previous = [...p.position] as typeof p.position, landing = String(p.phase) === 'landing';
    stepAircraft(ctx, 1 / 60, tick / 60);
    if (landing) largestLandingStep = Math.max(largestLandingStep, length(sub(p.position, previous)));
  }
  expect(recovered).toBe(1); expect(String(p.phase)).toBe('ready');
  expect(largestLandingStep).toBeLessThan(1.2);
});
