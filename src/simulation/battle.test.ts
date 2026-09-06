import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { CombatSimulation } from './combat';
import { BATTLE_SPAWN_DISTANCE, MIN_BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MAX_TEAM_SHIPS, validateBattleSetup } from './battle';
import { botTarget, clearFiringLane } from './bots';
import { localToWorld } from './geometry';

const stop = { throttle: 0, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };
const fleet = () => new CombatSimulation(shipPreset('baltimore'), {
  friendlyBots: [shipPreset('bismarck')], enemies: [shipPreset('yamato'), shipPreset('enterprise-cv6')],
});

for (const spawnDistance of [MIN_BATTLE_SPAWN_DISTANCE, BATTLE_SPAWN_DISTANCE]) {
  test(`Yamato survives Bismarck's opening salvo at ${spawnDistance} m with inspectable magazine damage`, () => {
    const sim = new CombatSimulation(shipPreset('yamato'), {
      friendlyBots: [], enemies: [shipPreset('bismarck')], spawnDistance,
    });
    // Exercise deployed bot aiming, shell flight, armor, magazines and flooding together.
    for (let tick = 0; tick < 600; tick++) sim.step(stop, intent);
    expect(sim.events.some(e => e.kind === 'penetration' && e.shipId === 'player')).toBe(true);
    expect(sim.player.damage.modules.filter(m => m.detonated).length).toBeGreaterThanOrEqual(2);
    const moduleDamage = sim.player.damage.modules.reduce((sum, m, i) => sum + sim.definition.modules[i].hp - m.hp, 0);
    const openingShots = sim.events.filter(e => e.kind === 'shot' && e.shipId === sim.target.motion.id);
    expect(openingShots).toHaveLength(4);
    expect(moduleDamage).toBeLessThanOrEqual(openingShots.length * sim.target.definition.mounts[0].weapon.damage);
    expect(sim.player.damage.integrity).toBeGreaterThan(sim.player.damage.maxIntegrity / 2);
    expect(sim.player.damage.integrity).toBeLessThan(sim.player.damage.maxIntegrity);
    expect(sim.player.damage.sunk).toBe(false);
    expect(sim.result).toBe('active');
    expect(sim.player.damage.compartments.some(c => c.waterM3 > 0)).toBe(true);
    expect(sim.player.mounts.filter(m => m.status === 'disabled').length).toBeGreaterThanOrEqual(2);
  });
}

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
  expect(() => validateBattleSetup(setup, ids)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(29).fill('bismarck'), enemies: Array(30).fill('yamato') }, ids)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, enemies: [] }, ids)).toThrow('at least one enemy');
  expect(() => validateBattleSetup({ ...setup, playerShipId: 'missing' }, ids)).toThrow('unavailable');
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(30).fill('bismarck') }, ids)).toThrow('up to 30');
  expect(() => validateBattleSetup({ ...setup, enemies: Array(31).fill('bismarck') }, ids)).toThrow('up to 30');
});

test('spawn distance accepts its limits and rejects invalid values at setup and simulation boundaries', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['yamato'], spawnDistance: BATTLE_SPAWN_DISTANCE };
  const ids = Object.keys(shipPresets);
  for (const spawnDistance of [MIN_BATTLE_SPAWN_DISTANCE, 7500, MAX_BATTLE_SPAWN_DISTANCE]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids)).not.toThrow();
  }
  for (const spawnDistance of [NaN, Infinity, -Infinity, 0, -1000, MIN_BATTLE_SPAWN_DISTANCE - 1, MAX_BATTLE_SPAWN_DISTANCE + 1]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids)).toThrow('spawn distance');
    expect(() => new CombatSimulation(shipPreset('bismarck'), {
      friendlyBots: [], enemies: [shipPreset('yamato')], spawnDistance,
    })).toThrow('spawn distance');
  }
});

test('every bot maneuvers, fires both applicable batteries, reloads and damages opposing hulls', () => {
  const sim = fleet();
  const initial = sim.actors.map(actor => actor.mounts.map(mount => mount.ammo));
  const shots = new Map<string, number>();
  const shotTicks = new Map<string, number[]>();
  let sequence = 0;
  // Bots must first traverse to a solution; a ready gun alone must not trigger fire.
  sim.step(stop, intent);
  expect(sim.events.some(event => event.kind === 'shot')).toBe(false);
  for (let tick = 1; tick < 60 * 90; tick++) {
    sim.step({ throttle: .5, rudder: 0 }, intent);
    for (const event of sim.events) if (event.sequence > sequence) {
      sequence = event.sequence;
      if (event.kind !== 'shot') continue;
      shots.set(event.shipId, (shots.get(event.shipId) ?? 0) + 1);
      const key = `${event.shipId}:${event.message}`;
      const ticks = shotTicks.get(key) ?? [];
      if (ticks.at(-1) !== event.tick) ticks.push(event.tick);
      shotTicks.set(key, ticks);
    }
  }
  expect(shots.has('player')).toBe(false);
  for (const actor of sim.actors.slice(1)) {
    expect(shots.get(actor.motion.id)).toBeGreaterThan(0);
    expect(actor.motion.distance).toBeGreaterThan(10);
    actor.definition.mounts.forEach(mount => {
      const ticks = shotTicks.get(`${actor.motion.id}:${mount.name} fired`) ?? [];
      ticks.slice(1).forEach((tick, i) => expect((tick - ticks[i]) / 60).toBeGreaterThanOrEqual(mount.weapon.reloadSeconds - 1 / 60));
    });
  }
  const friendly = sim.actors[1];
  for (const battery of ['main', 'secondary']) expect(friendly.definition.mounts.some((mount, i) => mount.battery === battery && friendly.mounts[i].ammo < initial[1][i])).toBe(true);
  expect(sim.player.mounts.map(mount => mount.ammo)).toEqual(initial[0]);
  expect(sim.actors.some(actor => actor.team === 'friendly' && actor.damage.integrity < actor.damage.maxIntegrity)).toBe(true);
  expect(sim.actors.some(actor => actor.team === 'enemy' && actor.damage.integrity < actor.damage.maxIntegrity)).toBe(true);
  const carrier = sim.actors[3];
  carrier.definition.mounts.forEach((mount, i) => { if (mount.weapon.caliberM < .1) expect(carrier.mounts[i].ammo).toBe(initial[3][i]); });
});

test('bots ignore allies, change targets after sinking and hold fire through friendly hulls', () => {
  const sim = fleet(), bot = sim.actors[1];
  expect(botTarget(bot, sim.actors)?.team).toBe('enemy');
  const first = botTarget(bot, sim.actors)!;
  bot.targetId = first.motion.id;
  first.damage.sunk = true;
  expect(botTarget(bot, sim.actors)?.motion.id).not.toBe(first.motion.id);
  const target = botTarget(bot, sim.actors)!;
  Object.assign(sim.player.motion, { x: (bot.motion.x + target.motion.x) / 2, z: (bot.motion.z + target.motion.z) / 2 });
  expect(clearFiringLane(bot, target, sim.actors)).toBe(false);
  sim.player.motion.x += 1000;
  expect(clearFiringLane(bot, target, sim.actors)).toBe(true);
  target.damage.sunk = true;
  expect(botTarget(bot, sim.actors)).toBeUndefined();
});

test('disabled propulsion and guns stop a bot moving and firing; sunk bots cease fire', () => {
  const sim = fleet(), bot = sim.actors[1];
  bot.definition.modules.forEach((module, i) => { if (module.kind === 'engine') bot.damage.modules[i].hp = 0; });
  bot.mounts.forEach(mount => { mount.hp = 0; });
  for (let tick = 0; tick < 600; tick++) sim.step(stop, intent);
  expect(bot.motion.speed).toBe(0);
  expect(sim.events.some(event => event.kind === 'shot' && event.shipId === bot.motion.id)).toBe(false);
  const enemy = sim.actors[2];
  enemy.damage.sunk = true;
  const ammo = enemy.mounts.map(mount => mount.ammo);
  for (let tick = 0; tick < 600; tick++) sim.step(stop, intent);
  expect(enemy.mounts.map(mount => mount.ammo)).toEqual(ammo);
});

test('target selection uses each enemy definition and rejects friendly IDs', () => {
  const sim = fleet();
  expect(sim.selectTarget('friendly-1')).toBe(false);
  expect(sim.selectTarget('enemy-2')).toBe(true);
  const data = sim.telemetry('main', sim.aimAt());
  expect(data.targetName).toBe(shipPreset('enterprise-cv6').name);
  expect(data.modules.map(module => module.id)).toEqual(shipPreset('enterprise-cv6').modules.map(module => module.id));
  expect(data.contacts).toHaveLength(4);
});

test('battle results count all ships and resetting restores every actor without breaking bindings', () => {
  const sim = fleet(), actors = [...sim.actors];
  sim.player.damage.sunk = true;
  sim.step(stop, intent);
  expect(sim.result).toBe('active');
  sim.actors[1].damage.sunk = true;
  sim.step(stop, intent);
  expect(sim.result).toBe('defeat');
  sim.selectTarget('enemy-2'); sim.reset();
  expect(sim.result).toBe('active');
  expect(sim.tick).toBe(0);
  expect(sim.target.motion.id).toBe('enemy-1');
  sim.actors.forEach((actor, i) => {
    expect(actor).toBe(actors[i]);
    expect(actor.damage.integrity).toBe(actor.damage.maxIntegrity);
    expect(actor.damage.sunk).toBe(false);
    expect(actor.damage.compartments.every(c => c.waterM3 === 0)).toBe(true);
  });
  sim.actors.filter(actor => actor.team === 'enemy').forEach(actor => { actor.damage.sunk = true; });
  sim.step(stop, intent); expect(sim.result).toBe('victory');
  sim.reset(); sim.actors.forEach(actor => { actor.damage.sunk = true; });
  sim.step(stop, intent); expect(sim.result).toBe('draw');
});

test('bot combat produces identical outcomes at 30, 60 and 144 display fps', () => {
  const results = [30, 60, 144].map(fps => {
    const sim = new CombatSimulation(shipPreset('baltimore'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
    for (let i = 0; i < fps * 40; i++) sim.advance(1 / fps, { throttle: .5, rudder: -.2 }, intent);
    return { tick: sim.tick, actors: sim.actors, shells: sim.shells, events: sim.events, result: sim.result };
  });
  expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
});
