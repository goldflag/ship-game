import { expect, test } from 'bun:test';
import { aircraftFollowView } from './AircraftFollow';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { aircraftDeckSpot } from '../simulation/aircraft';
import { localToWorld } from '../simulation/geometry';
import { Game } from './Game';
import { ShellFollow } from './ShellFollow';

test('aircraft camera samples airborne interpolation and follows deck poses without changing simulation', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const plane = sim.player.airWing!.planes[0];
  const hull = { ...sim.ship, x: 350, roll: .1, heading: 1 };
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
    simulation: sim, shellFollow, inPort: false, inspecting: false,
    rig: { setShellView() {}, cycle() { cycles++; }, update() {} },
  }) as Game;
  const selected = () => Reflect.get(game, 'followedAircraftId');
  game.followAircraft(sim.target.airWing!.planes[0].id); expect(selected()).toBeUndefined();
  const own = sim.player.airWing!.planes[0];
  game.followAircraft(own.id); expect(selected()).toBe(own.id); expect(shellFollow.enabled).toBe(false);
  game.cycleCamera(); expect(selected()).toBeUndefined(); expect(cycles).toBe(0);
  game.followAircraft(own.id); game.returnToShip(); expect(selected()).toBeUndefined();
  own.phase = 'lost'; game.followAircraft(own.id); expect(selected()).toBeUndefined();
});
