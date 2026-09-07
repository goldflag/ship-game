import { expect, test } from 'bun:test';
import { CombatSimulation, type CombatEvent } from '../simulation/combat';
import { HitFeedback } from './HitFeedback';
import { localToWorld } from '../simulation/geometry';
import { shipPreset } from '../ships/presets';

test('impact labels combine one shell’s layers, keep module names and actual hull damage, and freeze while paused', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), feedback = new HitFeedback();
  const hit = (sequence: number, overrides = {}): CombatEvent => ({ sequence, tick: 60, kind: 'penetration', shipId: sim.target.motion.id,
    position: localToWorld([2, 3, -80], sim.target.motion), message: 'impact',
    impact: { shellId: 1, shipId: sim.target.motion.id, targetId: 'belt', targetName: 'Main belt', kind: 'armor', position: [2, 3, -80], penetrationBeforeMm: 500, penetrationAfterMm: 100, outcome: 'penetrated', hullDamage: 45.5, ...overrides } });
  sim.tick = 60;
  sim.events.push(hit(1), hit(2, { targetId: 'turret', targetName: 'Anton turret', kind: 'mount', outcome: 'destroyed', hullDamage: 14 }));
  const cue = feedback.update(sim)[0];
  expect(cue.part).toBe('Anton turret'); expect(cue.result).toBe('Destroyed'); expect(cue.damage).toBe(59.5);
  expect(cue.position[2]).toBeCloseTo(-80);
  expect(feedback.update(sim)).toHaveLength(1); expect(feedback.update(sim)[0].damage).toBe(59.5);
  sim.tick = 230; expect(feedback.update(sim)[0].opacity).toBeLessThan(1);
  const paused = feedback.update(sim)[0].opacity; expect(feedback.update(sim)[0].opacity).toBe(paused);
  sim.tick = 300; expect(feedback.update(sim)).toHaveLength(0);
});

test('torpedo HP and armor rejection are explicit, friendly impacts excluded, and new battles clear cues', () => {
  const sim = new CombatSimulation(shipPreset('type-viic')), feedback = new HitFeedback();
  sim.tick = 1;
  sim.events.push({ sequence: 1, tick: 1, kind: 'torpedo-hit', shipId: sim.target.motion.id, position: [0, -2, -100], message: 'Torpedo hit · Engine room · flooding breach', hullDamage: 300,
    torpedo: { id: 2, velocity: [0, 0, -20], diameterM: .533 } });
  sim.events.push({ ...sim.events[0], sequence: 2, shipId: sim.player.motion.id });
  expect(feedback.update(sim)).toHaveLength(1);
  expect(feedback.update(sim)[0]).toMatchObject({ part: 'Engine room', damage: 300, result: 'Flooding breach' });
  sim.events.push({ ...sim.events[0], sequence: 3, kind: 'torpedo-dud', hullDamage: 0, torpedo: { id: 3, velocity: [0, 0, -20], diameterM: .533 }, message: 'Torpedo dud · impact before arming' });
  expect(feedback.update(sim).at(-1)).toMatchObject({ damage: 0, result: 'Unarmed impact' });
  expect(feedback.update(new CombatSimulation(shipPreset('type-viic')))).toHaveLength(0);
});
