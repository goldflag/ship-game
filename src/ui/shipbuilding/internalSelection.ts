import type { ConstructionCatalog, ConstructionSource } from '../../ships/blueprint';

/** Internal packages and room boundaries are the only editable objects in Internals. */
export function internalSelectionIds(source: ConstructionSource, catalog: ConstructionCatalog): Set<string> {
  const parts = new Set(catalog.equipment.filter(part => part.placement === 'internal').map(part => part.id));
  return new Set([
    ...source.construction.boundaries.map(wall => wall.id),
    ...source.construction.equipment.filter(item => parts.has(item.partId)).map(item => item.id),
  ]);
}
