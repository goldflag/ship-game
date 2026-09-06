import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { updateCapability } from './stability';

const helm = { throttle: 1, rudder: 1 };
const intent = { aim: [5000, 5, 0] as [number, number, number], fire: true, battery: 'secondary' as const };
const fixture = () => {
  const def = structuredClone(shipPreset('bismarck'));
  return { def, sim: new CombatSimulation(def, { friendlyBots: [def], enemies: [def, def] }) };
};

test('loss of main guns knocks out player and bot, silences secondaries and leaves the other ships fighting', () => {
  const { def, sim } = fixture();
  for (const actor of [sim.player, sim.target]) {
    def.mounts.forEach((m, i) => {
      if (m.battery === 'main') actor.mounts[i].hp = 0;
      else actor.mounts[i].status = 'ready';
    });
  }
  sim.requestFire();
  for (let i = 0; i < 60; i++) sim.step(helm, intent);
  for (const actor of [sim.player, sim.target]) {
    expect(actor.damage.sunk).toBe(false);
    expect(actor.damage.stability.status).toBe('knocked-out');
    expect(actor.damage.defeatCause).toBe('weapons-lost');
    expect(actor.mounts.every(m => m.status === 'disabled')).toBe(true);
    expect(def.mounts.filter((m, i) => m.battery === 'secondary' && actor.mounts[i].hp === 100)).toHaveLength(6);
    expect(sim.events.some(e => e.shipId === actor.motion.id && e.kind === 'shot')).toBe(false);
    expect(actor.targetId).toBeUndefined();
    expect(actor.motion.speed).toBe(0);
  }
  expect(sim.result).toBe('active');
  expect(sim.telemetry('secondary', intent.aim).ready).toBe(0);
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

test('main magazine flooding can recover; permanent magazine destruction is a knockout', () => {
  const { def, sim } = fixture(), actor = sim.target;
  const magazines = new Set(def.mounts.filter(m => m.battery === 'main').map(m => m.magazineId));
  const rooms = def.modules.filter(m => magazines.has(m.id)).map(m => def.compartments.findIndex(c => c.id === m.compartmentId));
  rooms.forEach(i => actor.damage.compartments[i].waterM3 = def.compartments[i].capacityM3);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('disarmed');
  expect(actor.damage.stability.combatLost).toBe(false);
  rooms.forEach(i => actor.damage.compartments[i].waterM3 = 0);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('operational');
  def.modules.forEach((m, i) => { if (magazines.has(m.id)) actor.damage.modules[i].hp = 0; });
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('knocked-out');
  expect(actor.damage.defeatCause).toBe('weapons-lost');
  expect(actor.mounts.every(m => m.hp === 100)).toBe(true);
});

test('HE stock preserves main battery capability; mixed leftover rounds cannot sustain a full salvo', () => {
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
  expect(actor.damage.stability.status).toBe('knocked-out');
  expect(actor.damage.defeatCause).toBe('ammunition-exhausted');
});

test('secondary-only custom ships use their fitted guns as primary fighting strength', () => {
  const def = structuredClone(shipPreset('baltimore'));
  def.mounts = def.mounts.filter(m => m.battery === 'secondary');
  const actor = new CombatSimulation(def).player;
  updateCapability(actor, def);
  expect(actor.damage.stability.combatLost).toBe(false);
  actor.mounts.forEach(m => m.hp = 0);
  updateCapability(actor, def);
  expect(actor.damage.stability.status).toBe('knocked-out');
});
