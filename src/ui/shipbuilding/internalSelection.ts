import type { ConstructionCatalog, ConstructionSource } from '../../ships/blueprint';

/** Built-in ammunition selects its owning weapon, never a separate magazine. */
export function internalSelectionIds(source: ConstructionSource, catalog: ConstructionCatalog): Set<string> {
  const parts = new Set(catalog.equipment.filter(part => part.placement === 'internal' || (source.construction.version === 2 && (part.kind === 'gun' || part.kind === 'torpedo-launcher'))).map(part => part.id));
  return new Set([
    ...source.construction.boundaries.map(wall => wall.id),
    ...source.construction.equipment.filter(item => parts.has(item.partId)).map(item => item.id),
  ]);
}
