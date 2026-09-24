import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { CombatSimulation } from './combat';
import { BATTLE_SPAWN_DISTANCE, MIN_BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, validateBattleSetup } from './battle';
import { OPEN_SEA } from '../maps/heightfield';
import { localToWorld } from '../game/geometry';
import { antiAircraftRange } from '../ships/armament';

const stop = { throttle: 0, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };
const fleet = () => new CombatSimulation(shipPreset('baltimore'), {
  friendlyBots: [shipPreset('bismarck')], enemies: [shipPreset('yamato'), shipPreset('enterprise-cv6')],
});

test('custom deployments use independent mixed ships, unique IDs and lines 5 km apart', () => {
  const sim = fleet();
  expect(sim.actors.map(actor => actor.definition.id)).toEqual(['baltimore', 'bismarck', 'yamato', 'enterprise-cv6']);
  expect(sim.actors.filter(actor => actor.controller === 'player')).toEqual([sim.player]);
  expect(sim.actors.slice(1).every(actor => actor.controller === 'bot')).toBe(true);
  expect(new Set(sim.actors.map(actor => actor.motion.id)).size).toBe(4);
  for (const actor of sim.actors) {
    expect(actor.motion.z).toBe(actor.team === 'friendly' ? 0 : -BATTLE_SPAWN_DISTANCE);
    expect(actor.mounts).toHaveLength(actor.definition.mounts.length);
    expect(actor.damage.modules).toHaveLength(actor.definition.modules.length);
  }
  const duplicates = new CombatSimulation(shipPreset('bismarck'), {
    friendlyBots: Array(MAX_TEAM_SHIPS - 1).fill(shipPreset('bismarck')), enemies: Array(MAX_TEAM_SHIPS).fill(shipPreset('bismarck')),
  });
  expect(new Set(duplicates.actors.map(actor => actor.motion.id)).size).toBe(60);
  duplicates.actors[1].mounts[0].ammo = 0;
  expect(duplicates.player.mounts[0].ammo).toBeGreaterThan(0);
  for (const a of duplicates.actors) for (const b of duplicates.actors) if (a !== b) {
    expect(Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z)).toBeGreaterThan(600);
  }
});

test('custom distances deploy and reset every ship facing the opposing formation', () => {
  for (const spawnDistance of [MIN_BATTLE_SPAWN_DISTANCE, 7500, MAX_BATTLE_SPAWN_DISTANCE]) {
    const sim = new CombatSimulation(shipPreset('baltimore'), {
      friendlyBots: Array(MAX_TEAM_SHIPS - 1).fill(shipPreset('bismarck')),
      enemies: Array(MAX_TEAM_SHIPS).fill(shipPreset('yamato')), spawnDistance,
    });
    const initial = sim.actors.map(actor => ({ ...actor.motion }));
    const friendly = sim.actors.filter(actor => actor.team === 'friendly');
    const enemies = sim.actors.filter(actor => actor.team === 'enemy');
    friendly.forEach((actor, i) => {
      const enemy = enemies[i];
      expect(Math.hypot(actor.motion.x - enemy.motion.x, actor.motion.z - enemy.motion.z)).toBe(spawnDistance);
      // Use the shared bow transform so this checks physical facing, not just heading constants.
      const bow = localToWorld([0, 0, -1], actor.motion);
      const enemyBow = localToWorld([0, 0, -1], enemy.motion);
      expect(bow[0]).toBeCloseTo(enemy.motion.x, 8);
      expect(enemyBow[0]).toBeCloseTo(actor.motion.x, 8);
      expect(Math.abs(bow[2] - enemy.motion.z)).toBeCloseTo(spawnDistance - 1, 8);
      expect(Math.abs(enemyBow[2] - actor.motion.z)).toBeCloseTo(spawnDistance - 1, 8);
    });
    for (const a of sim.actors) for (const b of sim.actors) if (a !== b) {
      expect(Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z)).toBeGreaterThan(600);
    }
    sim.actors.forEach(actor => Object.assign(actor.motion, { x: 42, z: 99, heading: 1.2 }));
    sim.reset();
    expect(sim.actors.map(actor => actor.motion)).toEqual(initial);
  }
});

test('fleet validation rejects empty enemies, unavailable presets and overfull teams', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['yamato'], spawnDistance: BATTLE_SPAWN_DISTANCE };
  const ids = Object.keys(shipPresets);
  expect(() => validateBattleSetup(setup, ids, OPEN_SEA)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(29).fill('bismarck'), enemies: Array(30).fill('yamato') }, ids, OPEN_SEA)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, enemies: [] }, ids, OPEN_SEA)).toThrow('at least one enemy');
  expect(() => validateBattleSetup({ ...setup, playerShipId: 'missing' }, ids, OPEN_SEA)).toThrow('unavailable');
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(30).fill('bismarck') }, ids, OPEN_SEA)).toThrow('up to 30');
  expect(() => validateBattleSetup({ ...setup, enemies: Array(31).fill('bismarck') }, ids, OPEN_SEA)).toThrow('up to 30');
});

test('spawn distance accepts its limits and rejects invalid values at setup and simulation boundaries', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['yamato'], spawnDistance: BATTLE_SPAWN_DISTANCE };
  const ids = Object.keys(shipPresets);
  for (const spawnDistance of [MIN_BATTLE_SPAWN_DISTANCE, 7500, MAX_BATTLE_SPAWN_DISTANCE]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids, OPEN_SEA)).not.toThrow();
  }
  for (const spawnDistance of [NaN, Infinity, -Infinity, 0, -1000, MIN_BATTLE_SPAWN_DISTANCE - 1, MAX_BATTLE_SPAWN_DISTANCE + 1]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids, OPEN_SEA)).toThrow('spawn distance');
    expect(() => new CombatSimulation(shipPreset('bismarck'), {
      friendlyBots: [], enemies: [shipPreset('yamato')], spawnDistance,
    })).toThrow('spawn distance');
  }
});

// This 90-second simulated battle checks behavior, not host throughput. Shared
// Linux runners measured 17.5–24.6 seconds; leave finite scheduling headroom.



test('target selection uses each enemy definition and rejects friendly IDs', () => {
  const sim = fleet();
  expect(sim.selectTarget('friendly-1')).toBe(false);
  expect(sim.selectTarget('enemy-2')).toBe(true);
  const data = sim.telemetry('main', sim.aimAt());
  expect(data.targetName).toBe(shipPreset('enterprise-cv6').name);
  expect(data.modules!.map(module => module.id)).toEqual(shipPreset('enterprise-cv6').modules.map(module => module.id));
  expect(data.contacts).toHaveLength(4);
});


