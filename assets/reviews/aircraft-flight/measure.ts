import { CombatSimulation } from '../../../src/simulation/combat';
import { shipPreset } from '../../../src/ships/presets';
import { stepAircraft, type AirContext } from '../../../src/simulation/aircraft';
import { worldToLocal } from '../../../src/simulation/geometry';
const sim = new CombatSimulation(shipPreset('enterprise-cv6'), { enemies: [shipPreset('enterprise-cv6')], friendlyBots: [], spawnDistance: 5000 });
sim.target.controller = 'idle';
const squadron = process.argv[2] ?? 'vb-6';
sim.launchAircraft(squadron);
let tick = 0, id = 1000;
const events: unknown[] = [];
const ctx: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: sim.shells, torpedoes: sim.torpedoes, releases: sim.airReleases, nextId: () => ++id, emit: e => { events.push(e); console.log('event', Math.round(tick / 60), e.kind, e.aircraft?.id); } };
const plane = sim.player.airWing!.planes.find(p => p.squadronId === squadron)!;
for (; tick < 600 * 60; tick++) {
  stepAircraft(ctx, 1 / 60, tick / 60);
  if (squadron === 'vf-6' && tick === 65 * 60) sim.recallAircraft();
  if (tick % (15 * 60) === 0 || (process.env.DETAIL && plane.phase === 'landing' && plane.position[2] < 250 && tick % 30 === 0)) console.log(JSON.stringify({ t: tick / 60, phase: plane.phase, stage: plane.pilot.attackStage, recovery: plane.pilot.recoveryStage, pos: worldToLocal(plane.position, sim.ship).map(v => +v.toFixed(1)), heading: +plane.heading.toFixed(2), pitch: +plane.pitch.toFixed(2), bank: +plane.bank.toFixed(2), hp: +plane.hp.toFixed(0), payload: plane.payload }));
}
console.log('final', sim.player.airWing!.planes.filter(p => p.squadronId === squadron).map(p => ({ id: p.id, phase: p.phase, hp: p.hp })));
