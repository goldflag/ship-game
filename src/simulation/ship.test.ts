import { describe, expect, test } from 'bun:test';
import { createShipState, stepShip, SingleplayerSimulation, BISMARCK } from './ship';

describe('ship simulation', () => {
  test('stays still without propulsion, even with the rudder over', () => {
    const ship = createShipState();
    for (let i = 0; i < 600; i++) stepShip(ship, { throttle: 0, rudder: 1 });
    expect(ship.speed).toBe(0);
    expect(ship.heading).toBe(0);
    expect(ship.distance).toBe(0);
  });
  test('accelerates north and respects maximum speed', () => {
    const ship = createShipState();
    for (let i = 0; i < 12000; i++) stepShip(ship, { throttle: 1, rudder: 0 });
    expect(ship.speed).toBe(BISMARCK.forwardSpeed);
    expect(ship.z).toBeLessThan(-1000);
    expect(ship.x).toBe(0);
  });
  test('starboard turns east; port turns west', () => {
    const right = createShipState();
    const left = createShipState();
    for (let i = 0; i < 3600; i++) {
      stepShip(right, { throttle: 1, rudder: 1 });
      stepShip(left, { throttle: 1, rudder: -1 });
    }
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeCloseTo(-left.x, 6);
  });
  test('stop coasts down; astern reverses after braking', () => {
    const ship = createShipState();
    ship.speed = 10;
    stepShip(ship, { throttle: 0, rudder: 0 });
    expect(ship.speed).toBeGreaterThan(9);
    for (let i = 0; i < 8000; i++) stepShip(ship, { throttle: -1, rudder: 0 });
    expect(ship.speed).toBe(-BISMARCK.reverseSpeed);
  });
  test('30, 60, and 144 fps produce the same fixed-tick state', () => {
    const runs = [30, 60, 144].map(fps => {
      const sim = new SingleplayerSimulation();
      for (let i = 0; i < fps * 20; i++) sim.advance(1 / fps, { throttle: 1, rudder: 0.5 });
      return sim.ship;
    });
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
  });
  test('clamps invalid commands and tab-resume deltas', () => {
    const sim = new SingleplayerSimulation();
    sim.advance(30, { throttle: NaN, rudder: Infinity });
    expect(sim.ship.tick).toBe(6);
    expect(sim.ship.speed).toBe(0);
    expect(sim.ship.rudder).toBe(0);
  });
});
