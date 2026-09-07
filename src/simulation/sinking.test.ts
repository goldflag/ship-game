import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { updateFlooding } from './damage';
import { updateDamageControl } from './damageControl';
import { damageUnderwaterBlast } from './torpedoes';

function fixture(side: number, fill = .05) {
  const def = structuredClone(shipPreset('bismarck'));
  def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  const sim = new CombatSimulation(def), actor = sim.player;
  def.compartments.forEach((c, i) => {
    if (c.center[0] * side > 5) actor.damage.compartments[i].waterM3 = c.capacityM3 * fill;
  });
  return { def, sim, actor };
}
function advance(f: ReturnType<typeof fixture>, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) updateFlooding(f.actor, f.def, 1 / 60);
}

test('surviving underwater hits produce a visible live list with normal damage control running', () => {
  const def = shipPreset('bismarck'), sim = new CombatSimulation(def), actor = sim.player;
  for (const z of [-35, 0, 35]) damageUnderwaterBlast(actor, [-17, -2, z], { damage: 320, breachAreaM2: 3 }, 'Torpedo', z + 40);
  for (let i = 0; i < 120 * 60; i++) {
    updateDamageControl(actor, def, 1 / 60, () => {});
    updateFlooding(actor, def, 1 / 60);
  }
  expect(actor.damage.integrity).toBe(490);
  expect(actor.damage.sunk).toBe(false);
  const telemetry = sim.telemetry('main', [0, 0, -5000]);
  expect(telemetry.playerList).toBeGreaterThan(3);
  expect(telemetry.playerWater).toBeGreaterThan(500);
});

test('uneven flooding lists a fighting ship with full hull HP; draining lets it recover', () => {
  const f = fixture(-1);
  advance(f, 60);
  expect(f.actor.damage.sunk).toBe(false);
  expect(f.actor.damage.integrity).toBe(f.actor.damage.maxIntegrity);
  expect(f.actor.motion.roll).toBeGreaterThan(5 * Math.PI / 180);
  expect(f.actor.motion.y).toBeLessThan(-.1);
  f.actor.damage.compartments.forEach(c => c.waterM3 = 0);
  advance(f, 120);
  expect(Math.abs(f.actor.motion.roll)).toBeLessThan(.005);
  expect(Math.abs(f.actor.motion.y)).toBeLessThan(.01);
});

test('hull failure continues mirrored roll from the flooded side instead of freezing upright', () => {
  const port = fixture(-1), starboard = fixture(1);
  for (const f of [port, starboard]) { f.actor.damage.integrity = 0; advance(f, 30); }
  expect(port.actor.motion.roll).toBeGreaterThan(.1);
  expect(starboard.actor.motion.roll).toBeLessThan(-.1);
  expect(port.actor.motion.roll).toBeCloseTo(-starboard.actor.motion.roll, 4);
  expect(port.actor.damage.defeatCause).toBe('hull-failure');
  expect(port.actor.motion.y).toBeLessThan(0);
});

test('a lost hull continues trimming toward flooded bow or stern', () => {
  const bow = fixture(0), stern = fixture(0);
  for (const [f, end] of [[bow, -1], [stern, 1]] as const) {
    f.def.compartments.forEach((c, i) => {
      if (c.center[2] * end > f.def.hull.length * .25) f.actor.damage.compartments[i].waterM3 = c.capacityM3 * .5;
    });
    f.actor.damage.integrity = 0;
    advance(f, 30);
  }
  expect(bow.actor.motion.pitch).toBeLessThan(-.02);
  expect(stern.actor.motion.pitch).toBeGreaterThan(.02);
});

test('a capsized hull continues responding to water after loss', () => {
  const f = fixture(-1, .2);
  for (let i = 0; i < 120 * 60 && !f.actor.damage.sunk; i++) updateFlooding(f.actor, f.def, 1 / 60);
  expect(f.actor.damage.defeatCause).toBe('capsize');
  const roll = f.actor.motion.roll;
  expect(roll).toBeLessThan(Math.PI - .001);
  advance(f, 10);
  expect(Math.abs(f.actor.motion.roll - roll)).toBeGreaterThan(.005);
  expect(f.actor.motion.roll).toBeGreaterThan(100 * Math.PI / 180);
  expect(f.actor.damage.defeatCause).toBe('capsize');
  expect(f.actor.damage.stability.status).toBe('capsized');
});

test('capsizing after hull failure retains the original cause of loss', () => {
  const f = fixture(-1, .6);
  f.actor.damage.integrity = 0;
  advance(f, 120);
  expect(f.actor.damage.stability.status).toBe('capsized');
  expect(f.actor.damage.defeatCause).toBe('hull-failure');
});

test('sinking gathers speed and eventually clears the whole hull, including an end-on wreck', () => {
  const f = fixture(0);
  f.actor.damage.integrity = 0;
  advance(f, 1);
  const firstSpeed = f.actor.motion.verticalSpeed!;
  expect(firstSpeed).toBeLessThan(0);
  expect(firstSpeed).toBeGreaterThan(-.2);
  advance(f, 30);
  expect(f.actor.motion.verticalSpeed!).toBeLessThan(firstSpeed);
  advance(f, 600);
  expect(f.actor.motion.y).toBeLessThan(-f.def.hull.length / 2);
  const pose = structuredClone(f.actor.motion);
  advance(f, 10);
  expect(f.actor.motion).toEqual(pose);
  f.sim.reset();
  expect(f.actor.motion.y).toBe(0);
  expect(f.actor.motion.roll).toBe(0);
  expect(f.actor.motion.verticalSpeed ?? 0).toBe(0);
});

test('wreck flooding and motion survive serialization, and lost pumps cannot drain water', () => {
  const f = fixture(-1);
  f.actor.damage.integrity = 0;
  f.actor.damage.connections.forEach(c => c.state = 'closed');
  f.def.compartments.forEach(c => c.pumpM3PerSecond = 10);
  const water = f.actor.damage.compartments.map(c => c.waterM3);
  advance(f, 10);
  expect(f.actor.damage.compartments.map(c => c.waterM3)).toEqual(water);
  const restored = structuredClone(f.actor);
  advance(f, 10);
  for (let i = 0; i < 600; i++) updateFlooding(restored, f.def, 1 / 60);
  expect(restored.motion).toEqual(f.actor.motion);
  expect(restored.damage).toEqual(f.actor.damage);
});
