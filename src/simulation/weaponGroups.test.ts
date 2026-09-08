import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { surfaceGunAllowed } from '../ships/armament';
import { weaponGroupId, weaponGroups } from '../ships/weaponGroups';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { gunAimPoints } from '../game/gunAim';

const helm = { throttle: 0, rudder: 0 };
const aim: Vec3 = [1800, 0, 0];

test('every preset groups all controllable weapons once in stable order, including mixed main mount layouts', () => {
  for (const source of Object.values(shipPresets)) {
    const definition = structuredClone(source) as unknown as ShipDefinition;
    const groups = weaponGroups(definition);
    const ids = [...definition.mounts.filter(m => surfaceGunAllowed(definition, m.weapon)), ...definition.torpedoTubes ?? [], ...definition.depthChargeLaunchers ?? []].map(m => m.id).sort();
    expect(groups.flatMap(g => g.mountIds).sort()).toEqual(ids);
    expect(groups.length).toBeLessThanOrEqual(10);
    definition.mounts.reverse(); definition.torpedoTubes?.reverse(); definition.depthChargeLaunchers?.reverse();
    expect(weaponGroups(definition).map(g => g.id)).toEqual(groups.map(g => g.id));
  }
  expect(weaponGroups(shipPreset('bismarck')).map(g => g.caliberMm)).toEqual([380, 150, 105]);
  const kgv = weaponGroups(shipPreset('king-george-v'));
  expect(kgv.filter(g => g.battery === 'main')).toHaveLength(1);
  expect(kgv[0].mountIds).toHaveLength(3);
  expect(weaponGroups(shipPreset('fletcher')).map(g => g.battery)).toEqual(['main', 'torpedo', 'depth-charge']);
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
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def);
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
    expect(sim.player.mounts[i].loaded).toBe('ap');
    expect(sim.player.mounts[i].queued).toBe(first.mountIds.includes(m.id) ? 'he' : undefined);
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

for (const explicit of [false, true]) test(`light AA cannot bypass surface restriction with ${explicit ? 'explicit group' : 'aggregate battery'} intent`, () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def);
  const light = def.mounts.find(m => m.weapon.caliberM === .037)!;
  const groupId = explicit ? weaponGroupId(light.battery, light.weapon) : undefined;
  const before = sim.player.mounts.map(m => m.ammo);
  for (let tick = 0; tick < 240; tick++) {
    sim.requestFire();
    sim.step(helm, { aim: [600, 0, 0], battery: light.battery, weaponGroupId: groupId, fire: true });
  }
  def.mounts.forEach((m, i) => { if (m.weapon.caliberM <= .08) expect(sim.player.mounts[i].ammo).toBe(before[i]); });
  expect(gunAimPoints(sim.player, def, light.battery, aim, groupId).every(p => def.mounts.find(m => m.id === p.id)!.weapon.caliberM > .08)).toBe(true);
  expect(sim.telemetry(light.battery, aim, groupId).mounts.every(p => def.mounts.find(m => m.id === p.id)!.weapon.caliberM > .08)).toBe(true);
});

for (const lightOnly of [false, true]) test(`bots and players ${lightOnly ? 'retain light-only armament' : 'reserve light AA for aircraft'}`, () => {
  const def = structuredClone(shipPreset('bismarck'));
  if (lightOnly) def.mounts = def.mounts.filter(m => m.weapon.caliberM <= .08);
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def], spawnDistance: 1000, spawns: { friendly: [{ x: 0, z: 0, heading: 0 }], enemy: [{ x: 600, z: 0, heading: 0 }] } });
  const before = sim.actors.map(a => a.mounts.map(m => m.ammo));
  for (let tick = 0; tick < 1800; tick++) sim.step(helm, { aim: [sim.target.motion.x, 0, sim.target.motion.z], battery: 'secondary', fire: true });
  for (const [a, actor] of sim.actors.entries()) {
    const usedLight = actor.definition.mounts.some((m, i) => m.weapon.caliberM <= .08 && actor.mounts[i].ammo < before[a][i]);
    expect(usedLight).toBe(lightOnly);
  }
  expect(weaponGroups(def).some(g => g.caliberMm <= 80)).toBe(lightOnly);
});

test('a forged light-AA selection cannot take automatic air defense away', () => {
  const def = shipPreset('bismarck');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')] });
  const light = def.mounts.find(m => m.weapon.caliberM === .037)!;
  const plane = sim.target.airWing!.planes[0];
  plane.phase = 'outbound'; plane.position = [sim.ship.x + 600, 150, sim.ship.z]; plane.velocity = [0, 0, 0];
  sim.step(helm, { aim: [sim.ship.x + 600, 0, sim.ship.z], fire: true, battery: light.battery, weaponGroupId: weaponGroupId(light.battery, light.weapon) });
  const tracking = sim.player.mounts.filter((m, i) => def.mounts[i].weapon.caliberM === .037 && m.aimCache);
  expect(tracking.length).toBeGreaterThan(0);
  expect(tracking.every(m => m.aimCache!.point[1] > 100)).toBe(true);
});
