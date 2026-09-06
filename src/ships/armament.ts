import type { Battery, ShipDefinition } from './blueprint';

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
