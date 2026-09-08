import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { afloatKg, evaluateOutcome, fleetBudget, matchDisplacementKg, physicalLoss, selectEnvironment, type Survivor } from './battleRules';
import fixture from '../../assets/gameplay/migration/reference.v1.json';
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
test('disarmed custom-battle vessels remain movable, targetable and scored; viable submarines count', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('type-viic')] });
  sim.player.mounts.forEach(m => m.hp = 0);
  sim.target.motion.y = -20;
  sim.step(helm, intent);
  expect(sim.player.damage.stability.combatLost).toBe(true);
  expect(physicalLoss(sim.player)).toBeUndefined(); expect(physicalLoss(sim.target)).toBeUndefined();
  expect(sim.player.motion.speed).toBeGreaterThan(0); expect(sim.result).toBe('active');
  expect(sim.telemetry('main', intent.aim).afloatKg).toEqual([matchDisplacementKg(sim.player.definition.hull.massKg), matchDisplacementKg(sim.target.definition.hull.massKg)]);
});
test('custom battle timeout freezes result, time and simulation; reset clears outcome', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('type-viic')] });
  sim.tick = 107999;
  sim.step(helm, intent);
  expect(sim.result).toBe('victory'); expect(sim.outcome?.reason).toBe('time-limit');
  expect(sim.telemetry('main', intent.aim).remainingSeconds).toBe(0);
  const x = sim.player.motion.x;
  sim.step(helm, { ...intent, fire: true });
  expect(sim.tick).toBe(108000); expect(sim.player.motion.x).toBe(x);
  sim.reset(); expect(sim.outcome).toBeUndefined(); expect(sim.result).toBe('active');
});
test('integer environment rolls match frozen Rust fixtures; night occurs about one time in ten', () => {
  for (const { seed, selection } of fixture.environments) expect(selectEnvironment(seed, ['open-ocean', 'islands'], ['map', 'clear', 'storm'])).toMatchObject(selection);
  let night = 0;
  for (let seed = 0; seed < 10000; seed++) { const roll = selectEnvironment(seed, ['ocean'], ['map', 'clear']); expect(roll.weather).toBe('clear'); night += Number(roll.timeOfDay === 'night'); }
  expect(night).toBeGreaterThan(850); expect(night).toBeLessThan(1150);
  expect(afloatKg([{ team: 'a', displacementKg: 3 }, { team: 'b', displacementKg: 9, physicalLoss: 'hull-failure' }])).toEqual([3, 0]);
});
