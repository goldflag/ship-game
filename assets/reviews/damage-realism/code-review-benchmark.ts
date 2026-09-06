/** CPU-only timing, excluding rendering. Prints evidence without overwriting
 * accepted milestone reports. Run: bun assets/reviews/damage-realism/code-review-benchmark.ts */
import { compileShip } from '../../../src/ships/blueprint';
import { CombatSimulation } from '../../../src/simulation/combat';

const catalog = await Bun.file('assets/parts/guns.json').json();
const [b, y, c, e] = await Promise.all(['bismarck', 'yamato', 'baltimore', 'enterprise-cv6'].map(async id =>
  compileShip(await Bun.file(`assets/ships/${id}/blueprint.json`).json(), catalog)));
const sim = new CombatSimulation(b, { friendlyBots: [y, c, e, b], enemies: [b, y, c, e, b] }, 0x6e617661);
const intent = { battery: 'main' as const, fire: false, aim: sim.aimAt() };
const times: number[] = [];
for (let i = 0; i < 4200; i++) {
  const start = performance.now();
  sim.step({ throttle: 0, rudder: 0 }, intent);
  if (i >= 600) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({
  fixture: 'Seeded mixed 5v5 fleet; 10 seconds warmup, 60 seconds measured at 60 Hz. Host timing is observational.',
  timing: {
    meanMs: times.reduce((n, t) => n + t, 0) / times.length,
    p95Ms: times[Math.floor(times.length * .95)],
    p99Ms: times[Math.floor(times.length * .99)],
    worstMs: times.at(-1),
  },
  fleet: sim.actors.map(a => ({ shipId: a.definition.id, status: a.damage.stability.status,
    waterM3: a.damage.compartments.reduce((n, c) => n + c.waterM3, 0) })),
}, null, 2));
