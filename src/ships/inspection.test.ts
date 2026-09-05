import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from './presets';
import { entriesForMode, inspectionEntries } from './inspection';
import { ShipInspection } from '../game/ShipInspection';
import { CombatSimulation } from '../simulation/combat';

test('inspection lists exactly the armor, mounts, modules and compartments used by each ship', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id), entries = inspectionEntries(def);
    expect(entriesForMode(entries, 'armor').length).toBe(def.armor.length + def.mounts.filter(m => !def.armor.some(a => a.plate?.mountId === m.id)).length);
    expect(entriesForMode(entries, 'internals').length).toBe(def.modules.length + def.compartments.length);
    expect(entriesForMode(entries, 'exterior')).toEqual([]);
    const armor = entries.find(e => e.id === `armor:${def.armor[0].id}`)!;
    expect(armor.thicknessMm).toBe(def.armor[0].thicknessMm);
    expect(armor.size).toEqual(def.armor[0].size);
    const gunhouse = entries.find(e => e.mountIndex === 0)!;
    expect(gunhouse.thicknessMm).toBeGreaterThan(0);
    expect(def.armor.some(a => a.plate?.mountId === def.mounts[0].id) ? gunhouse.plate : gunhouse.size).toBeDefined();
  }
});

test('inspection filters and highlights without changing combat state and follows moving gunhouses', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), view = new ShipInspection(def);
  const before = JSON.stringify(sim.player);
  view.setMode('armor', 'armor:caesar-turret-side-0-a'); view.update(sim.player);
  expect(view.root.visible).toBe(true);
  expect(view.root.children.filter(c => c.visible).map(c => c.userData.inspectionId)).toEqual(['armor:caesar-turret-side-0-a']);
  expect(view.selectedId).toBe('armor:caesar-turret-side-0-a');
  view.setMode('internals', 'module:engine-port'); view.update(sim.player);
  expect(view.root.children.filter(c => c.visible).map(c => c.userData.inspectionId)).toEqual(['module:engine-port']);
  view.setMode('internals'); view.update(sim.player);
  expect(view.root.children.filter(c => c.visible).length).toBe(def.modules.length + def.compartments.length);
  expect(JSON.stringify(sim.player)).toBe(before);
  view.setMode('armor', 'module:engine-port');
  expect(view.selectedId).toBeUndefined();
  const index = def.mounts.findIndex(m => m.id === 'caesar');
  sim.player.mounts[index].train = .4; view.update(sim.player);
  expect(view.root.children.find(c => c.userData.inspectionId === 'armor:caesar-turret-side-0-a')!.rotation.y).toBeCloseTo(-Math.PI - .4);
  view.setMode('exterior');
  expect(view.root.visible).toBe(false);
});

test('returning to port resets both actors, ammunition, damage and shells while preserving view bindings', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), player = sim.player, target = sim.target;
  for (let i = 0; i < 1800; i++) sim.step({ throttle: .5, rudder: .2 }, { aim: sim.aimAt('engine-port'), fire: true, battery: 'main' });
  sim.reset();
  const fresh = new CombatSimulation(shipPreset('bismarck'));
  expect(sim.player).toBe(player); expect(sim.target).toBe(target);
  expect(sim.player).toEqual(fresh.player); expect(sim.target).toEqual(fresh.target);
  expect(sim.shells).toEqual([]); expect(sim.events).toEqual([]); expect(sim.tick).toBe(0);
});
