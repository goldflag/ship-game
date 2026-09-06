import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import type { ShipDefinition } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { localToWorld, rotate } from './geometry';
import type { FleetActor } from './battle';

const helm = { throttle: 0, rudder: 0 };
const intent = { aim: [0, 0, -5000] as [number, number, number], fire: false, battery: 'main' as const };
function fixture() {
  // One thin hull surface isolates actual hull loss from the historical preset's layers.
  const definition: ShipDefinition = { ...shipPreset('baltimore'), structuralPlating: undefined, mounts: [], modules: [],
    armor: [{ id: 'hull', name: 'Hull', center: [0, 0, 0], size: [20, 10, 100], thicknessMm: 1 }] };
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition, definition] });
  sim.actors.filter(a => a !== sim.player).forEach(a => a.controller = 'idle');
  return sim;
}
function hit(sim: CombatSimulation, victim: FleetActor, owner: FleetActor, damage = 100, penetrationMm = 100) {
  sim.shells.push({ id: sim.tick + 1, ownerId: owner.motion.id, position: localToWorld([-15, .5, 0], victim.motion),
    velocity: rotate([820, 0, 0], victim.motion), age: 0, damage, penetrationMm, caliberM: .38, visited: [] });
  sim.step(helm, intent);
  sim.shells.length = 0;
}
const score = (sim: CombatSimulation) => {
  const t = sim.telemetry('main', intent.aim);
  return [t.playerDamageDealt, t.playerFrags];
};

test('score counts actual enemy HP loss, caps overkill and awards a sinking once', () => {
  const sim = fixture();
  const maxHp = sim.target.damage.maxIntegrity;
  hit(sim, sim.target, sim.player);
  expect(score(sim)).toEqual([20, 0]);
  hit(sim, sim.target, sim.player, 10000);
  expect(score(sim)).toEqual([maxHp, 1]);
  for (let i = 0; i < 30; i++) sim.step(helm, intent);
  hit(sim, sim.target, sim.player);
  expect(score(sim)).toEqual([maxHp, 1]);
  sim.selectTarget('enemy-2');
  expect(score(sim)).toEqual([maxHp, 1]);
  sim.reset();
  expect(score(sim)).toEqual([0, 0]);
});

test('stopped rounds, allied hits and bot kills do not increase the player score', () => {
  const sim = fixture(), ally = sim.actors[1];
  hit(sim, sim.target, sim.player, 100, 0);
  hit(sim, ally, sim.player, 10000);
  hit(sim, sim.player, sim.target);
  hit(sim, sim.target, sim.actors[1], 10000);
  expect(score(sim)).toEqual([0, 0]);
});

test('the final hostile damaging hit earns the frag, including delayed flooding', () => {
  const sim = fixture(), ally = sim.actors[1];
  hit(sim, sim.target, sim.player);
  hit(sim, sim.target, ally, 10000);
  expect(score(sim)).toEqual([20, 0]);
  sim.selectTarget('enemy-2');
  hit(sim, sim.target, sim.player);
  sim.target.damage.compartments.forEach((c, i) => c.waterM3 = sim.target.definition.compartments[i].capacityM3);
  sim.step(helm, intent);
  expect(sim.target.damage.sunk).toBe(true);
  expect(score(sim)).toEqual([40, 1]);
  sim.step(helm, intent);
  expect(score(sim)).toEqual([40, 1]);
});

test('another shell in the lethal tick cannot take the frag from an already destroyed hull', () => {
  const sim = fixture();
  sim.target.damage.integrity = 20;
  for (const owner of [sim.actors[1], sim.player]) sim.shells.push({
    id: sim.shells.length + 1, ownerId: owner.motion.id, position: localToWorld([-15, .5, 0], sim.target.motion),
    velocity: rotate([820, 0, 0], sim.target.motion), age: 0, damage: 100, penetrationMm: 100, caliberM: .38, visited: [],
  });
  sim.step(helm, intent); // Shells resolve in reverse order: player, then ally.
  expect(score(sim)).toEqual([20, 1]);
});
