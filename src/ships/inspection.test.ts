import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from './presets';
import { entriesForMode, inspectionEntries } from './inspection';
import { ShipInspection } from '../game/ShipInspection';
import { CombatSimulation } from '../simulation/combat';
import { Group, Mesh, Raycaster, Vector3 } from 'three/webgpu';

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

test('armor picking follows the ship transform, finds the nearest layer and excludes hidden plates', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), view = new ShipInspection(def);
  const ship = new Group(); ship.position.set(120, 4, -80); ship.rotation.y = .7; ship.add(view.root);
  view.setMode('armor'); view.update(sim.player); ship.updateMatrixWorld(true);
  const origin = ship.localToWorld(new Vector3(-40, 0, 0)), destination = ship.localToWorld(new Vector3(0, 0, 0));
  const ray = new Raycaster(origin, destination.sub(origin).normalize());
  expect(view.pickArmor(ray)?.id).toBe('armor:port-main-belt-2');
  view.setMode('armor', 'armor:port-belt-support-2'); view.update(sim.player);
  expect(view.pickArmor(ray)?.id).toBe('armor:port-belt-support-2');
  view.setMode('internals'); view.update(sim.player);
  expect(view.pickArmor(ray)).toBeUndefined();
  view.setMode('exterior');
  expect(view.pickArmor(ray)).toBeUndefined();
});

test('hover highlights an opaque plate without selecting it or changing combat, then restores its color', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), view = new ShipInspection(def);
  const before = JSON.stringify(sim.player), id = 'armor:port-main-belt-2';
  view.setMode('armor'); view.update(sim.player);
  const group = view.root.children.find(c => c.userData.inspectionId === id)!;
  const fill = group.children[0] as Mesh;
  const material = fill.material as import('three/webgpu').MeshBasicMaterial;
  const color = material.color.clone();
  view.setHovered(id); view.update(sim.player);
  expect(view.hoveredId).toBe(id);
  expect(view.selectedId).toBeUndefined();
  expect(material.opacity).toBe(1);
  expect(material.transparent).toBe(false);
  expect(material.depthTest && material.depthWrite).toBe(true);
  expect(group.children[1].visible).toBe(false);
  expect(material.color.equals(color)).toBe(false);
  view.setHovered(undefined);
  expect(material.color.equals(color)).toBe(true);
  view.setHovered(id); view.setMode('internals'); view.update(sim.player);
  expect(view.hoveredId).toBeUndefined();
  expect(JSON.stringify(sim.player)).toBe(before);
});
