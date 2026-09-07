import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation, type CombatEvent } from './combat';
import { stepAircraft, type AirContext } from './aircraft';
import { advanceProjectile } from './projectile';
import { firstTorpedoHit } from './torpedoes';
import { add, normalize, scale } from './geometry';

function fixture(seed: number) {
  const def = shipPreset('enterprise-cv6');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def], seed });
  sim.target.controller = 'idle';
  sim.actors.forEach(a => a.mounts.forEach(m => { m.hp = 0; }));
  const events: Omit<CombatEvent, 'sequence' | 'tick'>[] = [];
  let id = 0;
  const ctx: AirContext = { ...{ seed }, actors: sim.actors, planes: sim.aircraft, shells: sim.shells,
    torpedoes: sim.torpedoes, releases: sim.airReleases, nextId: () => ++id, emit: e => events.push(e) };
  return { sim, ctx, events };
}

test('aligned fighter bursts can hit or miss, with identical seeded replays', () => {
  const run = (seed: number) => {
    const { sim, ctx, events } = fixture(seed);
    const p = sim.aircraft[0], target = sim.target.airWing!.planes[0];
    Object.assign(p, { phase: 'attack', position: [0, 400, 0], velocity: [0, 0, -100] });
    Object.assign(target, { phase: 'outbound', position: [0, 400, -350], velocity: [0, 0, -100] });
    p.pilot.aimTime = .2; p.pilot.hostileId = target.id; p.pilot.think = 1;
    stepAircraft(ctx, 1 / 60, 0);
    expect(events.some(e => e.kind === 'aircraft-fire')).toBe(true);
    expect(p.ammo).toBe(15);
    return { hp: target.hp, events };
  };
  const results = Array.from({ length: 1024 }, (_, seed) => run(seed));
  const hits = results.filter(r => r.hp < 100);
  expect(hits.length).toBeGreaterThan(10);
  expect(hits.length / results.length).toBeLessThan(.08);
  expect(hits.every(r => r.hp < 40)).toBe(true);
  expect(run(17)).toEqual(run(17));
});

test('rare fighter hits finish damaged enemies and count kills without friendly damage', () => {
  let kills = 0;
  for (let seed = 0; seed < 256; seed++) {
    const { sim, ctx, events } = fixture(seed);
    const p = sim.aircraft[0], target = sim.target.airWing!.planes[0];
    Object.assign(p, { phase: 'attack', position: [0, 400, 0], velocity: [0, 0, -100] });
    Object.assign(target, { hp: 60, phase: 'outbound', position: [0, 400, -350], velocity: [0, 0, -100] });
    p.pilot.aimTime = .2; p.pilot.hostileId = target.id; p.pilot.think = 1;
    stepAircraft(ctx, 1 / 60, 0);
    if (target.phase === 'lost') {
      kills++; expect(p.kills).toBe(1); expect(events.some(e => e.kind === 'aircraft-lost')).toBe(true);
    }
    expect(sim.player.airWing!.planes.every(plane => plane.hp === 100)).toBe(true);
  }
  expect(kills).toBeGreaterThan(0);
});

test('panicked fighters waste forward bursts before obtaining a disciplined gun solution', () => {
  const run = (panic: boolean, friendlyLane = false) => {
    const { sim, ctx, events } = fixture(93);
    const p = sim.aircraft[0], target = sim.target.airWing!.planes[0];
    Object.assign(p, { phase: 'attack', position: [0, 400, 0], velocity: [0, 0, -100] });
    Object.assign(target, { phase: 'outbound', position: [65, 400, -350], velocity: [0, 0, -100] });
    p.pilot.aimTime = .2; p.pilot.hostileId = target.id; p.pilot.think = 1;
    p.pilot.fireDiscipline = { panic, remaining: 3, sequence: 0, yaw: 0, pitch: 0 };
    if (friendlyLane) Object.assign(sim.aircraft[1], { phase: 'outbound', position: [32, 400, -175], velocity: [0, 0, -100] });
    stepAircraft(ctx, 1 / 60, 0);
    return { events: events.filter(e => e.kind === 'aircraft-fire' && e.aircraft?.id === p.id), ammo: p.ammo, hp: target.hp };
  };
  expect(run(false).events).toHaveLength(0);
  const panic = run(true);
  expect(panic.events).toHaveLength(1); expect(panic.events[0].aircraft?.panic).toBe(true);
  expect(panic.ammo).toBe(15); expect(panic.hp).toBe(100);
  expect(run(true, true).events).toHaveLength(0); expect(run(true, true).ammo).toBe(16);
});

for (const squadron of ['vb-6', 'vt-6']) test(`${squadron} releases follow varied seeded attack runs without homing`, () => {
  const run = (seed: number) => {
    const { sim, ctx } = fixture(seed);
    sim.launchAircraft(squadron);
    for (let tick = 0; tick < 180 * 60; tick++) stepAircraft(ctx, 1 / 60, tick / 60);
    const rounds = squadron === 'vb-6' ? ctx.shells : ctx.torpedoes;
    expect(rounds.length).toBeGreaterThan(0);
    return rounds.map(r => ({ position: r.position, velocity: r.velocity }));
  };
  expect(run(11)).not.toEqual(run(29));
  expect(run(11)).toEqual(run(11));
});

for (const squadron of ['vb-6', 'vt-6']) test(`${squadron} produces both physical ship hits and misses across attack runs`, () => {
  let rounds = 0, hits = 0;
  for (let seed = 0; seed < 4; seed++) {
    const { sim, ctx } = fixture(seed);
    sim.launchAircraft(squadron);
    for (let tick = 0; tick < 180 * 60; tick++) stepAircraft(ctx, 1 / 60, tick / 60);
    if (squadron === 'vb-6') for (const bomb of ctx.shells) {
      rounds++; let hit = false;
      for (let tick = 0; tick < 30 * 60; tick++) {
        const end = advanceProjectile(bomb, sim.actors, 1 / 60, e => { if ('impact' in e && e.impact && e.shipId && e.impact.kind !== 'burst') hit = true; });
        if (end) break;
      }
      if (hit) hits++;
    } else for (const torpedo of ctx.torpedoes) {
      rounds++;
      if (firstTorpedoHit(torpedo, torpedo.position, add(torpedo.position, scale(normalize(torpedo.velocity), torpedo.weapon.rangeM)), sim.actors)) hits++;
    }
  }
  expect(rounds).toBeGreaterThanOrEqual(12);
  expect(hits).toBeGreaterThan(0);
  expect(hits).toBeLessThan(rounds);
});
