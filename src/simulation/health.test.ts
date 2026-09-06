import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { createDamage, maxHullIntegrity } from './damage';

const health = [['yamato', 1750], ['bismarck', 1450], ['enterprise-cv6', 1180], ['baltimore', 1020]] as const;

test('preset hull health scales with authored displacement', () => {
  for (const [id, hp] of health) {
    const state = createDamage(shipPreset(id));
    expect(state.integrity).toBe(hp);
    expect(state.maxIntegrity).toBe(hp);
  }
  // Future blueprints follow the same rule without depending on a preset ID.
  const custom = structuredClone(shipPreset('baltimore'));
  custom.id = 'custom-hull';
  custom.hull.massKg = 20_000_000;
  expect(maxHullIntegrity(custom)).toBe(1080);
  custom.hull.massKg *= 2;
  expect(maxHullIntegrity(custom)).toBe(1400);
  custom.armor = []; custom.modules = []; custom.mounts = [];
  expect(maxHullIntegrity(custom)).toBe(1400);
  custom.hull.massKg = 1000;
  expect(maxHullIntegrity(custom)).toBeGreaterThanOrEqual(300);
});

test('destroyer-sized custom hulls retain useful HP with diminishing gains from extra mass', () => {
  const custom = structuredClone(shipPreset('baltimore'));
  custom.id = 'custom-destroyer';
  const samples = [[1000, 470], [2000, 550], [3000, 600], [4000, 650]];
  const actual = samples.map(([tonnes, hp]) => {
    custom.hull.massKg = tonnes * 1000;
    const integrity = createDamage(custom).integrity;
    expect(integrity).toBe(hp);
    return integrity;
  });
  // Doubling displacement increases endurance without doubling it.
  expect(actual[3]).toBeGreaterThan(actual[1]);
  expect(actual[3]).toBeLessThan(actual[1] * 2);
  let previous = 0;
  for (let tonnes = 1000; tonnes <= 100_000; tonnes += 1000) {
    custom.hull.massKg = tonnes * 1000;
    const hp = maxHullIntegrity(custom);
    expect(hp).toBeGreaterThanOrEqual(previous);
    previous = hp;
  }
});

test('mixed fleet telemetry and resets use each hull maximum', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), {
    friendlyBots: [shipPreset('bismarck')], enemies: [shipPreset('enterprise-cv6'), shipPreset('baltimore')],
  });
  for (const actor of sim.actors) actor.damage.integrity *= .6;
  const telemetry = sim.telemetry('main', [0, 0, -5000]);
  expect(telemetry.playerMaxIntegrity).toBe(1750);
  expect(telemetry.playerIntegrity).toBeCloseTo(.6);
  expect(telemetry.targetIntegrity).toBeCloseTo(.6);
  for (const contact of telemetry.contacts) expect(contact.integrity).toBeCloseTo(.6);
  sim.selectTarget('enemy-2');
  expect(sim.telemetry('main', [0, 0, -5000]).targetIntegrity).toBeCloseTo(.6);
  sim.reset();
  expect(sim.actors.map(actor => actor.damage.integrity)).toEqual(health.map(([, hp]) => hp));
  expect(sim.telemetry('main', [0, 0, -5000]).contacts.every(c => c.integrity === 1)).toBe(true);
});
