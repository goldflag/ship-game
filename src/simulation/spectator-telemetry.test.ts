import { expect, test } from 'bun:test';
import { CombatSimulation } from './combat';
import { shipPreset } from '../ships/presets';
import { weaponGroups } from '../ships/weaponGroups';

test('spectator instruments read the watched ship while death and score remain the player’s', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'), {
    friendlyBots: [shipPreset('type-viic'), shipPreset('fletcher')], enemies: [shipPreset('bismarck')],
  });
  sim.player.damage.sunk = true;
  sim.player.damage.integrity = 0;
  for (const actor of sim.actors.filter(a => a.controller === 'bot' && a.team === 'friendly')) {
    actor.damage.integrity = actor.damage.maxIntegrity * .6;
    actor.motion.roll = .1;
    const group = weaponGroups(actor.definition)[0];
    const data = sim.telemetry(group.battery, [0, 0, -5000], group.id, actor);
    expect(data.playerIntegrity).toBeCloseTo(.6);
    expect(data.playerMaxIntegrity).toBe(actor.damage.maxIntegrity);
    expect(data.playerList).toBeCloseTo(.1 * 180 / Math.PI);
    expect(data.weaponGroups.map(g => g.id)).toEqual(weaponGroups(actor.definition).map(g => g.id));
    expect(data.mounts.map(m => m.id)).toEqual(group.mountIds);
    expect(!!data.submarine).toBe(!!actor.submarine);
    expect(data.playerSunk).toBe(true);
    expect(data.playerDamageDealt).toBe(sim.telemetry('main', [0, 0, 0]).playerDamageDealt);
    expect(data.playerFrags).toBe(sim.telemetry('main', [0, 0, 0]).playerFrags);
    expect(actor.controller).toBe('bot');
  }
  expect(sim.telemetry('main', [0, 0, -5000]).playerIntegrity).toBe(0);
});
