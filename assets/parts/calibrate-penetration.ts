import { readFileSync, writeFileSync } from 'node:fs';
import { ballisticStep } from '../../src/simulation/ballistics';
import { solveBallistic } from '../../src/simulation/weapons';
import { length, scale } from '../../src/simulation/geometry';

/** Original game-calibration recipe. Retain the previous range-independent
 * budgets at a stated reference condition; this does not assert historical
 * penetration performance. Small AA guns cannot reach the naval 5 km condition. */
const path = new URL('./guns.json', import.meta.url);
const catalog = JSON.parse(readFileSync(path, 'utf8'));
for (const gun of catalog.parts) {
  const range = gun.caliberM >= .1 ? 5000 : 1000;
  const drag = gun.ballistics.dragPerSecond;
  const arc = solveBallistic([0, 10, 0], [range, 0, 0], gun.muzzleSpeed, drag);
  if (!arc) throw new Error(`${gun.id} cannot reach its ${range} m calibration condition`);
  const referenceSpeed = length(ballisticStep([0, 10, 0], scale(arc.direction, gun.muzzleSpeed), arc.time, drag).velocity);
  gun.ballistics.penetrationReferenceSpeedMps = Number(referenceSpeed.toFixed(6));
  gun.ballistics.basis = 'Provisional game calibration, not historical firing data. Linear k=0.5*1.225*0.25*area*muzzleSpeed/mass; no Mach curve. Angular/speed sigmas are estimated, capped at 3 sigma; no salvo correlation or rangefinder error. ' +
    `Legacy penetrationMm retained at ${range} m, 10 m launch/sea target, nominal speed (${referenceSpeed.toFixed(3)} m/s); see assets/parts/calibrate-penetration.ts. Residual budget follows speed^1.4, including descent recovery; armor resistance paid separately.`;
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
