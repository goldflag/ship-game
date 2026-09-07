import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/type-viic/blueprint.json';
import bismarck from '../../assets/ships/bismarck/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
import baltimore from '../../assets/ships/baltimore/blueprint.json';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { clearTorpedoLane, damageTorpedoHit, firstTorpedoHit, torpedoIntercept, type Torpedo, type TubeState } from './torpedoes';
import { FIXED_DT } from './ship';
import { botTorpedoAim } from './bots';
import { localToWorld, normalize, scale, sub } from './geometry';
import type { FleetActor } from './battle';
import { updateCapability } from './stability';

const definition = compileShip(blueprint, catalog);
const helm = { throttle: 0, rudder: 0 }, ahead: Vec3 = [0, 0, -1500];
const intent = (aim: Vec3 = ahead, fire = false) => ({ aim, fire, battery: 'torpedo' as const });
const rounds = (sim: CombatSimulation) => sim.player.torpedoTubes!.reduce((n, t) => n + t.ammo, 0);
const step = (sim: CombatSimulation, ticks: number, aim = ahead, fire = false) => { for (let i = 0; i < ticks; i++) sim.step(helm, intent(aim, fire)); };
const projectile = (ownerId = 'player', distance = 400): Torpedo => ({ id: 1, ownerId, tubeId: 'bow-tube-1', position: [0, -2, -400], velocity: [0, 0, -definition.torpedoTubes![0].weapon.speed], distance, age: 0, weapon: definition.torpedoTubes![0].weapon });
const broadsideRound = (actor: FleetActor, station: number): Torpedo => {
  const t = projectile();
  t.position = localToWorld([-4, -2, station], actor.motion);
  t.velocity = scale(normalize(sub(localToWorld([4, -2, station], actor.motion), t.position)), t.weapon.speed);
  return t;
};

test('VIIC compiles five fixed tubes, fourteen rounds and independent original gun parts', () => {
  expect(definition.torpedoTubes).toHaveLength(5);
  expect(definition.torpedoTubes!.map(t => t.bearingDeg)).toEqual([0, 0, 0, 0, 180]);
  expect(rounds(new CombatSimulation(definition))).toBe(14);
  expect(definition.mounts.map(m => m.weapon.caliberM)).toEqual([.088, .02]);
  const clone = compileShip(blueprint, catalog); clone.torpedoTubes![0].weapon.damage = 1;
  expect(clone.torpedoTubes![1].weapon.damage).toBe(340);
});

test('rejects malformed tube connections, IDs, ammunition, launch geometry and weapon performance', () => {
  const bad = (edit: (b: any) => void, message: RegExp) => { const b = structuredClone(blueprint); edit(b); expect(() => compileShip(b, catalog)).toThrow(message); };
  bad(b => b.torpedoTubes[1].id = b.torpedoTubes[0].id, /duplicate/);
  bad(b => b.torpedoTubes[0].id = 'deck-gun', /already used/);
  bad(b => b.torpedoTubes[0].partId = 'missing', /unknown torpedo/);
  bad(b => b.torpedoTubes[0].magazineId = 'diesels', /magazine/);
  bad(b => b.torpedoTubes[0].ammo = 1.5, /integer/);
  bad(b => b.torpedoTubes[0].position[0] = 100, /envelope/);
  bad(b => b.torpedoTubes[0].position[1] = .1, /submerged/);
  bad(b => b.torpedoTubes[0].arcDeg = NaN, /finite/);
  const c = structuredClone(catalog); c.torpedoes[0].speed = 0;
  expect(() => compileShip(blueprint, c)).toThrow(/speed/);
  c.torpedoes[0].speed = 20; c.torpedoes[0].armingDistanceM = 5000;
  expect(() => compileShip(blueprint, c)).toThrow(/arming distance/);
});

test('click fires one bow tube; holding fires the remaining three at spaced intervals', () => {
  const sim = new CombatSimulation(definition), guns = sim.player.mounts.map(m => m.ammo);
  sim.requestFire(); step(sim, 1);
  expect(sim.torpedoes).toHaveLength(1); expect(rounds(sim)).toBe(13);
  expect(sim.events[0].position).toEqual(definition.torpedoTubes![0].position);
  step(sim, 180, ahead, true);
  expect(sim.torpedoes).toHaveLength(4); expect(rounds(sim)).toBe(10);
  expect(sim.player.mounts.map(m => m.ammo)).toEqual(guns); expect(sim.shells).toHaveLength(0);
  expect(sim.player.torpedoTubes![4].ammo).toBe(2);
});

test('stern tube fires astern and the four bow tubes preserve their rounds', () => {
  const sim = new CombatSimulation(definition); step(sim, 1, [0, 0, 1500], true);
  expect(sim.torpedoes[0].tubeId).toBe('stern-tube');
  expect(sim.torpedoes[0].velocity[2]).toBeGreaterThan(0);
  expect(sim.player.torpedoTubes!.map(t => t.ammo)).toEqual([3, 3, 3, 3, 1]);
});

test('unavailable shots are consumed, with explicit arc, range, arming and disabled states', () => {
  const sim = new CombatSimulation(definition);
  for (const [aim, status] of [[[1500, 0, 0], 'out-of-arc'], [[0, 0, -100], 'too-close'], [[0, 0, -6000], 'out-of-range'], [[NaN, 0, 0], 'out-of-arc']] as [Vec3, TubeState['status']][]) {
    sim.requestFire(); step(sim, 1, aim); expect(sim.player.torpedoTubes![0].status).toBe(status);
    step(sim, 1); expect(sim.torpedoes).toHaveLength(0); expect(rounds(sim)).toBe(14);
  }
  sim.player.damage.modules.find(m => m.id === 'forward-torpedoes')!.hp = 0;
  step(sim, 1, ahead, true); expect(sim.player.torpedoTubes![0].status).toBe('disabled'); expect(rounds(sim)).toBe(14);
});

test('reload completes independently of the sight, empty tubes stay empty and reset restores everything', () => {
  const sim = new CombatSimulation(definition); step(sim, 1, ahead, true);
  sim.player.torpedoTubes![0].reload = .1;
  step(sim, 60, [1500, 0, 0]); step(sim, 1, ahead, true);
  expect(sim.player.torpedoTubes![0].ammo).toBe(1);
  sim.player.torpedoTubes!.forEach(t => t.ammo = 0);
  step(sim, 60, ahead, true); expect(rounds(sim)).toBe(0);
  expect(sim.player.torpedoTubes!.every(t => t.status === 'empty')).toBe(true);
  sim.reset(); expect(rounds(sim)).toBe(14); expect(sim.torpedoes).toHaveLength(0);
  expect(sim.telemetry('torpedo', ahead).playerDamageDealt).toBe(0);
});

test('torpedoes stay underwater at fixed speed, keep their launch course and expire at their range', () => {
  const sim = new CombatSimulation(definition); step(sim, 1, ahead, true);
  const t = sim.torpedoes[0], velocity: Vec3 = [...t.velocity];
  step(sim, 300, [1500, 0, 0]);
  expect(t.velocity).toEqual(velocity); expect(t.position[1]).toBeCloseTo(-2, 6);
  expect(t.distance).toBeCloseTo(t.weapon.speed * 301 * FIXED_DT, 6);
  t.distance = t.weapon.rangeM - .1; step(sim, 1);
  expect(sim.torpedoes).toHaveLength(0); expect(sim.events.at(-1)?.kind).toBe('torpedo-expired');
  expect(t.distance).toBe(t.weapon.rangeM);
});

test('swept torpedoes hit the nearest physical hull on either team and pass below deep wrecks', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition], spawnDistance: 1000 });
  const ally = sim.actors[1]; ally.motion.x = 0; ally.motion.z = -500;
  sim.target.motion.z = -800;
  const t = projectile();
  expect(firstTorpedoHit(t, [0, -2, -300], [0, -2, -1000], [sim.target, ally, sim.player])?.actor).toBe(ally);
  ally.motion.y = -20;
  expect(firstTorpedoHit(t, [0, -2, -300], [0, -2, -1000], sim.actors)?.actor).toBe(sim.target);
});

test.each([bismarck, yamato, baltimore, enterprise])('torpedoes strike each existing hull below its armor belt (%s)', blueprint => {
  const target = compileShip(blueprint, catalog);
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [target], spawnDistance: 1000 });
  const hit = firstTorpedoHit(projectile(), [-100, -2, -1000], [100, -2, -1000], sim.actors);
  expect(hit?.actor).toBe(sim.target);
});

test('contact before arming is a dud; armed hits apply flooding and score only actual enemy damage', () => {
  const sim = new CombatSimulation(definition); sim.target.motion.x = 0; sim.target.motion.z = -600;
  const t = projectile('player', 0); t.position = [-4, -2, -600]; t.velocity = [t.weapon.speed, 0, 0];
  sim.torpedoes.push(t); step(sim, 15);
  expect(sim.target.damage.integrity).toBe(sim.target.damage.maxIntegrity);
  expect(sim.events.some(e => e.kind === 'torpedo-dud')).toBe(true);
  const armed = broadsideRound(sim.target, 11.3);
  sim.torpedoes.push(armed); step(sim, 15);
  expect(sim.target.damage.integrity).toBeLessThan(sim.target.damage.maxIntegrity);
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0 && c.waterM3 > 0)).toBe(true);
  const data = sim.telemetry('torpedo', ahead);
  expect(data.playerDamageDealt).toBeGreaterThan(0);
  expect(data.playerDamageDealt).toBeCloseTo(sim.target.damage.maxIntegrity - sim.target.damage.integrity, 1);
  expect(data.damageLog).toHaveLength(1);
  expect(data.damageLog[0]).toMatchObject({ sourceId: 'player', targetId: 'target', damage: data.playerDamageDealt, hits: 1 });
  expect(data.damageLog[0].weapon).toContain('Torpedo');
});

test('launched bow salvo can sink an opponent, earning one frag, then battle reset clears it', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [definition], spawnDistance: 1000 });
  sim.target.controller = 'idle';
  step(sim, 180, [0, 0, -1000], true); step(sim, 2700, [0, 0, -1000]);
  expect(sim.target.damage.sunk).toBe(true); expect(sim.result).toBe('victory');
  expect(sim.target.damage.defeatCause).toBe('hull-failure');
  expect(sim.telemetry('torpedo', ahead).playerFrags).toBe(1);
  expect(sim.telemetry('torpedo', ahead).playerDamageDealt).toBeLessThanOrEqual(sim.target.damage.maxIntegrity);
  sim.reset(); expect(sim.result).toBe('active'); expect(rounds(sim)).toBe(14);
  expect(sim.telemetry('torpedo', ahead).playerFrags).toBe(0);
});

test('friendly torpedo damage and wreck hits do not add player score', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition], spawnDistance: 1000 });
  const ally = sim.actors[1]; ally.controller = 'idle'; ally.motion.x = 0; ally.motion.z = -600; sim.target.controller = 'idle';
  const t = broadsideRound(ally, 11.3);
  sim.torpedoes.push(t); step(sim, 15);
  expect(ally.damage.integrity).toBeLessThan(ally.damage.maxIntegrity);
  expect(sim.telemetry('torpedo', ahead).playerDamageDealt).toBe(0);
});

test('torpedo openings retain their position and magazine damage does not invent a detonation', () => {
  const sim = new CombatSimulation(definition), point: Vec3 = [-2, -2, -22];
  const before = sim.target.damage.integrity;
  damageTorpedoHit(projectile(), sim.target, point);
  const room = sim.target.damage.compartments.find(c => c.id === 'forward-torpedo-room')!;
  expect(room.breaches).toEqual([expect.objectContaining({ position: point, areaM2: 1.6, shellId: 1 })]);
  expect(sim.target.damage.modules.find(m => m.id === 'forward-torpedoes')).toMatchObject({ hp: 0, detonated: false });
  expect(sim.target.damage.integrity).toBe(before - projectile().weapon.damage);
  updateCapability(sim.target, definition);
  expect(sim.target.damage.integrity).toBe(before - projectile().weapon.damage);
  for (let i = 0; i < 10; i++) damageTorpedoHit(projectile(), sim.target, point);
  expect(room.breachAreaM2).toBe(4);
  expect(room.breaches.reduce((n, b) => n + b.areaM2, 0)).toBe(4);
});

test('loaded tubes preserve fighting strength after gun loss and recover after magazine flooding', () => {
  const sim = new CombatSimulation(definition);
  sim.player.mounts.forEach(m => m.hp = 0);
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(false);
  const room = sim.player.damage.compartments.find(c => c.id === 'forward-torpedo-room')!;
  room.waterM3 = definition.compartments.find(c => c.id === room.id)!.capacityM3;
  step(sim, 1, ahead, true);
  expect(sim.player.torpedoTubes![0].status).toBe('disabled');
  expect(rounds(sim)).toBe(14);
  room.waterM3 = 0;
  step(sim, 1, ahead, true);
  expect(rounds(sim)).toBe(13);
  expect(sim.player.damage.stability.combatLost).toBe(false);
  sim.player.torpedoTubes!.forEach(t => t.ammo = 0);
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(true);
});

test('torpedoes cannot score against an already disarmed afloat opponent', () => {
  const sim = new CombatSimulation(definition);
  sim.target.mounts.forEach(m => m.hp = 0);
  sim.target.torpedoTubes!.forEach(t => t.ammo = 0);
  updateCapability(sim.target, definition);
  expect(sim.target.damage.stability.combatLost).toBe(true);
  sim.torpedoes.push(broadsideRound(sim.target, 11.3));
  step(sim, 15);
  expect(sim.events.some(e => e.kind === 'torpedo-hit')).toBe(true);
  expect(sim.telemetry('torpedo', ahead).playerDamageDealt).toBe(0);
  expect(sim.telemetry('torpedo', ahead).playerFrags).toBe(0);
});

test('bot lead intercepts a crossing target; friendly ships block the predicted torpedo lane', () => {
  const aim = torpedoIntercept([0, -2, 0], [0, 0, -1000], [10, 0, 0], 20)!;
  const time = Math.hypot(aim[0], aim[2]) / 20;
  expect(aim[0]).toBeCloseTo(time * 10, 6);
  expect(torpedoIntercept([0, 0, 0], [0, 0, -1000], [0, 0, -30], 20)).toBeNull();
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition], spawnDistance: 1000 });
  sim.actors[1].motion.x = 0; sim.actors[1].motion.z = -500;
  expect(clearTorpedoLane(sim.player, [0, -2, -30], [0, 0, -1000], 20, sim.actors)).toBe(false);
  sim.actors[1].motion.x = 500;
  expect(clearTorpedoLane(sim.player, [0, -2, -30], [0, 0, -1000], 20, sim.actors)).toBe(true);
});

test('bot VIICs wait for target acquisition before using their tubes', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [definition], spawnDistance: 1000 });
  step(sim, 8 * 60);
  expect(sim.torpedoes).toHaveLength(0);
  expect(sim.target.torpedoTubes!.reduce((n, t) => n + t.ammo, 0)).toBe(14);
  step(sim, 12 * 60);
  expect(sim.torpedoes.some(t => t.ownerId === sim.target.motion.id)).toBe(true);
  expect(sim.target.torpedoTubes!.reduce((n, t) => n + t.ammo, 0)).toBeLessThan(14);
});

test('bot torpedo lead uses delayed observations after a target changes course', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [definition], spawnDistance: 1000 });
  const actor = sim.target, tube = definition.torpedoTubes![0];
  step(sim, 1);
  const before = botTorpedoAim(actor, tube)!;
  sim.player.motion.heading = Math.PI / 2; sim.player.motion.speed = 8;
  step(sim, 1);
  const immediate = botTorpedoAim(actor, tube)!;
  expect(Math.hypot(immediate[0] - before[0], immediate[2] - before[2])).toBeLessThan(1);
  step(sim, 3 * 60);
  expect(Math.abs(botTorpedoAim(actor, tube)![0] - before[0])).toBeGreaterThan(20);
});

test('VIIC deck and platform guns remain articulated and fire through the shared gun system', () => {
  const sim = new CombatSimulation(definition);
  for (const battery of ['main', 'secondary'] as const) {
    const aim: Vec3 = battery === 'main' ? [700, .5, -400] : [700, .5, 400];
    for (let i = 0; i < 1200; i++) sim.step(helm, { aim, fire: false, battery });
    const m = sim.player.mounts[battery === 'main' ? 0 : 1], ammo = m.ammo;
    expect(m.status).toBe('ready'); sim.step(helm, { aim, fire: true, battery });
    expect(m.ammo).toBe(ammo - 1);
  }
  expect(rounds(sim)).toBe(14);
});

test('invalid intent shapes cannot launch torpedoes or poison the simulation', () => {
  const sim = new CombatSimulation(definition);
  for (const aim of [null, [], [0, 0], [0, 0, Infinity], 'forward']) {
    sim.step(helm, { aim: aim as unknown as Vec3, fire: true, battery: 'torpedo' });
  }
  expect(rounds(sim)).toBe(14); expect(sim.torpedoes).toHaveLength(0);
  expect(Object.values(sim.ship).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
});

test('torpedo simulation is deterministic across display rates and remains renderer-free', () => {
  const a = new CombatSimulation(definition), b = new CombatSimulation(definition);
  for (let i = 0; i < 300; i++) a.advance(1 / 30, helm, intent(ahead, true));
  for (let i = 0; i < 1440; i++) b.advance(1 / 144, helm, intent(ahead, true));
  expect(a.torpedoes).toEqual(b.torpedoes); expect(a.player.torpedoTubes).toEqual(b.player.torpedoTubes);
});
