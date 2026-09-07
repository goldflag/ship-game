import type { Battery, GunPart, ShipDefinition } from './blueprint';

/** Gameplay envelope for registered high-angle mounts, including 5.25-inch DP guns. */
export const ANTI_AIRCRAFT_MAX_CALIBER_M = .14;
export function antiAircraftRange(mount: ShipDefinition['mounts'][number]): number {
  const gun = mount.weapon;
  if (gun.elevationMaxDeg < 70 || gun.caliberM > ANTI_AIRCRAFT_MAX_CALIBER_M) return 0;
  return gun.caliberM > .08 ? 3200 : gun.caliberM > .025 ? 1800 : 1200;
}

export const batteryName = (battery: Battery) => ({ main: 'Main battery', secondary: 'Secondary battery', torpedo: 'Torpedo tubes', 'depth-charge': 'Depth charges' })[battery];
export const ammunitionName = (battery: Battery) => battery === 'depth-charge' ? 'charges' : battery === 'torpedo' ? 'torpedoes' : 'shells';
export function torpedoArcLabel(def: ShipDefinition): string {
  const launcher = def.torpedoLaunchers?.[0];
  if (launcher) {
    const [a, b] = launcher.launchArcsDeg;
    if (a && b && a[0] === -b[1] && a[1] === -b[0]) return `Each broadside ${b[0]}–${b[1]}°`;
    return launcher.launchArcsDeg.map(([a, b]) => `${a}° to ${b}°`).join(' / ');
  }
  const bearings = [...new Set((def.torpedoTubes ?? []).map(t => t.bearingDeg === 0 ? 'Bow' : Math.abs(t.bearingDeg) === 180 ? 'stern' : `${t.bearingDeg}°`))];
  return `${bearings.join(' / ')} ±${def.torpedoTubes?.[0].arcDeg ?? 0}°`;
}

/** Light guns remain automatic-only when a larger gun is fitted. Fitting, not
 * damage or ammunition, determines eligibility so weapon slots stay stable. */
export function surfaceGunAllowed(definition: ShipDefinition, gun: GunPart): boolean {
  return gun.caliberM > .08 || !definition.mounts.some(m => m.weapon.caliberM > .08);
}
