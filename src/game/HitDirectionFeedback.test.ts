import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { CombatSimulation, type CombatEvent } from '../simulation/combat';
import { FIXED_DT } from '../simulation/ship';
import { HitDirectionFeedback } from './HitDirectionFeedback';

function fixture() {
  const definition: ShipDefinition = { ...shipPreset('baltimore'), mounts: [], modules: [],
    armor: [{ id: 'hull', name: 'Hull', center: [0, 0, 0], size: [20, 10, 100], thicknessMm: 1000 }] };
  return new CombatSimulation(definition);
}
function report(sim: CombatSimulation, bearing = 0, overrides: Partial<CombatEvent> = {}) {
  const id = (sim.events.at(-1)?.sequence ?? 0) + 1;
  sim.events.push({ sequence: id, tick: sim.tick, kind: 'stopped', position: [0, 1, 0], message: 'Armor hit', shipId: sim.player.motion.id,
    shell: { id, caliberM: .38, velocity: [-Math.sin(bearing) * 820, -20, Math.cos(bearing) * 820] }, ...overrides });
}

test('real stopped shells point toward their source without requiring hull damage or mutating combat', () => {
  const approaches: { position: Vec3; velocity: Vec3; angle: number }[] = [
    { position: [-15, 1, 0], velocity: [820, 0, 0], angle: -Math.PI / 2 },
    { position: [15, 1, 0], velocity: [-820, 0, 0], angle: Math.PI / 2 },
    { position: [0, 1, -55], velocity: [0, 0, 820], angle: 0 },
    { position: [0, 1, 55], velocity: [0, 0, -820], angle: Math.PI },
  ];
  for (const approach of approaches) {
    const sim = fixture(), hp = sim.player.damage.integrity;
    sim.shells.push({ id: 1, ownerId: sim.target.motion.id, position: approach.position, velocity: approach.velocity,
      age: 0, damage: 100, penetrationMm: 1, caliberM: .38, visited: [] });
    sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
    expect(sim.events.some(e => e.shipId === sim.player.motion.id && e.kind === 'stopped')).toBe(true);
    expect(sim.player.damage.integrity).toBe(hp);
    const before = JSON.stringify(sim);
    const cues = new HitDirectionFeedback().update(sim, 0);
    expect(cues).toHaveLength(1);
    expect(Math.cos(cues[0].angle)).toBeCloseTo(Math.cos(approach.angle));
    expect(Math.sin(cues[0].angle)).toBeCloseTo(Math.sin(approach.angle));
    expect(cues[0].opacity).toBe(1);
    expect(JSON.stringify(sim)).toBe(before);
  }
});

test('world bearings rotate with the camera and wrap correctly through north', () => {
  const sim = fixture(), feedback = new HitDirectionFeedback();
  report(sim, Math.PI / 2);
  expect(feedback.update(sim, 0)[0].angle).toBeCloseTo(Math.PI / 2);
  expect(feedback.update(sim, Math.PI / 2)[0].angle).toBeCloseTo(0);
  expect(Math.abs(feedback.update(sim, -Math.PI / 2)[0].angle)).toBeCloseTo(Math.PI);
  expect(feedback.update(sim, Math.PI * 2)[0].angle).toBeCloseTo(Math.PI / 2);
});

test('layered damage reports count once and same-direction salvo hits share a cue', () => {
  const sim = fixture(), feedback = new HitDirectionFeedback();
  report(sim, 0);
  const first = feedback.update(sim, 0)[0];
  sim.tick = Math.round(1.5 / FIXED_DT);
  report(sim, Math.PI / 2, { kind: 'module', shell: sim.events[0].shell });
  const faded = feedback.update(sim, 0);
  expect(faded).toHaveLength(1);
  expect(faded[0].id).toBe(first.id);
  expect(faded[0].opacity).toBeCloseTo(.7);
  report(sim, .1, { kind: 'ricochet' });
  const merged = feedback.update(sim, 0);
  expect(merged).toHaveLength(1);
  expect(merged[0].id).toBe(first.id);
  expect(merged[0].angle).toBeCloseTo(.1);
  expect(merged[0].opacity).toBe(1);
  report(sim, -Math.PI / 2, { kind: 'penetration' });
  expect(feedback.update(sim, 0)).toHaveLength(2);
});

test('pause freezes cues, old events do not refresh them and battle resets clear them', () => {
  const sim = fixture(), feedback = new HitDirectionFeedback();
  report(sim);
  feedback.update(sim, 0);
  sim.tick = Math.round(1.7 / FIXED_DT);
  const paused = feedback.update(sim, 0);
  expect(paused[0].opacity).toBeCloseTo(.5);
  for (let i = 0; i < 100; i++) expect(feedback.update(sim, 0)).toEqual(paused);
  sim.tick = Math.ceil(2.2 / FIXED_DT);
  expect(feedback.update(sim, 0)).toEqual([]);
  report(sim);
  expect(feedback.update(sim, 0)).toHaveLength(1);
  sim.reset();
  expect(feedback.update(sim, 0)).toEqual([]);
  report(sim);
  expect(feedback.update(sim, 0)).toHaveLength(1);
  expect(feedback.update(fixture(), 0)).toEqual([]);
});

test('splashes, other victims and events without a usable shell direction never show hit cues', () => {
  const sim = fixture(), feedback = new HitDirectionFeedback();
  for (const kind of ['splash', 'shot', 'sunk'] as const) report(sim, 0, { kind });
  report(sim, 0, { shipId: sim.target.motion.id });
  report(sim, 0, { shell: undefined });
  for (const velocity of [[0, -100, 0], [NaN, 0, 820], [0, Infinity, 820]] as Vec3[])
    report(sim, 0, { shell: { id: sim.events.length + 1, caliberM: .38, velocity } });
  expect(feedback.update(sim, 0)).toEqual([]);
  report(sim, Math.PI, { kind: 'module' });
  expect(feedback.update(sim, 0)).toHaveLength(1);
});

test('crossfire remains bounded and replaces the oldest direction', () => {
  const sim = fixture(), feedback = new HitDirectionFeedback();
  for (let i = 0; i < 7; i++) {
    sim.tick = i;
    report(sim, i * Math.PI / 4);
    feedback.update(sim, 0);
  }
  const cues = feedback.update(sim, 0);
  expect(cues).toHaveLength(6);
  expect(cues.some(cue => cue.id === 1)).toBe(false);
  expect(cues.some(cue => cue.id === 7)).toBe(true);
});
