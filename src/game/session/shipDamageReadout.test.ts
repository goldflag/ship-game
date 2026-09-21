import { expect, test } from 'bun:test';
import { CombatSimulation } from '../../simulation/combat';
import { shipPreset } from '../../ships/presets';
import { shipDamageReadout } from './shipDamageReadout';

test('reports equipment, flooding, open holes and crews without modifying the ship', () => {
  const def = shipPreset('bismarck'), simulation = new CombatSimulation(def), actor = simulation.player;
  const engine = def.modules.findIndex(m => m.kind === 'engine');
  actor.damage.modules[engine].hp = def.modules[engine].hp * .4;
  actor.mounts[0].hp = 0;
  actor.damage.compartments[0].waterM3 = def.compartments[0].capacityM3 * .25;
  actor.damage.compartments[0].breachAreaM2 = .12;
  actor.damage.compartments[1].breachAreaM2 = .03;
  actor.damage.control.teams[0] = { kind: 'patch', index: 0, setup: 2.1 };
  const before = JSON.stringify(actor.damage);
  const report = shipDamageReadout(actor, def);
  expect(report.parts.find(p => p.id === `module:${def.modules[engine].id}`)).toMatchObject({ condition: .4, affected: true, status: 'Flooded · offline' });
  expect(report.parts.find(p => p.id === `weapon:${def.mounts[0].id}`)).toMatchObject({ condition: 0, tone: 'destroyed' });
  expect(report.parts.find(p => p.id === `compartment:${def.compartments[0].id}`)).toMatchObject({ floodFraction: .25, breachM2: .12, crew: 'Patching · ready in 3s', tone: 'flooded' });
  expect(report.parts.find(p => p.id === `compartment:${def.compartments[1].id}`)).toMatchObject({ status: 'Breached · dry', affected: true });
  expect(report.propulsion).toBeLessThan(1);
  expect(JSON.stringify(actor.damage)).toBe(before);
});

test('damage telemetry follows its friendly subject and never copies the enemy damage report', () => {
  const def = shipPreset('bismarck'), simulation = new CombatSimulation(def, { friendlyBots: [def], enemies: [def] });
  const friend = simulation.actors.find(actor => actor !== simulation.player && actor.team === 'friendly')!;
  friend.mounts[0].hp = 27;
  simulation.target.mounts[0].hp = 0;
  const own = simulation.telemetry('main', [0, 0, 0]).playerDamageReport!;
  const other = simulation.telemetry('main', [0, 0, 0], undefined, friend).playerDamageReport!;
  const id = `weapon:${def.mounts[0].id}`;
  expect(own.parts.find(p => p.id === id)?.condition).toBe(1);
  expect(other.parts.find(p => p.id === id)?.condition).toBe(.27);
});
