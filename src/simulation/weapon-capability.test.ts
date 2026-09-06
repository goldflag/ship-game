import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { updateCapability } from './stability';

const intent = { aim: [5000, 5, 0] as [number, number, number], fire: true, battery: 'secondary' as const };
const fixture = () => {
  const def = structuredClone(shipPreset('bismarck'));
  return { def, sim: new CombatSimulation(def, { friendlyBots: [def], enemies: [def, def] }) };
};

test('player and bot continue firing secondary guns after losing their main batteries', () => {
  const def = structuredClone(shipPreset('bismarck'));
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def] }, 12345);
  Object.assign(sim.player.motion, { x: 0, z: 0, heading: 0 });
  Object.assign(sim.target.motion, { x: 3500, z: 0, heading: 0 });
  for (const actor of [sim.player, sim.target]) {
    def.mounts.forEach((m, i) => {
      if (m.battery === 'main') actor.mounts[i].hp = 0;
    });
    updateCapability(actor, def);
    expect(actor.damage.stability.status).toBe('operational');
    expect(actor.damage.stability.combatLost).toBe(false);
    expect(actor.damage.defeatCause).toBeUndefined();
  }
  const fired = new Set<string>();
  for (let i = 0; i < 35 * 60; i++) {
    sim.step({ throttle: 0, rudder: 0 }, { ...intent, aim: sim.aimAt() });
    sim.events.filter(e => e.kind === 'shot').forEach(e => fired.add(e.shipId));
  }
  for (const actor of [sim.player, sim.target]) {
    expect(actor.damage.sunk).toBe(false);
    expect(actor.damage.stability.combatLost).toBe(false);
    expect(fired.has(actor.motion.id)).toBe(true);
    def.mounts.forEach((m, i) => { if (m.battery === 'main') {
      expect(actor.mounts[i].status).toBe('disabled');
      expect(actor.mounts[i].train).toBe(0);
      expect(actor.mounts[i].ammo).toBe(m.weapon.ammoPerBarrel * (m.weapon.barrelCount ?? 2));
    } });
  }
  expect(sim.result).toBe('active');
  sim.reset();
  expect(sim.player.damage.stability.combatLost).toBe(false);
  expect(sim.player.damage.stability.status).toBe('operational');
});

test('one remaining main turret keeps an immobile ship in battle, including during reload', () => {
  const { def, sim } = fixture(), actor = sim.target;
  actor.mounts.forEach((m, i) => { if (i !== 0) m.hp = 0; });
  actor.mounts[0].reload = 20;
  def.modules.forEach((m, i) => { if (m.kind === 'engine') actor.damage.modules[i].hp = 0; });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('immobile');
  expect(actor.damage.stability.combatLost).toBe(false);
});

test('main magazine failures leave secondaries fighting; only loss of all remaining guns is final', () => {
  const { def, sim } = fixture(), actor = sim.target;
  const magazines = new Set(def.mounts.filter(m => m.battery === 'main').map(m => m.magazineId));
  const rooms = def.modules.filter(m => magazines.has(m.id)).map(m => def.compartments.findIndex(c => c.id === m.compartmentId));
  rooms.forEach(i => actor.damage.compartments[i].waterM3 = def.compartments[i].capacityM3);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('operational');
  expect(actor.damage.stability.combatLost).toBe(false);
  rooms.forEach(i => actor.damage.compartments[i].waterM3 = 0);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('operational');
  def.modules.forEach((m, i) => { if (magazines.has(m.id)) actor.damage.modules[i].hp = 0; });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('operational');
  expect(actor.damage.stability.combatLost).toBe(false);
  expect(actor.mounts.every(m => m.hp === 100)).toBe(true);
  def.mounts.forEach((m, i) => { if (m.battery === 'secondary') actor.mounts[i].hp = 0; });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('disarmed');
  expect(actor.damage.stability.combatLost).toBe(true);
  expect(actor.damage.defeatCause).toBe('weapons-lost');
});

test('HE stock preserves gun capability; incomplete main salvos leave secondaries available', () => {
  const { def, sim } = fixture(), actor = sim.target;
  def.mounts.forEach((m, i) => { if (m.battery === 'main') {
    actor.mounts[i].ammo = actor.mounts[i].heAmmo = m.weapon.barrelCount ?? 2;
  } });
  updateCapability(actor, def);
  expect(actor.damage.stability.combatLost).toBe(false);
  def.mounts.forEach((m, i) => { if (m.battery === 'main') {
    actor.mounts[i].ammo = 2; actor.mounts[i].heAmmo = 1;
  } });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('operational');
  expect(actor.damage.stability.combatLost).toBe(false);
  def.mounts.forEach((m, i) => { if (m.battery === 'secondary') {
    actor.mounts[i].ammo = 0; actor.mounts[i].heAmmo = 0;
  } });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('disarmed');
  expect(actor.damage.stability.combatLost).toBe(true);
  expect(actor.damage.defeatCause).toBe('ammunition-exhausted');
});

test('secondary-only custom ships fight until their last gun is destroyed', () => {
  const def = structuredClone(shipPreset('baltimore'));
  def.mounts = def.mounts.filter(m => m.battery === 'secondary');
  const actor = new CombatSimulation(def).player;
  updateCapability(actor, def);
  expect(actor.damage.stability.combatLost).toBe(false);
  actor.mounts.forEach(m => m.hp = 0);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('disarmed');
  expect(actor.damage.stability.combatLost).toBe(true);
});
