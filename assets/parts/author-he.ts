import { readFileSync, writeFileSync } from 'node:fs';

/** Original HE calibration and stock split; not a historical ammunition table. */
const path = new URL('./guns.json', import.meta.url);
const catalog = JSON.parse(readFileSync(path, 'utf8'));
for (const gun of catalog.parts) {
  gun.he = {
    explosiveKg: Number((gun.projectileMassKg * .08).toFixed(6)),
    fragmentPenetrationMm: Number((gun.caliberM * 1000 / 6).toFixed(4)),
    damage: gun.damage * 2,
    stockFraction: .4,
    basis: 'Provisional HE game calibration, not historical shell/stock data. Contact burst; fill 8% of nominal projectile mass, fragment budget caliber/6 in mm, burst damage twice the AP catalog value. 40% HE stock rounded down per barrel. Shares the gun nominal launch mass/speed/drag envelope as an approximation. See assets/parts/author-he.ts.',
  };
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
