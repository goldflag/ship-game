import { expect, test } from 'bun:test';
import { shipPreset } from '../../ships/presets';
import { CombatSimulation } from '../../simulation/combat';
import { afloatKg, evaluateOutcome, fleetBudget, matchDisplacementKg, physicalLoss, selectEnvironment, type Survivor } from './battleRules';
const helm = { throttle: 1, rudder: 0 };
const intent = { aim: [0, 0, -5000] as [number, number, number], fire: false, battery: 'main' as const };
test('fleet caps accept their exact boundaries and reject the next unit', () => {
  const base = shipPreset('bismarck');
  const definitions = new Map([['heavy', { ...base, hull: { ...base.hull, massKg: 100_000_000 } }], ['small', { ...base, hull: { ...base.hull, massKg: 1 } }], ['carrier', { ...shipPreset('enterprise-cv6'), hull: { ...base.hull, massKg: 1 } }]]);
  expect(fleetBudget(['heavy', 'heavy'], definitions).error).toBeUndefined();
  expect(fleetBudget(['heavy', 'heavy', 'small'], definitions).error).toContain('200,000');
  expect(fleetBudget(Array(8).fill('small'), definitions).error).toBeUndefined();
  expect(fleetBudget(Array(9).fill('small'), definitions).error).toContain('8 vessels');
  expect(fleetBudget(Array(2).fill('carrier'), definitions).error).toBeUndefined();
  expect(fleetBudget(Array(3).fill('carrier'), definitions).error).toContain('2 carriers');
  expect(fleetBudget([], definitions).error).toBeDefined(); expect(fleetBudget(['unknown'], definitions).error).toBeDefined();
  expect(matchDisplacementKg(123.5)).toBe(124); expect(() => matchDisplacementKg(NaN)).toThrow();
});
test('the last completed tick resolves losses before scoring, with draws for ties', () => {
  const ships: Survivor[] = [{ team: 'a', displacementKg: 100 }, { team: 'b', displacementKg: 100 }];
  expect(evaluateOutcome(107999, ships)).toBeUndefined();
  expect(evaluateOutcome(108000, ships)).toMatchObject({ reason: 'time-limit', winnerTeamId: null });
  ships[1].physicalLoss = 'flooding';
  expect(evaluateOutcome(108000, ships)).toMatchObject({ reason: 'destruction', winnerTeamId: 'a', afloatKg: [100, 0] });
  ships[0].physicalLoss = 'capsize'; expect(evaluateOutcome(1, ships)?.winnerTeamId).toBeNull();
});
test('integer environment rolls stay deterministic; night occurs about one time in ten', () => {
  let night = 0;
  for (let seed = 0; seed < 10000; seed++) { const roll = selectEnvironment(seed, ['ocean'], ['map', 'clear']); expect(roll.weather).toBe('clear'); night += Number(roll.timeOfDay === 'night'); }
  expect(night).toBeGreaterThan(850); expect(night).toBeLessThan(1150);
  expect(afloatKg([{ team: 'a', displacementKg: 3 }, { team: 'b', displacementKg: 9, physicalLoss: 'hull-failure' }])).toEqual([3, 0]);
});
