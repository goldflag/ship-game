import { readFileSync, writeFileSync } from 'node:fs';

/** Original calibration recipe, deliberately independent of historical fuze claims. */
const path = new URL('./guns.json', import.meta.url);
const catalog = JSON.parse(readFileSync(path, 'utf8'));
for (const gun of catalog.parts) {
  if (gun.caliberM < .1) { delete gun.ap; continue; }
  gun.ap = {
    armingResistanceMm: Number((gun.caliberM * 1000 / 6).toFixed(4)),
    fuzeDelaySeconds: gun.caliberM >= .2 ? .035 : .02,
    explosiveKg: Number((gun.projectileMassKg * .025).toFixed(4)),
    fragmentPenetrationMm: Number((gun.caliberM * 1000 * .08).toFixed(4)),
    basis: 'Provisional AP game calibration, not historical fuze/filler data. Arming requires caliber/6 equivalent resistance in one non-ricochet contact; delay 35 ms at >=200 mm, otherwise 20 ms; fill 2.5% of projectile mass; fragment budget 8% of caliber in mm. Smaller AA AP remains inert. See assets/parts/author-ap.ts; blast radius and damage are bounded approximations.',
  };
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
