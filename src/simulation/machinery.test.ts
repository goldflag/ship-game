import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { equipmentCondition, systemHealth } from './machinery';
import { updateFlooding } from './damage';
import { hitShip, type Shell } from './damage';
import { hullContains } from './hull';
import yamato from '../../assets/ships/yamato/blueprint.json';
import baltimore from '../../assets/ships/baltimore/blueprint.json';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';

test('Bismarck turbine and shaft losses remove only their linked drive capacity', () => {
  const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def), actor = sim.player;
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(1, 9);
  actor.damage.modules.find(m => m.id === 'engine-port')!.hp = 0;
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(2 / 3, 9);
  actor.damage.modules.find(m => m.id === 'shaft-starboard-equipment')!.hp = 0;
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(1 / 3, 9);
  actor.damage.modules.find(m => m.id === 'engine-center')!.hp = 0;
  expect(systemHealth(actor, def, 'engine')).toBe(0);
});
test('losing every turbine or boiler removes propulsion regardless of healthy auxiliaries', () => {
  for (const role of ['turbine', 'boiler']) {
    const def = compileShip(blueprint, catalog), actor = new CombatSimulation(def).player;
    def.modules.forEach((m, i) => { if (m.role === role) actor.damage.modules[i].hp = 0; });
    expect(systemHealth(actor, def, 'engine')).toBe(0);
  }
});
test('immersion disables machinery; pumping recovers availability without repairing destroyed HP', () => {
  const def = compileShip(blueprint, catalog), actor = new CombatSimulation(def).player;
  const module = def.modules.find(m => m.id === 'engine-port')!;
  const room = def.compartments.find(c => c.id === module.compartmentId)!;
  const water = actor.damage.compartments.find(c => c.id === room.id)!;
  water.waterM3 = room.capacityM3;
  expect(equipmentCondition(actor, def, module).reason).toBe('flooded');
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(2 / 3, 9);
  water.waterM3 = 0;
  expect(equipmentCondition(actor, def, module).availability).toBe(1);
  actor.damage.modules.find(m => m.id === module.id)!.hp = 0;
  water.waterM3 = 1; room.pumpM3PerSecond = 2;
  updateFlooding(actor, def, 1);
  expect(water.waterM3).toBe(0);
  expect(equipmentCondition(actor, def, module)).toEqual({ availability: 0, reason: 'destroyed' });
});
test('closed watertight boundaries stop flow; open/damaged boundaries conserve water', () => {
  for (const state of ['closed', 'open', 'damaged'] as const) {
    const def = compileShip(blueprint, catalog);
    const [a, b] = def.compartments;
    def.connections = [{ id: 'fixture', fromId: a.id, toId: b.id, areaM2: .1, state, position: [0, -6, 0] }];
    def.compartments.forEach(c => c.pumpM3PerSecond = 0);
    const actor = new CombatSimulation(def).player;
    actor.damage.compartments[0].waterM3 = 300;
    for (let i = 0; i < 120; i++) updateFlooding(actor, def, 1 / 60);
    expect(actor.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeCloseTo(300, 9);
    expect(actor.damage.compartments[1].waterM3 > 0).toBe(state !== 'closed');
  }
});
test('dependency links, shares and immersion limits are validated at compilation', () => {
  const invalid = structuredClone(blueprint);
  invalid.propulsion.groups[0].driveIds = ['missing-drive'];
  expect(() => compileShip(invalid, catalog)).toThrow('unknown propulsion');
  const wrongShare = structuredClone(blueprint); wrongShare.propulsion.groups[0].share = .9;
  expect(() => compileShip(wrongShare, catalog)).toThrow('sum to one');
  const badImmersion = structuredClone(blueprint); badImmersion.modules[0].immersionToleranceM = 1000;
  expect(() => compileShip(badImmersion, catalog)).toThrow('immersionToleranceM');
});
test('a penetrating underwater path opens boundaries and flooding disables otherwise intact boilers', () => {
  const def = compileShip(blueprint, catalog), actor = new CombatSimulation(def).player;
  def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  const shell: Shell = { id: 1, ownerId: 'target', position: [-30, -2, -21], velocity: [820, 0, 0], age: 0, penetrationMm: 10000, damage: 1, caliberM: .38, visited: [] };
  const assignments: string[] = [];
  hitShip(shell, [-30, -2, -21], [30, -2, -21], actor, def, e => { if (e.impact?.compartmentId) assignments.push(e.impact.compartmentId); });
  expect(assignments[0]).toBe('flood-strip-port-5-2');
  expect(actor.damage.connections.some(c => c.state === 'damaged')).toBe(true);
  for (let i = 0; i < 36000; i++) updateFlooding(actor, def, 1 / 60);
  const boiler = def.modules.find(m => m.id === 'boiler-forward-port-equipment')!;
  expect(actor.damage.modules.find(m => m.id === boiler.id)!.hp).toBe(boiler.hp - 1);
  expect(equipmentCondition(actor, def, boiler).reason).toBe('flooded');
  expect(actor.damage.compartments.find(c => c.id === 'boiler-aft-port')!.waterM3).toBe(0);
});
test('authored outer spaces fit the hull and never overlap retained room envelopes', () => {
  for (const preset of [blueprint, yamato, baltimore, enterprise]) {
    const def = compileShip(preset, catalog), added = def.compartments.filter(c => c.id.startsWith('flood-strip-') || c.id.startsWith('flood-end-'));
    expect(added.length).toBeGreaterThan(0);
    expect(def.connections.every(c => c.state === 'closed')).toBe(true);
    for (const room of added) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) expect(hullContains(def.hull, [room.center[0] + sx * room.size[0] / 2, room.center[1] + sy * room.size[1] / 2, room.center[2] + sz * room.size[2] / 2])).toBe(true);
      for (const other of def.compartments.filter(c => c.id !== room.id)) {
        const overlap = room.center.every((n, i) => Math.abs(n - other.center[i]) < (room.size[i] + other.size[i]) / 2 - 1e-6);
        expect(overlap).toBe(false);
      }
    }
  }
});
test('Yamato wing spaces connect damaged exterior openings to retained turbine rooms', () => {
  const def = compileShip(yamato, catalog), actor = new CombatSimulation(def).player;
  def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  const shell: Shell = { id: 1, ownerId: 'target', position: [-30, -2, 5], velocity: [820, 0, 0], age: 0, penetrationMm: 10000, damage: 1, caliberM: .38, visited: [] };
  hitShip(shell, [-30, -2, 5], [30, -2, 5], actor, def, () => {});
  for (let i = 0; i < 36000; i++) updateFlooding(actor, def, 1 / 60);
  expect(actor.damage.compartments.find(c => c.id === 'engine-port-space')!.waterM3).toBeGreaterThan(0);
  expect(actor.damage.compartments.find(c => c.id === 'engine-starboard-space')!.waterM3).toBeGreaterThan(0);
});
test('bow and stern penetrations create local openings on every supported preset', () => {
  for (const preset of [blueprint, yamato, baltimore, enterprise]) for (const sign of [-1, 1]) {
    const def = compileShip(preset, catalog), actor = new CombatSimulation(def).player;
    const z = sign * (def.hull.length / 2 + 2);
    const shell: Shell = { id: 1, ownerId: 'target', position: [0, -1, z], velocity: [0, 0, -sign * 820], age: 0, penetrationMm: 10000, damage: 1, caliberM: .38, visited: [] };
    hitShip(shell, [0, -1, z], [0, -1, sign * (def.hull.length / 2 - 30)], actor, def, () => {});
    expect(actor.damage.compartments.reduce((n, c) => n + c.breachAreaM2, 0)).toBeGreaterThan(0);
    if (def.id === 'bismarck') expect(actor.damage.compartments.reduce((n, c) => n + c.breachAreaM2, 0)).toBeCloseTo(.38 ** 2, 8);
    updateFlooding(actor, def, 1);
    expect(actor.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeGreaterThan(0);
  }
});
test('stock Baltimore guns with drag and dispersion can flood the stern at 5 km', () => {
  const sim = new CombatSimulation(compileShip(baltimore, catalog));
  sim.target.motion.x = 5000; sim.target.motion.z = 0;
  const helm = { throttle: 0, rudder: 0 }, aim = sim.aimAt('steering');
  for (let i = 0; i < 1800; i++) sim.step(helm, { aim, fire: false, battery: 'main' });
  for (let i = 0; i < 3600; i++) sim.step(helm, { aim, fire: true, battery: 'main' });
  expect(sim.telemetry('main', aim).targetWater).toBeGreaterThan(0);
  expect(sim.target.damage.compartments.find(c => c.id === 'stern')!.waterM3).toBeGreaterThan(0);
});
