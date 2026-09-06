/** Controlled landed-hit reproduction. Run: bun scripts/diagnostics/broadside-damage.ts
 * Uses the real fixed-tick combat loop, with incoming rounds placed near the hull
 * to isolate penetration consequences from player aim and dispersion. */
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { equipmentIntegrity } from '../../src/simulation/durability';
const definition = structuredClone(shipPreset('bismarck'));
const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [definition] }, 12345);
sim.target.controller = 'idle';
Object.assign(sim.player.motion, { x: -5000, z: 0, heading: 0 });
Object.assign(sim.target.motion, { x: 0, z: 0, heading: 0 });
for (const [i, z] of [-30, -21, -12, -3, 6, 15, 24, 33].entries()) sim.shells.push({
  id: 1000 + i, ownerId: sim.player.motion.id, position: [-20, .5, z], velocity: [730, -35, 0],
  age: 0, penetrationMm: 550, damage: 70, caliberM: .38, visited: [], ammunition: 'ap', ap: definition.mounts[0].weapon.ap,
});
for (let i = 0; i < 30; i++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, .5, 0], fire: false, battery: 'main' });
const events = sim.events.filter(e => e.shipId === sim.target.motion.id);
console.log(JSON.stringify({ scenario: 'Eight incoming 38 cm AP rounds at the broadside waterline; 5 km nominal impact budget/speed, fixed impacts without dispersion',
  definitionHash: definition.contentHash, hits: new Set(events.filter(e => e.impact).map(e => e.shell!.id)).size,
  penetratingShells: new Set(events.filter(e => e.kind === 'penetration').map(e => e.shell!.id)).size,
  damagePoints: sim.telemetry('main', [0, 0, 0]).playerDamageDealt, hullCondition: sim.target.damage.integrity / sim.target.damage.maxIntegrity,
  equipmentCondition: equipmentIntegrity(sim.target, definition),
  waterM3: sim.target.damage.compartments.reduce((n,c) => n + c.waterM3, 0),
  events: events.map(e => ({ shellId: e.shell?.id, ...e.impact })) }, null, 2));
