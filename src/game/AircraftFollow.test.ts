import { expect, test } from 'bun:test';
import { aircraftFollowView } from './AircraftFollow';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { aircraftDeckSpot } from '../simulation/aircraft';
import { localToWorld, rotate } from '../simulation/geometry';
import { Euler, Quaternion } from 'three/webgpu';
import { aircraftGroundPose } from '../simulation/aircraftGroundPose';
import { Game } from './Game';
import { ShellFollow } from './ShellFollow';

test('aircraft camera samples airborne interpolation and follows deck poses without changing simulation', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const plane = sim.player.airWing!.planes[0];
  const hull = { ...sim.ship, x: 350, roll: .1, heading: 1 };
  expect(aircraftFollowView(plane, sim.player, hull, .5)).toBeUndefined();
  plane.deckSlot = 0;
  const before = structuredClone(plane);
  expect(aircraftFollowView(plane, sim.player, hull, .5)?.position).toEqual(localToWorld(aircraftDeckSpot(sim.player, plane), hull));
  expect(plane).toEqual(before);
  plane.phase = 'outbound'; plane.previousPosition = [100, 120, 30]; plane.position = [120, 130, 20]; plane.heading = Math.PI / 2;
  const view = aircraftFollowView(plane, sim.player, hull, .25)!;
  expect(view.position).toEqual([105, 122.5, 27.5]); expect(view.velocity[0]).toBeCloseTo(1);
  plane.phase = 'lost'; expect(aircraftFollowView(plane, sim.player, hull, .5)).toBeUndefined();
});

test('follow selects only surviving own aircraft, cancels shell follow, and camera controls return to ship', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const shellFollow = new ShellFollow(); shellFollow.setEnabled(true);
  let cycles = 0;
  const game = Object.assign(Object.create(Game.prototype), {
    simulation: sim, shellFollow, inPort: false, inspecting: false, fleetViews: [],
    rig: { setShellView() {}, cycle() { cycles++; }, update() {} },
  }) as Game;
  const selected = () => Reflect.get(game, 'followedAircraftId');
  game.followAircraft(sim.target.airWing!.planes[0].id); expect(selected()).toBeUndefined();
  const own = sim.player.airWing!.planes[0];
  game.followAircraft(own.id); expect(selected()).toBeUndefined();
  own.deckSlot = 0;
  game.followAircraft(own.id); expect(selected()).toBe(own.id); expect(shellFollow.enabled).toBe(false);
  game.cycleCamera(); expect(selected()).toBeUndefined(); expect(cycles).toBe(0);
  game.followAircraft(own.id); game.returnToShip(); expect(selected()).toBeUndefined();
  own.phase = 'lost'; game.followAircraft(own.id); expect(selected()).toBeUndefined();
});

test('deck follow keeps the fitted nose direction and explicit position across handling, taxi and launch', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const actor = sim.player, plane = actor.airWing!.planes[0];
  Object.assign(actor.motion, { heading: -.4, pitch: .11, roll: .09 });
  plane.deckSlot = 0; plane.deckPosition = [3, 13.2, -62]; plane.deckHeading = .7;
  const fitted = { heading: .7, pitch: .16, roll: -.07 };
  const cpuRotation = new Quaternion().setFromEuler(new Euler(actor.motion.pitch, -actor.motion.heading, actor.motion.roll, 'YXZ'))
    .multiply(new Quaternion().setFromEuler(new Euler(fitted.pitch, -fitted.heading, fitted.roll, 'YXZ')));
  const attitude = new Euler().setFromQuaternion(cpuRotation, 'YXZ');
  Object.assign(plane, { heading: -attitude.y, pitch: attitude.x, bank: attitude.z });
  const displayed = { x: 100, y: 5, z: 20, heading: .6, pitch: -.03, roll: -.08 };
  for (const phase of ['raising', 'ready', 'queued', 'taxi', 'rearming', 'launch-ready', 'takeoff', 'rollout', 'parking', 'lowering'] as const) {
    plane.phase = phase;
    const before = structuredClone(plane), hullBefore = structuredClone(actor.motion);
    for (const alpha of [0, .4, 1]) {
      const view = aircraftFollowView(plane, actor, displayed, alpha)!;
      expect(view.position).toEqual(localToWorld(plane.deckPosition, displayed));
      const nose = rotate(rotate([0, 0, -1], fitted), displayed);
      view.velocity.forEach((value, i) => expect(value).toBeCloseTo(nose[i], 10));
    }
    expect(plane).toEqual(before); expect(actor.motion).toEqual(hullBefore);
  }
});

test('legacy deck follow uses the nominal ground pitch when a fitted pose is absent', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const plane = sim.player.airWing!.planes[0]; plane.deckSlot = 0;
  const hull = { ...sim.player.motion, heading: 1, pitch: .03, roll: .1 };
  const expected = rotate(rotate([0, 0, -1], { heading: 0, roll: 0, pitch: aircraftGroundPose(plane.modelId).pitch }), hull);
  aircraftFollowView(plane, sim.player, hull, .5)!.velocity.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
});

test('fleet Follow lead selects another friendly carrier aircraft and survives spectator updates', () => {
  const sim = new CombatSimulation(shipPreset('fletcher'), {
    friendlyBots: [shipPreset('enterprise-cv6')], enemies: [shipPreset('enterprise-cv6')],
  });
  const carrier = sim.actors[1], plane = carrier.airWing!.planes[0];
  plane.phase = 'outbound'; plane.previousPosition = [100, 200, 300]; plane.position = [120, 220, 320];
  const views = sim.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const game = Object.assign(Object.create(Game.prototype), {
    simulation: sim, shellFollow: new ShellFollow(), inPort: false, inspecting: false,
    fleetCommandMode: true, airOperationsOpen: true, fleetViews: views, playerView: views[0],
    rig: { setShellView() {}, update() {}, setInspecting() {}, setBridge() {}, setHullLength() {}, setSubmarine() {}, releasePointer() {} },
    battlefieldCamera: { cancelTransition() {} }, input: { clear() {} },
    // Map close is covered by GameFrame; this seam runs the real follow and spectator methods.
    setAirOperationsOpen(open: boolean) { this.airOperationsOpen = open; },
  }) as Game;
  game.followAircraft(plane.id);
  expect(Reflect.get(game, 'followedAircraftId')).toBe(plane.id);
  expect(game.airOperationsOpen).toBe(false);
  Reflect.get(game, 'updateSpectator').call(game);
  expect(Reflect.get(game, 'followedAircraftId')).toBe(plane.id);
  expect(Reflect.get(game, 'followedView').call(game, .5)?.position).toEqual([110, 210, 310]);
  game.returnToShip();
  const enemy = sim.target.airWing!.planes[0]; enemy.phase = 'outbound';
  game.followAircraft(enemy.id);
  expect(Reflect.get(game, 'followedAircraftId')).toBeUndefined();
  sim.player.damage.sunk = true;
  game.followAircraft(plane.id);
  expect(Reflect.get(game, 'followedAircraftId')).toBe(plane.id);
  plane.phase = 'ready'; plane.deckSlot = 0;
  expect(Reflect.get(game, 'followedView').call(game, .5)?.position)
    .toEqual(localToWorld(aircraftDeckSpot(carrier, plane), carrier.motion));
  plane.phase = 'lost';
  expect(Reflect.get(game, 'followedView').call(game, .5)).toBeUndefined();
  expect(Reflect.get(game, 'followedAircraftId')).toBeUndefined();
});
