/** Repair missing/placeholder flight profiles using the fleet's existing linear
 * drag approximation. These are game estimates, not historical range tables. */
import { readFileSync, writeFileSync } from 'node:fs';
import { ballisticStep } from '../../src/simulation/ballistics';
import { solveBallistic } from '../../src/simulation/weapons';
import { length, scale } from '../../src/simulation/geometry';
const path = new URL('./guns.json', import.meta.url);
const catalog = JSON.parse(readFileSync(path, 'utf8'));
for (const gun of catalog.parts) {
  if (gun.ballistics && !gun.id.match(/^flak-(105|37|20)-bismarck/) && !['type89-127-yamato-twin', 'us-40mm-bofors-baltimore-quad'].includes(gun.id)) continue;
  const area = Math.PI * (gun.caliberM / 2) ** 2;
  const drag = Number((.5 * 1.225 * .25 * area * gun.muzzleSpeed / gun.projectileMassKg).toFixed(5));
  const range = gun.caliberM >= .1 ? 5000 : 1000;
  const arc = solveBallistic([0, 10, 0], [range, 0, 0], gun.muzzleSpeed, drag);
  if (!arc) throw new Error(`${gun.id}: unreachable calibration range`);
  gun.ballistics = { dragPerSecond: drag, dispersionRad: gun.caliberM < .05 ? .002 : .0012,
    muzzleSpeedSigmaFraction: gun.caliberM < .05 ? .005 : .003,
    penetrationReferenceSpeedMps: Number(length(ballisticStep([0, 10, 0], scale(arc.direction, gun.muzzleSpeed), arc.time, drag).velocity).toFixed(6)),
    basis: `Estimated linear drag from projectile mass, bore area, muzzle speed, air density 1.225 kg/m3 and Cd 0.25; penetration budget referenced at ${range} m. Shared game approximation; no historical firing-table or Mach-curve claim. See assets/parts/author-plausible-ballistics.ts.` };
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
