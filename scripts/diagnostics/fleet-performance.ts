import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';

// Fixed workload: report tick cost, not FPS (which includes competing apps/GPU).
const perTeam = Number(process.argv[2] ?? 24);
const ticks = Number(process.argv[3] ?? 600);
const preset = process.argv[4] ?? 'bismarck';
if (!Number.isInteger(perTeam) || perTeam < 1 || perTeam > 30 || !Number.isInteger(ticks) || ticks < 1) throw new Error('Usage: bun scripts/diagnostics/fleet-performance.ts [1–30 ships/team] [ticks] [preset]');
const definition = shipPreset(preset);
const sim = new CombatSimulation(definition, { friendlyBots: Array(perTeam - 1).fill(definition), enemies: Array(perTeam).fill(definition) });
const helm = { throttle: .5, rudder: 0 };
const intent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };
const times: number[] = [];
for (let tick = 0; tick < ticks + 120; tick++) {
  const start = performance.now();
  sim.step(helm, intent);
  if (tick >= 120) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ ships: sim.actors.length, preset, ticks, tickMs: { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * .95)], mean: times.reduce((a, b) => a + b, 0) / times.length }, shells: sim.shells.length, stateHash: Bun.hash(JSON.stringify({ actors: sim.actors, shells: sim.shells, events: sim.events })).toString() }, null, 2));
