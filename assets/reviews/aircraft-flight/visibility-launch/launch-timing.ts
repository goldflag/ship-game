import { CombatSimulation } from '../../../../src/simulation/combat';
import { shipPreset } from '../../../../src/ships/presets';
import { airborne, onFlightDeck, stepAircraft, type AirContext } from '../../../../src/simulation/aircraft';
const sim = new CombatSimulation(shipPreset('enterprise-cv6'), { enemies: [shipPreset('enterprise-cv6')], friendlyBots: [], spawnDistance: 5000 });
sim.target.controller = 'idle';
let time = 0, id = 0;
const context: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], releases: [], torpedoes: [], nextId: () => ++id, emit: () => {} };
stepAircraft(context, 1 / 60, 0); sim.launchAircraft('vf-6');
const departures = new Map<string, number>(); let deckOccupancy = 0;
for (let tick = 0; tick < 40 * 60; tick++) {
  time = (tick + 1) / 60; stepAircraft(context, 1 / 60, time);
  deckOccupancy = Math.max(deckOccupancy, sim.player.airWing!.planes.filter(p => p.phase === 'taxi' || (p.phase === 'takeoff' && onFlightDeck(p))).length);
  for (const p of sim.player.airWing!.planes) if (airborne(p) && !onFlightDeck(p) && !departures.has(p.id)) departures.set(p.id, time);
}
console.log(JSON.stringify({ departures: Object.fromEntries(departures), maxOccupiedDeckRuns: deckOccupancy, pass: departures.size === 3 && Math.max(...departures.values()) < 37 && deckOccupancy === 1 }, null, 2));
