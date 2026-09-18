import { wallMount } from '../../ships/constructionWallFittings';
import type { ConstructionCatalog, ConstructionEquipmentPart } from '../../ships/blueprint';

/** The Fittings tab's shelves and its nation filter. The published catalog carries neither, so both are read off
 * the part here: the shelf from its kind (and a gun's calibre), the nation from the id prefix every authored part uses. */
export type FittingCategory = 'main-battery' | 'light-aa' | 'torpedoes' | 'fire-control' | 'superstructure' | 'running-gear' | 'deck-gear' | 'boats-aviation' | 'doors-windows';
export const FITTING_CATEGORIES: { id: FittingCategory; name: string; note: string }[] = [
  { id: 'main-battery', name: 'Main battery', note: 'guns of 100 mm and up' },
  { id: 'light-aa', name: 'Light & AA', note: 'guns under 100 mm' },
  { id: 'torpedoes', name: 'Torpedoes', note: 'deck launchers' },
  { id: 'fire-control', name: 'Fire control', note: 'directors, rangefinders, searchlights' },
  { id: 'superstructure', name: 'Superstructure', note: 'funnels and masts' },
  { id: 'running-gear', name: 'Running gear', note: 'screws and rudders' },
  { id: 'doors-windows', name: 'Doors & windows', note: 'wall-mounted doors, portholes and windows' },
  { id: 'deck-gear', name: 'Deck gear', note: 'mooring, anchors, vents, hatches, railings' },
  { id: 'boats-aviation', name: 'Boats & aviation', note: 'boats, davits, catapults' },
];
/** Guns at or above this calibre are main battery; below it, light and anti-aircraft. */
export const MAIN_BATTERY_CALIBER_M = .1;

// Deck fittings share one kind; the ones that are not deck gear are named by what their id says they are.
const FIRE_CONTROL_FITTING = /director|rangefinder|searchlight/, BOAT_FITTING = /boat|cutter|launch|pinnace|float|raft|catapult|crane|aircraft/;

export function fittingCategory(part: ConstructionEquipmentPart, catalog: ConstructionCatalog): FittingCategory {
  if (wallMount(part) === 'vent' || part.path?.kind === 'ladder') return 'deck-gear';
  if (wallMount(part)) return 'doors-windows';
  switch (part.kind) {
    // A gun whose calibre cannot be read is still a gun: it stays on the first shelf.
    case 'gun': return (catalog.weapons.parts.find(gun => gun.id === part.gunPartId)?.caliberM ?? MAIN_BATTERY_CALIBER_M) >= MAIN_BATTERY_CALIBER_M ? 'main-battery' : 'light-aa';
    case 'torpedo-launcher': return 'torpedoes';
    case 'director': return 'fire-control';
    case 'funnel': case 'mast': return 'superstructure';
    case 'propeller': case 'rudder': return 'running-gear';
    default: return FIRE_CONTROL_FITTING.test(part.id) ? 'fire-control' : BOAT_FITTING.test(part.id) ? 'boats-aviation' : 'deck-gear';
  }
}

export type FittingNation = 'United States' | 'Germany' | 'Japan' | 'United Kingdom';
export const NATION_SHORT: Record<FittingNation, string> = { 'United States': 'USA', Germany: 'Germany', Japan: 'Japan', 'United Kingdom': 'UK' };
const NATION_PREFIXES: [RegExp, FittingNation][] = [
  [/^(us|fletcher|iowa|oerlikon)-/, 'United States'], [/^(german|sk-?c\d|flak)/, 'Germany'], [/^(ijn|type\d)/, 'Japan'], [/^(rn|uk|british|qf|bl|lewis)-/, 'United Kingdom'],
];
/** The navy a part was drawn from; undefined for generic parts, which every nation filter keeps. */
export const fittingNation = (part: ConstructionEquipmentPart): FittingNation | undefined => NATION_PREFIXES.find(([prefix]) => prefix.test(part.id))?.[1];

export interface FittingFilter { category: FittingCategory; nation: FittingNation | 'all' }
/** The nations with parts on a shelf, in a fixed order; the filter row shows only when there is a choice to make. */
export function shelfNations(parts: readonly ConstructionEquipmentPart[]): FittingNation[] {
  const present = new Set(parts.map(fittingNation));
  return (Object.keys(NATION_SHORT) as FittingNation[]).filter(nation => present.has(nation));
}
/** One shelf under the nation filter. A nation with nothing on this shelf filters nothing, so the choice can stay put across shelves. */
export function filterFittings(parts: readonly ConstructionEquipmentPart[], catalog: ConstructionCatalog, filter: FittingFilter): ConstructionEquipmentPart[] {
  const shelf = parts.filter(part => fittingCategory(part, catalog) === filter.category);
  const nation = filter.nation !== 'all' && shelfNations(shelf).includes(filter.nation) ? filter.nation : undefined;
  return nation ? shelf.filter(part => { const own = fittingNation(part); return !own || own === nation; }) : shelf;
}
