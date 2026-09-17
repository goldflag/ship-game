import type { ConstructionCatalog, ConstructionEquipment, ConstructionSource } from './blueprint';

/** Upgrade in one ordinary history command; retained revisions keep their original format. */
export function integrateConstructionMagazines(source: ConstructionSource, catalog: ConstructionCatalog): void {
  if (source.construction.catalogRevision !== catalog.revision) throw new Error('Load this design’s equipment library before converting its ammunition.');
  const magazines = new Set(catalog.equipment.filter(p => p.kind === 'magazine').map(p => p.id));
  source.construction.equipment = source.construction.equipment.filter(e => !magazines.has(e.partId));
  for (const equipment of source.construction.equipment) delete equipment.magazineId;
  source.construction.version = 2;
}

/** Keep the deck attachment and lower magazine fixed while lifting the gunhouse. */
export function setBarbetteHeight(equipment: ConstructionEquipment, heightM: number): void {
  if (!Number.isFinite(heightM) || heightM < 0 || heightM > 30) throw new Error('Barbette height must be between 0 and 30 m.');
  const previous = equipment.gun?.barbetteHeightM ?? 0;
  equipment.position[1] += heightM - previous;
  equipment.gun = { ...equipment.gun, barbetteHeightM: heightM };
}
