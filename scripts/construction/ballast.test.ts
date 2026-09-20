import { expect, test } from 'bun:test';
import { distribute, solveBallast, tankCapacityKg, type BallastTank, type Flotation } from './ballast';

const tank = (id: string, x: number, y: number, z: number, capacityKg: number): BallastTank => ({
  id,
  name: id,
  center: [x, y, z],
  size: [1, 1, 1],
  capacityKg,
});
/** Two deep tanks forward, two shallow ones aft, so height and length both bite. */
const tanks = () => [
  tank('fwd-low', 0, -6, -30, 1000),
  tank('fwd-high', 0, -2, -30, 1000),
  tank('aft-low', 0, -6, 30, 1000),
  tank('aft-high', 0, -2, 30, 1000),
];

test('capacity is the box volume at the working density', () => {
  expect(tankCapacityKg({ id: 't', name: 't', center: [0, 0, 0], size: [2, 3, 4] }, 1025)).toBeCloseTo(24 * 1025, 6);
});

test('mass goes into the lowest tanks first', () => {
  const filled = distribute(tanks(), 2000, 0);
  expect(Object.fromEntries(filled.fills.map((fill) => [fill.id, fill.massKg]))).toEqual({
    'fwd-low': 1000,
    'fwd-high': 0,
    'aft-low': 1000,
    'aft-high': 0,
  });
  expect(filled.centerY).toBe(-6);
  expect(filled.shortfallKg).toBe(0);
});

test('the fore-and-aft split moves the ballast centre to where the trim needs it', () => {
  const forward = distribute(tanks(), 2000, -15);
  expect(forward.centerZ).toBeCloseTo(-15, 3);
  expect(forward.fills.find((fill) => fill.id === 'fwd-low')!.massKg).toBeGreaterThan(
    forward.fills.find((fill) => fill.id === 'aft-low')!.massKg,
  );
  // Both sides fill bottom-first within their own share.
  expect(forward.fills.find((fill) => fill.id === 'fwd-high')!.massKg).toBeGreaterThan(0);
  expect(forward.fills.find((fill) => fill.id === 'aft-high')!.massKg).toBe(0);
});

test('capacity and spread are reported, never silently exceeded', () => {
  const overfilled = distribute(tanks(), 9000, 0);
  expect(overfilled.totalKg).toBe(4000);
  expect(overfilled.shortfallKg).toBe(5000);
  // Nothing sits beyond ±30 m, so a centre at −45 m cannot be reached and the error says how far short it fell.
  expect(Math.abs(distribute(tanks(), 2000, -45).centerZErrorM)).toBeGreaterThan(1);
});

/** A linear stand-in for the compiler: every kilogram sinks the ship a little, and the longitudinal
 * centre of the ballast pulls the centre of gravity with it. */
const model =
  (light = 8000, kgPerMetre = 2000): ((fills: { totalKg: number; centerZ?: number }) => Flotation) =>
  (fills) => ({
    massKg: light + fills.totalKg,
    waterlineY: -8 + fills.totalKg / kgPerMetre,
    lcgOffsetM: ((fills.centerZ ?? 0) * fills.totalKg) / (light + fills.totalKg),
  });

test('the solver reaches a waterline and an even keel, and says which compiles it took', async () => {
  const flotation = model();
  let compiles = 0;
  const solution = await solveBallast(
    tanks(),
    { waterlineY: -7, lcgOffsetM: 0, waterlineToleranceM: 0.005, lcgToleranceM: 0.02, iterations: 20 },
    async (distribution) => {
      compiles++;
      return flotation(distribution);
    },
  );
  expect(solution.converged).toBe(true);
  expect(solution.flotation.waterlineY).toBeCloseTo(-7, 2);
  expect(Math.abs(solution.flotation.lcgOffsetM)).toBeLessThan(0.02);
  expect(solution.distribution.totalKg).toBeGreaterThan(0);
  expect(compiles).toBe(solution.steps.length);
  expect(compiles).toBeLessThanOrEqual(21);
});

test('a waterline the tanks cannot reach ends with a note rather than a wrong answer', async () => {
  const flotation = model();
  const solution = await solveBallast(
    tanks(),
    { waterlineY: 0, lcgOffsetM: 0, waterlineToleranceM: 0.01, lcgToleranceM: 0.05, iterations: 6 },
    async (distribution) => flotation(distribution),
  );
  expect(solution.converged).toBe(false);
  expect(solution.note).toContain('capacity');
  expect(solution.distribution.totalKg).toBe(4000);
});
