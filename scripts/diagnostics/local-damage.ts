import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { compileShip, type Vec3 } from '../../src/ships/blueprint';
import { CombatSimulation } from '../../src/simulation/combat';
import { damageShellHull } from '../../src/simulation/durability';
import { localDamageEvidence } from '../../src/simulation/localDamage';
import { addBreach, type Shell } from '../../src/simulation/damage';
import { heatMount, updateDamageControl } from '../../src/simulation/damageControl';
const catalog = JSON.parse(await readFile('assets/parts/guns.json', 'utf8'));
const def = compileShip(JSON.parse(await readFile('assets/ships/bismarck/blueprint.json', 'utf8')), catalog);
function hits(spread: boolean) {
  const actor = new CombatSimulation(def).player, losses: number[] = [];
  for (let i = 0; i < 16; i++) {
    const point: Vec3 = spread ? [i < 8 ? -17 : 17, 1, -110 + (i % 8) * 30] : [-17, 1, -21];
    const shell: Shell = { id: i, ownerId: 'target', position: point, velocity: [820, 0, 0], age: 0, damage: 70, caliberM: .38, penetrationMm: 550, visited: [] };
    losses.push(damageShellHull(shell, actor, 45.5, localDamageEvidence(actor, def, point)));
  }
  return { losses, total: losses.reduce((n, d) => n + d, 0), remainingHullHp: actor.damage.integrity };
}
const actor = new CombatSimulation(def).player, room = actor.damage.compartments[0];
const openings = [addBreach(room, [-17, -2, 0], .1, 1), addBreach(room, [-17, -2, 0], .1, 2), addBreach(room, [-17, -2, 0], .2, 3)];
heatMount(actor, 0, 100); actor.damage.control.teams = [];
for (let i = 0; i < 120 * 60; i++) updateDamageControl(actor, def, 1 / 60, () => {});
const result = { fixture: 'Isolated hull-consequence calibration, not a ballistic duel or historical survivability measurement',
  focused: hits(false), spread: hits(true), breachAddedM2: openings,
  unattendedMountFire: { remainingEquipmentHp: actor.mounts[0].hp, remainingFuel: actor.damage.control.mounts[0].fuel, intensity: actor.damage.control.mounts[0].intensity } };
await mkdir('assets/reviews/local-damage', { recursive: true });
await writeFile('assets/reviews/local-damage/calibration.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
