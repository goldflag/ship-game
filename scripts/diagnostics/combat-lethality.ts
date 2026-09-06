/** CPU-only balance probe. Run: bun scripts/diagnostics/combat-lethality.ts 12345 42 2026
 * JSONL on stdout; normal dispersion, armor, crews and flooding. The stationary
 * broadside target does not return fire. This measures aim-specific lethality,
 * not the duration of a moving fleet battle or historical survivability. */
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { equipmentCondition, systemHealth } from '../../src/simulation/machinery';
import { equipmentIntegrity } from '../../src/simulation/durability';

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [12345];
if (seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) throw new Error('Supply unsigned 32-bit seeds.');
const cases = [
  { target: 'bismarck', aim: 'waterline' },
  { target: 'baltimore', aim: 'waterline' },
  { target: 'bismarck', aim: 'turrets' },
  { target: 'baltimore', aim: 'turrets' },
  { target: 'yamato', aim: 'turrets' },
];
for (const seed of seeds) for (const config of cases) {
  const def = structuredClone(shipPreset('bismarck')), target = structuredClone(shipPreset(config.target));
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [target], spawnDistance: 5000 }, seed);
  sim.target.controller = 'idle';
  Object.assign(sim.player.motion, { x: 0, z: 0, heading: 0 });
  Object.assign(sim.target.motion, { x: 5000, z: 0, heading: 0 });
  let sequence = 0, fired = 0, rawEquipmentDamage = 0, seconds = 0;
  const hits = new Set<number>(), penetrating = new Set<number>(), damaging = new Set<number>();
  const stops: Record<string, number> = {}, checkpoints: unknown[] = [];
  for (let tick = 0; tick < 300 * 60; tick++) {
    const victimMount = config.aim === 'turrets' ? target.mounts.find((m, i) => sim.target.mounts[i].hp > 0 && (!m.magazineId || equipmentCondition(sim.target, target, target.modules.find(x => x.id === m.magazineId)!).availability > 0)) : undefined;
    const aim = sim.aimAt(victimMount ? `mount:${victimMount.id}` : undefined);
    sim.step({ throttle: 0, rudder: 0 }, { aim, fire: true, battery: 'main', ammunition: 'ap' });
    for (const e of sim.events) {
      if (e.sequence <= sequence) continue;
      sequence = e.sequence;
      if (e.kind === 'shot' && e.shipId === 'player') fired++;
      if (e.shipId !== sim.target.motion.id || !e.shell) continue;
      if (e.impact && e.impact.kind !== 'burst') hits.add(e.shell.id);
      if (e.kind === 'penetration') penetrating.add(e.shell.id);
      if ((e.impact?.damage ?? 0) > 0) { damaging.add(e.shell.id); rawEquipmentDamage += e.impact!.damage!; }
      if (e.kind === 'stopped' || e.kind === 'ricochet') stops[e.impact?.targetName ?? e.kind] = (stops[e.impact?.targetName ?? e.kind] ?? 0) + 1;
    }
    seconds = (tick + 1) / 60;
    if ((tick + 1) % 3600 === 0) checkpoints.push({ seconds, fired, hits: hits.size, hull: sim.target.damage.integrity / sim.target.damage.maxIntegrity, equipment: equipmentIntegrity(sim.target, target), water: sim.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0), power: systemHealth(sim.target, target, 'engine') });
    if (sim.target.damage.sunk || sim.target.damage.stability.combatLost) break;
  }
  console.log(JSON.stringify({ attacker: 'bismarck', ...config, rangeM: 5000, seed, seconds, fired, hits: hits.size, penetratingShells: penetrating.size, damagingShells: damaging.size, rawEquipmentDamage,
    hullPercent: sim.target.damage.integrity / sim.target.damage.maxIntegrity * 100, equipmentPercent: equipmentIntegrity(sim.target, target) * 100,
    damagePoints: sim.telemetry('main', [0, 0, 0]).playerDamageDealt, defeatCause: sim.target.damage.defeatCause,
    waterM3: sim.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0), power: systemHealth(sim.target, target, 'engine'), status: sim.target.damage.stability.status,
    combatLost: sim.target.damage.stability.combatLost, sunk: sim.target.damage.sunk, mounts: sim.target.mounts.map(m => ({ id: m.id, hp: m.hp })), stops, checkpoints }));
}
