import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { createDamage, maxHullIntegrity } from './damage';

const health = [['yamato', 73553], ['bismarck', 50750], ['enterprise-cv6', 33237], ['baltimore', 24255]] as const;

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
  expect(maxHullIntegrity(custom)).toBe(27019);
  custom.hull.massKg *= 2;
  expect(maxHullIntegrity(custom)).toBe(47043);
  custom.armor = []; custom.modules = []; custom.mounts = [];
  expect(maxHullIntegrity(custom)).toBe(47043);
  custom.hull.massKg = 1000;
  expect(maxHullIntegrity(custom)).toBe(10);
});

test('custom hulls receive a gentle small-ship bonus without flat base HP', () => {
  const custom = structuredClone(shipPreset('baltimore'));
  custom.id = 'custom-hull';
  // Doubling tonnage gives about 74% more HP, rather than 100% or the old square-root bonus.
  for (const massKg of [10_000, 769_000, 1_000_000, 4_000_000, 20_000_000, 100_000_000]) {
    custom.hull.massKg = massKg;
    const hp = createDamage(custom).integrity;
    custom.hull.massKg *= 2;
    expect(maxHullIntegrity(custom) / hp).toBeGreaterThan(1.7);
    expect(maxHullIntegrity(custom) / hp).toBeLessThan(1.8);
  }
});

test('U-boat durability stays near the requested 2,000 HP', () => {
  expect(maxHullIntegrity(shipPreset('type-viic'))).toBe(1993);
});

test('mixed fleet telemetry and resets use each hull maximum', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), {
    friendlyBots: [shipPreset('bismarck')], enemies: [shipPreset('enterprise-cv6'), shipPreset('baltimore')],
  });
  for (const actor of sim.actors) actor.damage.integrity *= .6;
  const telemetry = sim.telemetry('main', [0, 0, -5000]);
  expect(telemetry.playerMaxIntegrity).toBe(73553);
  expect(telemetry.playerIntegrity).toBeCloseTo(.6);
  expect(telemetry.targetIntegrity).toBeCloseTo(.6);
  for (const contact of telemetry.contacts) expect(contact.integrity).toBeCloseTo(.6);
  sim.selectTarget('enemy-2');
  expect(sim.telemetry('main', [0, 0, -5000]).targetIntegrity).toBeCloseTo(.6);
  sim.reset();
  expect(sim.actors.map(actor => actor.damage.integrity)).toEqual(health.map(([, hp]) => hp));
  expect(sim.telemetry('main', [0, 0, -5000]).contacts.every(c => c.integrity === 1)).toBe(true);
});
