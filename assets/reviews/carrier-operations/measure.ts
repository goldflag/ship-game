import { CombatSimulation } from '../../../src/simulation/combat';
import { shipPreset } from '../../../src/ships/presets';
import { stepAircraft, onFlightDeck, type AirContext } from '../../../src/simulation/aircraft';
const def = shipPreset('enterprise-cv6');
const sim = new CombatSimulation(def, { enemies: [def], friendlyBots: [], spawnDistance: 5000 });
sim.target.controller = 'idle'; sim.target.mounts.forEach(m => { m.hp = 0; });
for (const squadron of ['vf-6', 'vb-6', 'vt-6', 'vf-6']) sim.launchAircraft(squadron);
let tick = 0, id = 0;
const events: unknown[] = [];
const ctx: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++id,
  emit: e => { if (['aircraft-launch', 'aircraft-recovered', 'aircraft-lost'].includes(e.kind)) events.push({ t: Math.round(tick / 60), kind: e.kind, id: e.aircraft?.id }); } };
const plane = sim.player.airWing!.planes[1];
let last = '', maxDeck = 0;
for (; tick < 750 * 60; tick++) {
  if (tick === 181 * 60) sim.recallAircraft();
  stepAircraft(ctx, 1 / 60, tick / 60);
  maxDeck = Math.max(maxDeck, sim.player.airWing!.planes.filter(onFlightDeck).length);
  const state = `${plane.phase}/${plane.pilot.recoveryStage}`;
  if (process.argv.includes('--trace') && (state !== last || tick % 1800 === 0)) console.log(JSON.stringify({ t: Math.round(tick / 60), state, p: plane.position.map(n => Math.round(n)), heading: +plane.heading.toFixed(2), bank: +plane.bank.toFixed(2) }));
  last = state;
}
console.log(JSON.stringify({ events, maxDeck, final: sim.player.airWing!.planes.filter(p => p.flightId).map(p => ({ id: p.id, phase: p.phase, reason: p.lossReason })) }, null, 2));
