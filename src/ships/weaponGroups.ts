import { surfaceGunAllowed } from './armament';
import type { Battery, ShipDefinition, GunPart, TorpedoPart, DepthChargePart } from './blueprint';

export interface WeaponGroup {
  id: string;
  battery: Battery;
  weaponId: string;
  name: string;
  caliberMm: number;
  mountIds: string[];
}

type Weapon = GunPart | TorpedoPart | DepthChargePart;

/** Mount geometry and barrel count do not make a new firing group: e.g. twin
 * and quadruple mounts firing the same shells share a key. Different firing
 * characteristics, ammunition or aiming envelopes remain separate.
 */
export function weaponGroupId(battery: Battery, weapon: Weapon): string {
  if (weapon.kind !== 'gun') return `${battery}:${weapon.id}`;
  const w = weapon, b = w.ballistics, ap = w.ap, he = w.he;
  return `${battery}:gun:${JSON.stringify([
    w.caliberM, w.reloadSeconds, w.muzzleSpeed, w.projectileMassKg, w.penetrationMm, w.damage,
    w.traverseRateDeg, w.elevationMinDeg, w.elevationMaxDeg, w.elevationRateDeg,
    b?.dragPerSecond ?? 0, b?.dispersionRad ?? 0, b?.muzzleSpeedSigmaFraction ?? 0,
    b?.penetrationReferenceSpeedMps ?? w.muzzleSpeed,
    ap ? [ap.armingResistanceMm, ap.fuzeDelaySeconds, ap.explosiveKg, ap.fragmentPenetrationMm] : null,
    he ? [he.explosiveKg, he.fragmentPenetrationMm, he.damage] : null,
  ])}`;
}

/** Derived from fitted components, never equipment health or remaining ammunition.
 * Caliber alone never determines membership.
 */
export function weaponGroups(definition: ShipDefinition): WeaponGroup[] {
  const groups = new Map<string, WeaponGroup>();
  const add = (battery: Battery, weapon: Weapon, caliberMm: number, mountId: string) => {
    const id = weaponGroupId(battery, weapon);
    let group = groups.get(id);
    if (!group) {
      group = { id, battery, weaponId: weapon.id, name: weapon.name, caliberMm, mountIds: [] };
      groups.set(id, group);
    }
    if (group.weaponId !== weapon.id) group.name = `${Number(caliberMm.toFixed(2))} mm ${battery} battery`;
    group.mountIds.push(mountId);
  };
  for (const m of definition.mounts) if (surfaceGunAllowed(definition, m.weapon)) add(m.battery, m.weapon, m.weapon.caliberM * 1000, m.id);
  for (const t of definition.torpedoTubes ?? []) add('torpedo', t.weapon, t.weapon.diameterM * 1000, t.id);
  for (const l of definition.depthChargeLaunchers ?? []) add('depth-charge', l.weapon, 0, l.id);
  const order: Record<Battery, number> = { main: 0, secondary: 1, torpedo: 2, 'depth-charge': 3 };
  return [...groups.values()].sort((a, b) => order[a.battery] - order[b.battery] || b.caliberMm - a.caliberMm || a.id.localeCompare(b.id, 'en'));
}

/** An omitted group retains the aggregate battery API for simulation hosts. */
export function selectedWeapon(battery: Battery, weapon: Weapon, selectedBattery: Battery, groupId?: string): boolean {
  return battery === selectedBattery && (groupId === undefined || groupId === weaponGroupId(battery, weapon));
}
