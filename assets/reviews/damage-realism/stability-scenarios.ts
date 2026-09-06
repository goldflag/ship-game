/** Reproducible game-model evidence, not historical stability data.
 * Run: bun assets/reviews/damage-realism/stability-scenarios.ts */
import { compileShip } from '../../../src/ships/blueprint';
import { flotation, hydrostatics, rightingArms } from '../../../src/simulation/hydrostatics';
import { CombatSimulation } from '../../../src/simulation/combat';
const catalog = await Bun.file('assets/parts/guns.json').json();
const definitions = await Promise.all(['bismarck', 'yamato', 'baltimore', 'enterprise-cv6'].map(async id => compileShip(await Bun.file(`assets/ships/${id}/blueprint.json`).json(), catalog)));
const curves = definitions.map(def => ({ shipId: def.id, calibration: def.stability,
  samples: Array.from({ length: 29 }, (_, i) => {
    const degrees = i * 5, angle = degrees * Math.PI / 180, f = flotation(def.hull, hydrostatics(def.hull).volume, angle);
    return { degrees, rightingArmM: -rightingArms(f.center, def.stability!.dryCenterOfGravity, angle, 0).roll, draftOffsetM: -f.y };
  }) }));
const [b, y, c, e] = definitions;
const sim = new CombatSimulation(b, { friendlyBots: [y, c, e, b], enemies: [b, y, c, e, b] }, 0x6e617661);
const intent = { battery: 'main' as const, fire: false, aim: sim.aimAt() }, times: number[] = [];
for (let i = 0; i < 4200; i++) {
  const start = performance.now(); sim.step({ throttle: 0, rudder: 0 }, intent);
  if (i >= 600) times.push(performance.now() - start);
}
times.sort((a,b)=>a-b);
const report = { fixture: 'Seeded 5v5 mixed fleet; 10 seconds warmup, 60 measured seconds; CPU only, excluding rendering. Host timing is observational.', curves,
  timing: { meanMs: times.reduce((n,t)=>n+t,0)/times.length, p95Ms: times[Math.floor(times.length*.95)], p99Ms: times[Math.floor(times.length*.99)], worstMs: times.at(-1) },
  fleet: sim.actors.map(a => ({ shipId:a.definition.id, team:a.team, status:a.damage.stability.status, waterM3:a.damage.compartments.reduce((n,c)=>n+c.waterM3,0), equipment:a.damage.integrity/1000, ammo:a.mounts.reduce((n,m)=>n+m.ammo,0) })) };
await Bun.write('assets/reviews/damage-realism/browser/step5-scenarios.json', JSON.stringify(report,null,2)+'\n');
console.log(report.timing);
