import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { weaponGroups } from '../ships/weaponGroups';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { gunAimPoints } from '../game/gunAim';

const helm = { throttle: 0, rudder: 0 };
const aim: Vec3 = [1800, 0, 0];

test('every preset groups all fitted weapons once in stable order, including mixed main mount layouts', () => {
  for (const source of Object.values(shipPresets)) {
    const definition = structuredClone(source) as unknown as ShipDefinition;
    const groups = weaponGroups(definition);
    const ids = [...definition.mounts, ...definition.torpedoTubes ?? [], ...definition.depthChargeLaunchers ?? []].map(m => m.id).sort();
    expect(groups.flatMap(g => g.mountIds).sort()).toEqual(ids);
    expect(groups.length).toBeLessThanOrEqual(10);
    definition.mounts.reverse(); definition.torpedoTubes?.reverse(); definition.depthChargeLaunchers?.reverse();
    expect(weaponGroups(definition).map(g => g.id)).toEqual(groups.map(g => g.id));
  }
  expect(weaponGroups(shipPreset('bismarck')).map(g => g.caliberMm)).toEqual([380, 150, 105, 37, 20]);
  const kgv = weaponGroups(shipPreset('king-george-v'));
  expect(kgv.filter(g => g.battery === 'main')).toHaveLength(1);
  expect(kgv[0].mountIds).toHaveLength(3);
  expect(weaponGroups(shipPreset('fletcher')).map(g => g.battery)).toEqual(['main', 'secondary', 'secondary', 'torpedo', 'depth-charge']);
});

test('same-caliber guns with different reloads, flight models or ammunition remain distinct', () => {
  for (const edit of [
    (w: ShipDefinition['mounts'][number]['weapon']) => { w.reloadSeconds += 1; },
    (w: ShipDefinition['mounts'][number]['weapon']) => { w.muzzleSpeed += 10; },
    (w: ShipDefinition['mounts'][number]['weapon']) => { delete w.he; },
  ]) {
    const def = structuredClone(shipPreset('bismarck'));
    def.mounts = def.mounts.filter(m => m.battery === 'main');
    edit(def.mounts[0].weapon);
    expect(weaponGroups(def)).toHaveLength(2);
  }
});

for (const index of [1, 2]) test(`direct secondary group ${index} fires only its own mounts and shares HUD/aim membership`, () => {
  const def = shipPreset('enterprise-cv6'), sim = new CombatSimulation(def);
  const group = weaponGroups(def)[index];
  const intent = { aim, fire: false, battery: group.battery, weaponGroupId: group.id };
  for (let tick = 0; tick < 900; tick++) sim.step(helm, intent);
  const before = sim.player.mounts.map(m => m.ammo);
  const telemetry = sim.telemetry(group.battery, aim, group.id);
  expect(telemetry.ready).toBeGreaterThan(0);
  expect(telemetry.mounts.map(m => m.id)).toEqual(group.mountIds);
  expect(gunAimPoints(sim.player, def, group.battery, aim, group.id).map(m => m.id)).toEqual(group.mountIds);
  sim.requestFire(); sim.step(helm, intent);
  for (let tick = 0; tick < 180; tick++) sim.step(helm, { ...intent, fire: true });
  expect(sim.events.some(e => e.kind === 'shot')).toBe(true);
  def.mounts.forEach((m, i) => {
    if (!group.mountIds.includes(m.id)) expect(sim.player.mounts[i].ammo).toBe(before[i]);
  });
  expect(sim.player.mounts.some((m, i) => m.ammo < before[i])).toBe(true);
});

test('AP/HE, stocks, flight time and destroyed-group slots stay isolated through selection and reset', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def);
  const groups = weaponGroups(def), first = groups[1], second = groups[2];
  sim.step(helm, { aim, fire: false, battery: 'secondary', weaponGroupId: first.id, ammunition: 'he' });
  sim.step(helm, { aim, fire: false, battery: 'secondary', weaponGroupId: second.id, ammunition: 'ap' });
  def.mounts.forEach((m, i) => {
    expect(sim.player.mounts[i].loaded).toBe(first.mountIds.includes(m.id) ? 'he' : 'ap');
  });
  const telemetry = sim.telemetry('secondary', aim, first.id);
  expect(telemetry.ammunition).toBe('he');
  expect(telemetry.weaponGroups.find(g => g.id === second.id)?.ammunition).toBe('ap');
  expect(telemetry.ammunitionStock.he).toBeGreaterThan(0);
  const stock = sim.player.mounts.filter(m => first.mountIds.includes(m.id)).reduce((n, m) => n + m.heAmmo, 0);
  expect(telemetry.ammunitionStock.he).toBe(stock);
  def.mounts.forEach((m, i) => {
    if (first.mountIds.includes(m.id)) { sim.player.mounts[i].hp = 0; sim.player.mounts[i].ammo = 0; }
  });
  sim.step(helm, { aim, fire: true, battery: 'secondary', weaponGroupId: first.id });
  const disabled = sim.telemetry('secondary', aim, first.id);
  expect(disabled.weaponGroups.map(g => g.id)).toEqual(groups.map(g => g.id));
  expect(disabled.ready).toBe(0); expect(disabled.total).toBe(first.mountIds.length);
  expect(disabled.flightTimeSeconds).toBeUndefined();
  sim.reset();
  expect(sim.telemetry('secondary', aim, first.id).ammunition).toBe('ap');
  expect(sim.telemetry('secondary', aim, first.id).ammunitionStock.he).toBe(stock);
});

test('invalid or mismatched group IDs never fire an aggregate battery', () => {
  const def = shipPreset('fletcher'), sim = new CombatSimulation(def);
  const before = sim.player.mounts.map(m => m.ammo);
  for (const battery of ['main', 'secondary', 'torpedo', 'depth-charge'] as const) {
    for (let tick = 0; tick < 120; tick++) sim.step(helm, { aim, fire: true, battery, weaponGroupId: 'missing' });
    expect(sim.telemetry(battery, aim, 'missing').total).toBe(0);
  }
  expect(sim.player.mounts.map(m => m.ammo)).toEqual(before);
  expect(sim.torpedoes).toHaveLength(0); expect(sim.depthCharges).toHaveLength(0);
});

test('manual AA group keeps the sight target while other AA groups track nearby hostile aircraft', () => {
  const def = shipPreset('bismarck');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')] });
  const group = weaponGroups(def).find(g => g.caliberMm === 105)!;
  const plane = sim.target.airWing!.planes[0];
  plane.phase = 'outbound'; plane.position = [sim.ship.x + 600, 150, sim.ship.z]; plane.velocity = [0, 0, 0];
  const sight: Vec3 = [sim.ship.x + 1800, 0, sim.ship.z];
  sim.step(helm, { aim: sight, fire: false, battery: group.battery, weaponGroupId: group.id });
  const manual = sim.player.mounts.filter(m => group.mountIds.includes(m.id) && m.aimCache);
  expect(manual.length).toBeGreaterThan(0);
  expect(manual.every(m => m.aimCache!.point[1] === 0)).toBe(true);
  const automatic = sim.player.mounts.filter(m => !group.mountIds.includes(m.id) && m.aimCache && m.aimCache.point[1] > 100);
  expect(automatic.length).toBeGreaterThan(0);
});

test('different torpedo and depth-charge parts remain separately selectable', () => {
  for (const battery of ['torpedo', 'depth-charge'] as const) {
    const def = structuredClone(shipPreset('fletcher'));
    const fitted = battery === 'torpedo' ? def.torpedoTubes! : def.depthChargeLaunchers!;
    fitted[0].weapon.id += '-alternate';
    const sim = new CombatSimulation(def);
    const group = weaponGroups(def).find(g => g.mountIds.includes(fitted[0].id))!;
    const intent = { aim, fire: false, battery, weaponGroupId: group.id };
    for (let tick = 0; tick < 600; tick++) sim.step(helm, intent);
    const states = battery === 'torpedo' ? sim.player.torpedoTubes! : sim.player.depthChargeLaunchers!;
    const before = states.map(m => m.ammo);
    expect(sim.telemetry(battery, aim, group.id).total).toBe(1);
    sim.step(helm, { ...intent, fire: true });
    expect(states[0].ammo).toBe(before[0] - 1);
    expect(states.slice(1).map(m => m.ammo)).toEqual(before.slice(1));
  }
});
