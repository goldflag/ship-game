import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = process.argv[2], destination = process.argv[3];
const { CombatSimulation } = await import(pathToFileURL(resolve(root, 'src/simulation/combat.ts')).href);
const { shipPresets, shipPreset } = await import(pathToFileURL(resolve(root, 'src/ships/presets.ts')).href);
const roster = Object.keys(shipPresets), team = Array.from({ length: 30 }, (_, i) => shipPreset(roster[i % roster.length]));
const sim = new CombatSimulation(team[0], { friendlyBots: team.slice(1), enemies: team, spawnDistance: 5000, seed: 0x6e617661 });
const times: number[] = [], slowTicks: { tick: number; ms: number }[] = [];
const helm = { throttle: .5, rudder: 0 }, intent = { aim: [0, .5, -5000], fire: false, battery: 'main' };
for (let i = 0; i < 3720; i++) {
  const begin = performance.now(); sim.step(helm, intent);
  if (i >= 120) { const ms = performance.now() - begin; times.push(ms); slowTicks.push({ tick: sim.tick, ms }); }
}
times.sort((a, b) => a - b);
const state = JSON.stringify({ actors: sim.actors, shells: sim.shells, torpedoes: sim.torpedoes,
  depthCharges: sim.depthCharges, aircraft: sim.aircraft, airReleases: sim.airReleases, events: sim.events });
const sourceHashes = {};
for (const file of ['hydrostatics', 'ballistics', 'combat', 'stability']) sourceHashes[file] = createHash('sha256').update(new Uint8Array(await Bun.file(resolve(root, `src/simulation/${file}.ts`)).arrayBuffer())).digest('hex');
const result = { capturedAt: new Date().toISOString(), platform: process.platform, bun: Bun.version, root, sourceHashes,
  ships: sim.actors.length, roster, warmupTicks: 120, ticks: times.length, seconds: sim.tick / 60,
  tickMs: { mean: times.reduce((sum, value) => sum + value, 0) / times.length,
    median: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], p99: times[Math.floor(times.length * .99)], max: times.at(-1) },
  overBudget: { over16Ms: times.filter(ms => ms > 1000 / 60).length, over33Ms: times.filter(ms => ms > 1000 / 30).length, over50Ms: times.filter(ms => ms > 50).length },
  slowTicks: slowTicks.sort((a, b) => b.ms - a.ms).slice(0, 30),
  stateHash: createHash('sha256').update(state).digest('hex'), aircraft: sim.aircraft.filter(p => !['ready', 'lost'].includes(p.phase)).length };
await Bun.write(destination, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
