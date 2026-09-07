/** Ordinary seeded combat: no injected damage, heat or changed crew/fuel profiles. */
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { localToWorld } from '../../src/simulation/geometry';
import { writeFileSync, mkdirSync } from 'node:fs';
const results = [];
for (const ammunition of ['ap', 'he'] as const) {
  const def = shipPreset('bismarck');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [shipPreset('baltimore')], spawnDistance: 3000, seed: 1941 });
  const burns = new Map<string, { location: string; first: number; seconds: number; peak: number; fuelUsed: number }>();
  const eventCounts: Record<string, number> = {}; let sequence = 0, maxSimultaneous = 0;
  for (let tick = 0; tick < 180 * 60; tick++) {
    const aim = localToWorld([0, 5, -30], sim.target.motion);
    sim.step({ throttle: .5, rudder: 0 }, { aim, fire: true, battery: 'main', ammunition });
    for (const event of sim.events) if (event.sequence > sequence) { eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1; sequence = event.sequence; }
    let active = 0;
    for (const actor of sim.actors) for (const [kind, fires] of [['rooms', actor.damage.control.rooms], ['mounts', actor.damage.control.mounts]] as const) {
      fires.forEach((fire, i) => {
        if (fire.intensity <= 0) return;
        active++;
        const source = kind === 'rooms' ? actor.definition.compartments[i] : actor.definition.mounts[i];
        const key = `${actor.motion.id}/${source.id}`;
        const record = burns.get(key) ?? { location: `${actor.definition.name}: ${source.name}`, first: tick / 60, seconds: 0, peak: 0, fuelUsed: 0 };
        record.seconds += 1 / 60; record.peak = Math.max(record.peak, fire.intensity); record.fuelUsed = fire.initialFuel - fire.fuel; burns.set(key, record);
      });
    }
    maxSimultaneous = Math.max(active, maxSimultaneous);
  }
  results.push({ ammunition, seed: sim.seed, seconds: 180, spawnDistance: 3000, definitions: sim.actors.map(a => ({ id: a.definition.id, hash: a.definition.contentHash })), eventCounts, maxSimultaneous, burns: [...burns.values()], result: sim.result });
}
mkdirSync('assets/reviews/localized-fire', { recursive: true });
writeFileSync('assets/reviews/localized-fire/combat.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
