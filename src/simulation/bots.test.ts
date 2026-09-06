import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { botAim, botHelm } from './bots';

const stop = { throttle: 0, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };

test('bots give the player time to get underway before their opening shots', () => {
  for (const spawnDistance of [1000, 5000]) {
    const sim = new CombatSimulation(shipPreset('yamato'), {
      friendlyBots: [shipPreset('bismarck')], enemies: [shipPreset('bismarck'), shipPreset('baltimore')], spawnDistance,
    });
    for (let tick = 0; tick < 8 * 60; tick++) sim.step(stop, intent);
    expect(sim.events.some(event => event.kind === 'shot')).toBe(false);
    expect(sim.player.damage.integrity).toBe(sim.player.damage.maxIntegrity);
    for (let tick = 0; tick < 32 * 60; tick++) sim.step(stop, intent);
    for (const actor of sim.actors.slice(1)) {
      expect(actor.mounts.some((mount, i) => mount.ammo < actor.definition.mounts[i].weapon.ammoPerBarrel * (actor.definition.mounts[i].weapon.barrelCount ?? 2))).toBe(true);
    }
  }
});

test('gun crews choose different aim points and revise them during an engagement', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
  const bot = sim.actors[1];
  sim.step(stop, intent);
  const aims = bot.definition.mounts.slice(0, 2).map((mount, i) => botAim(bot, sim.player, mount, bot.mounts[i]));
  expect(Math.hypot(aims[0][0] - aims[1][0], aims[0][2] - aims[1][2])).toBeGreaterThan(5);
  // Hold guns in reload without knocking the bot out through ammunition loss.
  bot.mounts.forEach(mount => { mount.reload = 120; });
  for (let tick = 0; tick < 40 * 60; tick++) sim.step(stop, intent);
  const later = botAim(bot, sim.player, bot.definition.mounts[0], bot.mounts[0]);
  expect(Math.hypot(later[0] - aims[0][0], later[2] - aims[0][2])).toBeGreaterThan(20);
});

test('a sudden course change takes time to enter a bot firing solution', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
  const bot = sim.actors[1];
  bot.mounts.forEach(mount => { mount.reload = 120; });
  const aim = () => botAim(bot, sim.player, bot.definition.mounts[0], bot.mounts[0]);
  sim.step(stop, intent);
  const before = aim();
  sim.player.motion.heading = Math.PI / 2;
  sim.player.motion.speed = 12;
  sim.step({ throttle: 1, rudder: 0 }, intent);
  const immediately = aim();
  expect(Math.hypot(immediately[0] - before[0], immediately[2] - before[2])).toBeLessThan(1);
  for (let tick = 0; tick < 3 * 60; tick++) sim.step({ throttle: 1, rudder: 0 }, intent);
  expect(Math.abs(aim()[0] - before[0])).toBeGreaterThan(20);
});

test('switching targets requires a fresh solution and never spends ammunition during acquisition', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), {
    friendlyBots: [shipPreset('yamato')], enemies: [shipPreset('bismarck')],
  });
  const bot = sim.actors[2];
  for (let tick = 0; tick < 20 * 60; tick++) sim.step(stop, intent);
  expect(bot.targetId).toBe('player');
  sim.player.damage.sunk = true;
  const ammo = bot.mounts.map(mount => mount.ammo);
  for (let tick = 0; tick < 3 * 60; tick++) sim.step(stop, intent);
  expect(bot.targetId).toBe('friendly-1');
  expect(bot.mounts.map(mount => mount.ammo)).toEqual(ammo);
});

test('an early target loss cannot shorten the opening acquisition window', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), {
    friendlyBots: [shipPreset('yamato')], enemies: [shipPreset('bismarck')], seed: 5,
  });
  sim.actors[1].controller = 'idle';
  Object.assign(sim.actors[1].motion, { x: 0, z: 650 });
  for (let tick = 0; tick < 8 * 60; tick++) {
    if (tick === 60) sim.player.damage.sunk = true;
    sim.step(stop, intent);
  }
  expect(sim.actors[2].targetId).toBe('friendly-1');
  expect(sim.events.some(event => event.kind === 'shot')).toBe(false);
});

test('battle seeds vary courses and opening shots while resets reproduce crew decisions', () => {
  const opening = (sim: CombatSimulation) => {
    let firstShot: number | undefined;
    for (let tick = 0; tick < 25 * 60; tick++) {
      sim.step(stop, intent);
      firstShot ??= sim.events.find(event => event.kind === 'shot')?.tick;
    }
    expect(firstShot).toBeGreaterThanOrEqual(8 * 60);
    expect(firstShot).toBeLessThan(25 * 60);
    return { firstShot, actors: structuredClone(sim.actors) };
  };
  const runs = [1, 2, 3].map(seed => {
    const sim = new CombatSimulation(shipPreset('yamato'), { friendlyBots: [], enemies: [shipPreset('bismarck')], seed });
    const result = opening(sim);
    sim.reset();
    expect(opening(sim)).toEqual(result);
    return result;
  });
  expect(new Set(runs.map(run => run.firstShot)).size).toBeGreaterThan(1);
  expect(new Set(runs.map(run => run.actors[1].motion.heading)).size).toBeGreaterThan(1);
});

test('taking damage prompts a sustained evasive helm order after a crew reaction', () => {
  const sim = new CombatSimulation(shipPreset('yamato'), { friendlyBots: [], enemies: [shipPreset('bismarck')] });
  const bot = sim.actors[1];
  bot.mounts.forEach(mount => { mount.reload = 120; });
  for (let tick = 0; tick < 3 * 60; tick++) sim.step(stop, intent);
  const before = botHelm(bot, sim.player, sim.actors);
  bot.damage.integrity -= 40;
  sim.step(stop, intent);
  expect(botHelm(bot, sim.player, sim.actors)).toEqual(before);
  for (let tick = 0; tick < 2 * 60; tick++) sim.step(stop, intent);
  expect(botHelm(bot, sim.player, sim.actors).throttle).toBe(.85);
  for (let tick = 0; tick < 5 * 60; tick++) sim.step(stop, intent);
  expect(botHelm(bot, sim.player, sim.actors).throttle).toBe(.85);
});
