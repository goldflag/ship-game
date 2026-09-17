import type { ConstructionSurface } from '../../ships/blueprint';
import { surfaceSelectionKey } from '../../ships/constructionEditor';
import { CONSTRUCTION_PAINTS } from '../../ships/constructionPaints';

/** Display totals use the compiler's exposed patch areas, never primitive box estimates. */
export function armorInspectionGroups(surfaces: readonly ConstructionSurface[]) {
  const groups = new Map<string, { surface: Pick<ConstructionSurface, 'open' | 'thicknessMm' | 'material' | 'paint'>; areaM2: number; faces: Set<string> }>();
  for (const surface of surfaces) {
    const key = JSON.stringify([surface.open, surface.thicknessMm, surface.material, surface.paint]);
    let group = groups.get(key);
    if (!group) { group = { surface: { open: surface.open, thicknessMm: surface.thicknessMm, material: surface.material, paint: surface.paint }, areaM2: 0, faces: new Set() }; groups.set(key, group); }
    group.areaM2 += surface.areaM2;
    group.faces.add(surfaceSelectionKey(surface));
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
}

export function describeArmorGroup(surface: Pick<ConstructionSurface, 'open' | 'thicknessMm' | 'material' | 'paint'>) {
  return surface.open ? 'Open to sea' : `${surface.thicknessMm.toLocaleString()} mm · ${surface.material === 'armor-steel' ? 'Armor steel' : 'Structural steel'}`;
}
export const paintName = (id: string) => CONSTRUCTION_PAINTS.find(paint => paint.id === id)?.name ?? id;

/** Coverage lines for the ledger: one per distinct protection and paint. */
export function ArmorInspection({ surfaces, label }: { surfaces: readonly ConstructionSurface[]; label: string }) {
  return <div aria-label={label} className="sb-armor-groups">
    {armorInspectionGroups(surfaces).map(({ id, surface, areaM2, faces }) => <p key={id}>
      {describeArmorGroup(surface)}
      <small>{areaM2.toLocaleString(undefined, { maximumFractionDigits: 2 })} m² · {faces.size} {faces.size === 1 ? 'surface' : 'surfaces'} · {paintName(surface.paint)}</small>
    </p>)}
    {!surfaces.length && <p><small>No exposed faces in the current compiled selection.</small></p>}
  </div>;
}
