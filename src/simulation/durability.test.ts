import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { hitShip, type DamageEvent, type Shell } from './damage';
import { localToWorld, rotate } from './geometry';

const helm = { throttle: 0, rudder: 0 };
const quiet = { aim: [0, .5, 0] as [number, number, number], fire: false, battery: 'main' as const };
function battle(target = 'bismarck') {
  const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset(target)] }, 12345);
  sim.target.controller = 'idle';
  Object.assign(sim.player.motion, { x: -5000, z: 0, heading: 0 });
  Object.assign(sim.target.motion, { x: 0, z: 0, heading: 0 });
  return sim;
}
function broadside(sim: CombatSimulation, volley: number) {
  const weapon = sim.definition.mounts[0].weapon;
  for (const [i, z] of [-30, -21, -12, -3, 6, 15, 24, 33].entries()) sim.shells.push({
    id: 1000 + volley * 8 + i, ownerId: 'player', position: localToWorld([-20, .5, z], sim.target.motion),
    velocity: rotate([730, -35, 0], sim.target.motion), age: 0, penetrationMm: 550,
    damage: weapon.damage, caliberM: weapon.caliberM, visited: [], ammunition: 'ap', ap: weapon.ap,
  });
  for (let tick = 0; tick < 30; tick++) sim.step(helm, quiet);
}

test('Bismarck tanks eight landed 15-inch rounds but loses to four to six solid broadsides', () => {
  const sim = battle(), maximum = sim.target.damage.maxIntegrity;
  broadside(sim, 0);
  expect(sim.target.damage.integrity).toBeGreaterThan(maximum * .65);
  expect(sim.target.damage.integrity).toBeLessThan(maximum * .85);
  expect(sim.target.damage.sunk).toBe(false);
  expect(sim.telemetry('main', quiet.aim).playerDamageDealt).toBeCloseTo(maximum - sim.target.damage.integrity, 6);
  // This is the original gap: all machinery and weapons can survive these paths.
  expect(sim.target.mounts.every(m => m.hp === 100)).toBe(true);
  let volleys = 1;
  while (!sim.target.damage.sunk && volleys < 6) broadside(sim, volleys++);
  expect(volleys).toBeGreaterThanOrEqual(4);
  expect(sim.target.damage.sunk).toBe(true);
  expect(sim.target.damage.defeatCause).toBe('hull-failure');
  expect(sim.result).toBe('victory');
  const telemetry = sim.telemetry('main', quiet.aim);
  expect(telemetry.playerDamageDealt).toBeCloseTo(maximum, 6);
  expect(telemetry.playerFrags).toBe(1);
  broadside(sim, volleys);
  expect(sim.telemetry('main', quiet.aim).playerDamageDealt).toBe(telemetry.playerDamageDealt);
  expect(sim.telemetry('main', quiet.aim).playerFrags).toBe(1);
  sim.reset();
  expect(sim.target.damage.integrity).toBe(maximum);
  expect(sim.target.damage.sunk).toBe(false);
});

test('armor rejection, thin through-shots and substantial penetrations have distinct damage', () => {
  const damage = [1000, 5, 100].map(thicknessMm => {
    const def = structuredClone(shipPreset('bismarck'));
    delete def.structuralPlating; delete def.stability;
    def.modules = []; def.mounts = []; def.connections = [];
    def.armor = [0, 4, 8].map((x, i) => ({ id: `plate-${i}`, name: 'Plate', thicknessMm,
      center: [x, 5, 0], size: [.001, 4, 4],
      plate: { vertices: [[x, 3, -2], [x, 7, -2], [x, 7, 2], [x, 3, 2]], material: 'steel' },
    }));
    const actor = new CombatSimulation(def).player, weapon = shipPreset('bismarck').mounts[0].weapon;
    const shell: Shell = { id: 1, ownerId: 'target', position: [-2, 5, 0], velocity: [730, 0, 0], age: 0,
      penetrationMm: 550, damage: weapon.damage, caliberM: weapon.caliberM, ap: weapon.ap, visited: [] };
    const events: DamageEvent[] = [];
    hitShip(shell, [-2, 5, 0], [3, 5, 0], actor, def, e => events.push(e));
    const afterEntry = actor.damage.integrity;
    hitShip(shell, [3, 5, 0], [10, 5, 0], actor, def, e => events.push(e));
    expect(actor.damage.integrity).toBe(afterEntry); // Layers and tick boundaries cannot multiply a shell's damage.
    return actor.damage.maxIntegrity - actor.damage.integrity;
  });
  expect(damage[0]).toBe(0);
  expect(damage[1]).toBeGreaterThan(0);
  expect(damage[2]).toBeGreaterThan(damage[1] * 3);
  expect(damage[2]).toBeLessThan(70);
});
