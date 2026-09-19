import type { ConstructionCatalog, ConstructionSource, GunPart, Vec3 } from '../../ships/blueprint';

/** Where a gunhouse plate faces, read off its geometry: catalog face ids follow no common naming. */
export type TurretRegion = 'face' | 'sides' | 'rear' | 'roof' | 'floor';
export const TURRET_REGIONS: readonly { id: TurretRegion; name: string }[] = [
  { id: 'face', name: 'Face' }, { id: 'sides', name: 'Sides' }, { id: 'rear', name: 'Rear' }, { id: 'roof', name: 'Roof' }, { id: 'floor', name: 'Floor' },
];
/** One gunhouse triangle in the mount's model frame (the same [-port, up, -forward] conversion the compiler uses). */
export interface TurretPlate { vertices: [Vec3, Vec3, Vec3]; thicknessMm: number; region: TurretRegion }
export interface TurretArmor {
  /** Catalog armor of the whole mount, used by hits on mounts without a plated gunhouse. */
  armorMm: number;
  /** Plated gunhouse facets; empty for open mounts, shields and casemates. */
  plates: TurretPlate[];
  /** The plate covering most of each region's area, face first. */
  regions: { id: TurretRegion; name: string; thicknessMm: number }[];
}

const cache = new WeakMap<GunPart, TurretArmor>();
const triangleArea = ([a, b, c]: [Vec3, Vec3, Vec3]) => {
  const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
  return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
};

/** Fixed catalog protection of a gun part: the builder shows it but cannot change it. */
export function turretArmor(part: GunPart): TurretArmor {
  let armor = cache.get(part);
  if (armor) return armor;
  const mesh = part.gunhouseMesh, plates: TurretPlate[] = [];
  if (mesh) {
    const convert = ([forward, port, up]: Vec3): Vec3 => [-port, up, -forward];
    const all = mesh.vertices.map(convert), middle = all.reduce<Vec3>((sum, v) => [sum[0] + v[0] / all.length, sum[1] + v[1] / all.length, sum[2] + v[2] / all.length], [0, 0, 0]);
    for (const face of mesh.faces) {
      const [a, b, c] = face.indices.map(index => all[index]) as [Vec3, Vec3, Vec3];
      const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
      let n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      // Winding is not guaranteed: orient each normal away from the enclosure's middle.
      const centroid = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3);
      if (n.reduce((sum, v, i) => sum + v * (centroid[i] - middle[i]), 0) < 0) n = n.map(v => -v) as Vec3;
      const length = Math.hypot(...n) || 1, [x, y, z] = n.map(v => v / length);
      const region: TurretRegion = face.finish === 'roof' || y > .7 ? 'roof' : y < -.7 ? 'floor'
        : -z > Math.SQRT1_2 * Math.hypot(x, z) ? 'face' : z > Math.SQRT1_2 * Math.hypot(x, z) ? 'rear' : 'sides';
      plates.push({ vertices: [a, b, c], thicknessMm: face.thicknessMm, region });
    }
  }
  // Sloped corners and gunport sills blur any region's edge, so a region reports the plate covering most of its area.
  const regions = TURRET_REGIONS.flatMap(({ id, name }) => {
    const areas = new Map<number, number>();
    for (const plate of plates) if (plate.region === id) areas.set(plate.thicknessMm, (areas.get(plate.thicknessMm) ?? 0) + triangleArea(plate.vertices));
    const main = [...areas].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    return main ? [{ id, name, thicknessMm: main[0] }] : [];
  });
  armor = { armorMm: part.armorMm, plates, regions };
  cache.set(part, armor);
  return armor;
}

export const gunPartOf = (catalog: ConstructionCatalog, partId: string): GunPart | undefined => {
  const gunPartId = catalog.equipment.find(part => part.id === partId)?.gunPartId;
  return gunPartId === undefined ? undefined : catalog.weapons.parts.find(part => part.id === gunPartId);
};

/** The ledger's reading: each region's main plate, or one figure when the gunhouse is plated alike all round. */
export function describeTurretArmor(armor: TurretArmor) {
  if (!armor.regions.length) return `Whole mount ${armor.armorMm.toLocaleString()} mm`;
  if (armor.regions.every(region => region.thicknessMm === armor.regions[0].thicknessMm)) return `${armor.regions[0].thicknessMm.toLocaleString()} mm all round`;
  return armor.regions.map(region => `${region.name} ${region.thicknessMm.toLocaleString()}`).join(' · ') + ' mm';
}

/** One ledger line per gun type installed on the ship, heaviest protection first. */
export function installedTurretArmor(source: ConstructionSource, catalog: ConstructionCatalog) {
  // Named as the fitting cards name them, not by the canonical weapon inside.
  const byPart = new Map<string, { part: GunPart; name: string; count: number; armor: TurretArmor }>();
  for (const item of source.construction.equipment) {
    const part = gunPartOf(catalog, item.partId);
    if (!part) continue;
    const entry = byPart.get(item.partId);
    if (entry) entry.count++; else byPart.set(item.partId, { part, name: catalog.equipment.find(entry => entry.id === item.partId)!.name, count: 1, armor: turretArmor(part) });
  }
  const heaviest = (entry: { armor: TurretArmor }) => Math.max(entry.armor.armorMm, ...entry.armor.plates.map(plate => plate.thicknessMm));
  return [...byPart.values()].sort((a, b) => heaviest(b) - heaviest(a) || a.name.localeCompare(b.name));
}

/** Every thickness the installed guns carry: they share the Armor layer's colour scale with the hull. */
export function installedTurretThicknesses(source: ConstructionSource, catalog: ConstructionCatalog): number[] {
  return installedTurretArmor(source, catalog).flatMap(({ armor }) => armor.plates.length ? armor.plates.map(plate => plate.thicknessMm) : [armor.armorMm]);
}
