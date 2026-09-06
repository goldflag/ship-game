/** Original revision-1 game calibration. No historical crew-performance claims. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileShip, type ShipBlueprint } from '../../src/ships/blueprint';
const catalog = JSON.parse(await readFile(new URL('../parts/guns.json', import.meta.url), 'utf8'));
for (const id of ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6']) {
  const path = new URL(`./${id}/blueprint.json`, import.meta.url);
  const b = JSON.parse(await readFile(path, 'utf8')) as ShipBlueprint;
  b.damageControl = { version: 1, teams: 3, setupSeconds: 6, repairPoints: 180,
    roomFuelSeconds: 180, mountFuelSeconds: 90, suppressionPerSecond: .12,
    portablePumpM3PerSecond: .06, repairHpPerSecond: .4, repairCeiling: .6,
    patchM2PerSecond: .003, maxPatchM2: .25, flashProtection: .95,
    basis: 'Provisional game calibration shared across presets: three abstract teams, six-second setup, finite normalized fuel and spares. Repairs stop at 60% and cannot revive destroyed equipment. Small-hole shoring and portable pumps require accessible spaces. Flash-path attenuation is estimated; no individual crew, ventilation or electrical network.' };
  compileShip(b, catalog); await writeFile(path, JSON.stringify(b, null, 2) + '\n');
}
