import { mixedSimulation, reviewHelm, reviewIntent } from './mixed-fleet';

const perTeam = Number(process.argv[2] ?? 10), ticks = Number(process.argv[3] ?? 7200);
if (!Number.isSafeInteger(ticks) || ticks < 1) throw new Error('ticks must be a positive integer');
const sim = mixedSimulation(perTeam);
const times: number[] = [], events: Record<string, number> = {};
let sequence = 0;
for (let tick = 0; tick < ticks + 120; tick++) {
  const start = performance.now();
  sim.step(reviewHelm, reviewIntent);
  if (tick >= 120) times.push(performance.now() - start);
  for (const event of sim.events) if (event.sequence > sequence) events[event.kind] = (events[event.kind] ?? 0) + 1;
  sequence = sim.events.at(-1)?.sequence ?? sequence;
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ ships: sim.actors.length, ticks, seconds: sim.tick / 60,
  tickMs: { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * .95)], p99: times[Math.floor(times.length * .99)], mean: times.reduce((a, b) => a + b, 0) / times.length },
  events, shells: sim.shells.length, aircraft: sim.aircraft.filter(p => p.phase !== 'ready' && p.phase !== 'lost').length,
  actors: sim.actors.map(a => ({ id: a.motion.id, type: a.definition.id, team: a.team, hp: a.damage.integrity, water: a.damage.compartments.reduce((n, c) => n + c.waterM3, 0), status: a.damage.stability.status })),
  stateHash: Bun.hash(JSON.stringify({ actors: sim.actors, shells: sim.shells, events: sim.events })).toString(),
}, null, 2));
