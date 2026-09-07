import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { SHIP_AI_LEVELS, type ShipAiLevel } from './aiLevels';
import { resolveBattleFleet, validateBattleSetup, type BattleSetup } from './battle';
import { botAim, botDidFire, botReadyToFire, updateBot } from './bots';
import { CombatSimulation } from './combat';
import { FIXED_DT } from './ship';

const stop = { throttle: 0, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };
const run = (sim: CombatSimulation, seconds: number) => { for (let tick = 0; tick < seconds * 60; tick++) sim.step(stop, intent); };
const fixture = (aiLevel: ShipAiLevel) => new CombatSimulation(shipPreset('bismarck'), {
  friendlyBots: [], enemies: [{ definition: shipPreset('bismarck'), aiLevel }], seed: 42,
});

test('per-slot AI survives setup resolution, duplicate removal, deployment and reset; old selections use Normal', () => {
  const setup: BattleSetup = { playerShipId: 'bismarck', spawnDistance: 5000,
    friendlyBots: ['bismarck', { shipId: 'bismarck', aiLevel: 'easy' }],
    enemies: SHIP_AI_LEVELS.map(level => ({ shipId: 'bismarck', aiLevel: level.id })),
  };
  validateBattleSetup(setup, ['bismarck']);
  setup.enemies.splice(1, 1);
  const sim = new CombatSimulation(shipPreset('bismarck'), resolveBattleFleet(setup, shipPreset));
  const levels: ShipAiLevel[] = ['normal', 'easy', 'static', 'easy', 'normal', 'hard'];
  expect(sim.actors.slice(1).map(actor => actor.bot?.aiLevel)).toEqual(levels);
  expect(sim.player.bot).toBeUndefined();
  run(sim, 1);
  const snapshot = structuredClone(sim.actors);
  sim.reset();
  run(sim, 1);
  expect(sim.actors).toEqual(snapshot);
  const legacy = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('bismarck')], seed: 42 });
  const normal = fixture('normal');
  run(legacy, 1); run(normal, 1);
  expect(legacy.actors).toEqual(normal.actors);
});

test('invalid AI is rejected by both battle setup and direct simulation construction', () => {
  for (const aiLevel of ['expert', '', null, 1, undefined]) {
    const entry = { shipId: 'bismarck', aiLevel: aiLevel as ShipAiLevel };
    expect(() => validateBattleSetup({ playerShipId: 'bismarck', spawnDistance: 5000, friendlyBots: [entry], enemies: ['bismarck'] }, ['bismarck'])).toThrow('AI level');
    // Undefined direct arguments intentionally retain the legacy Normal default.
    if (aiLevel !== undefined) expect(() => fixture(aiLevel as ShipAiLevel)).toThrow('AI level');
  }
});

test('static targets stay in place and moving targets sail without any attacks, including carriers and submarines', () => {
  for (const aiLevel of ['static', 'moving'] as const) {
    const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], spawnDistance: 1000,
      enemies: ['fletcher', 'type-viic', 'enterprise-cv6'].map(id => ({ definition: shipPreset(id), aiLevel })),
    });
    const initial = structuredClone(sim.actors.slice(1));
    run(sim, 45);
    expect(sim.events.filter(e => ['shot', 'torpedo-launch', 'depth-charge-launch', 'aircraft-launch', 'aircraft-fire', 'bomb-release'].includes(e.kind))).toEqual([]);
    for (const [i, actor] of sim.actors.slice(1).entries()) {
      expect(actor.targetId).toBeUndefined();
      expect(actor.bot?.track).toBeUndefined();
      expect(botReadyToFire(actor)).toBe(false);
      expect(actor.mounts.map(m => m.ammo)).toEqual(initial[i].mounts.map(m => m.ammo));
      expect(actor.torpedoTubes?.map(t => t.ammo)).toEqual(initial[i].torpedoTubes?.map(t => t.ammo));
      expect(actor.depthChargeLaunchers?.map(l => l.ammo)).toEqual(initial[i].depthChargeLaunchers?.map(l => l.ammo));
      if (actor.airWing) expect(actor.airWing.planes.every(p => p.phase === 'ready')).toBe(true);
      if (actor.submarine) expect(actor.submarine.targetDepthM).toBe(0);
      const displacement = Math.hypot(actor.motion.x - initial[i].motion.x, actor.motion.z - initial[i].motion.z);
      if (aiLevel === 'static') {
        expect(displacement).toBe(0);
        expect(actor.motion.heading).toBeCloseTo(initial[i].motion.heading, 12);
        expect(actor.motion.speed).toBe(0);
      } else expect(displacement).toBeGreaterThan(50);
    }
  }
});

test('passive targets still receive ordinary damage and count toward victory', () => {
  const sim = fixture('static');
  sim.target.damage.integrity = 0;
  run(sim, 1);
  expect(sim.target.damage.sunk).toBe(true);
  expect(sim.result).toBe('victory');
});

test('passive ships leave nearby aircraft unharmed while combat AI retains anti-aircraft defense', () => {
  for (const aiLevel of ['static', 'moving', 'normal'] as const) {
    const sim = new CombatSimulation(shipPreset('enterprise-cv6'), {
      friendlyBots: [], enemies: [{ definition: shipPreset('fletcher'), aiLevel }],
    });
    const plane = sim.player.airWing!.planes[0];
    let shots = 0;
    for (let tick = 0; tick < 600; tick++) {
      Object.assign(plane, { phase: 'outbound', deckSlot: undefined, position: [sim.target.motion.x + 700, 250, sim.target.motion.z], velocity: [0, 0, 0] });
      sim.step(stop, intent);
      shots += sim.events.filter(e => e.tick === sim.tick - 1 && e.kind === 'aircraft-fire' && e.shipId === sim.target.motion.id).length;
    }
    if (aiLevel === 'normal') { expect(shots).toBeGreaterThan(0); expect(plane.hp).toBeLessThan(100); }
    else { expect(shots).toBe(0); expect(plane.hp).toBe(100); }
  }
});

test('combat skill improves acquisition, tracking, accuracy, firing cadence and damage reaction without changing equipment', () => {
  const results = (['easy', 'normal', 'hard'] as const).map(level => {
    const sim = fixture(level), actor = sim.target, bot = actor.bot!;
    updateBot(actor, sim.player, 0);
    const mount = actor.definition.mounts[0], state = actor.mounts[0];
    // Measure range error at the same hull point, independently of random focus and leading.
    bot.track!.focus = 1;
    Object.assign(bot.guns[mount.id], { alongHull: 0, height: 1, rangeError: 1, acrossError: 0 });
    const aim = botAim(actor, sim.player, mount, state);
    const error = Math.hypot(aim[0] - sim.player.motion.x, aim[2] - sim.player.motion.z);
    const acquisition = bot.track!.fireAt;
    for (let tick = 1; tick <= 5 * 60; tick++) updateBot(actor, sim.player, tick * FIXED_DT);
    sim.player.motion.speed = 12;
    actor.damage.integrity -= 20;
    for (let tick = 1; tick <= 60; tick++) updateBot(actor, sim.player, 5 + tick * FIXED_DT);
    const trackedSpeed = Math.hypot(...bot.track!.velocity);
    const evading = bot.evadeUntil > 6;
    botDidFire(actor, mount);
    expect(actor.definition).toBe(shipPreset('bismarck'));
    expect(actor.damage.maxIntegrity).toBe(sim.player.damage.maxIntegrity);
    return { acquisition, error, trackedSpeed, evading, cadence: bot.guns[mount.id].fireAt - bot.time - mount.weapon.reloadSeconds };
  });
  const [easy, normal, hard] = results;
  for (const key of ['acquisition', 'error', 'cadence'] as const) {
    expect(easy[key]).toBeGreaterThan(normal[key]);
    expect(normal[key]).toBeGreaterThan(hard[key]);
  }
  expect(hard.trackedSpeed).toBeGreaterThan(normal.trackedSpeed);
  expect(hard.trackedSpeed).toBeGreaterThan(easy.trackedSpeed);
  expect(easy.evading).toBe(false);
  expect(hard.evading).toBe(true);
});

test('every combat skill maneuvers and fires, and mixed AI stays deterministic at different display rates', () => {
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const sim = fixture(level);
    run(sim, 40);
    expect(sim.target.motion.distance).toBeGreaterThan(50);
    expect(sim.target.mounts.some((m, i) => m.ammo < sim.target.definition.mounts[i].weapon.ammoPerBarrel * (sim.target.definition.mounts[i].weapon.barrelCount ?? 2))).toBe(true);
  }
  const snapshot = (fps: number) => {
    const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [],
      enemies: SHIP_AI_LEVELS.map(level => ({ definition: shipPreset('bismarck'), aiLevel: level.id })),
    });
    for (let frame = 0; frame < 5 * fps; frame++) sim.advance(1 / fps, stop, intent);
    return { tick: sim.tick, actors: structuredClone(sim.actors), events: sim.events };
  };
  expect(snapshot(30)).toEqual(snapshot(144));
});
