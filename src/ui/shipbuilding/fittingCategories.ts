import { wallMount } from '../../ships/constructionWallFittings';
import { isCustomFittingPartId } from '../../ships/constructionCustomFittings';
import type { ConstructionCatalog, ConstructionEquipmentPart } from '../../ships/blueprint';

/** The three fitting tabs, their shelves and the nation filter. The published catalog carries none of these, so all
 * are read off the part here: the shelf from its kind, a gun's calibre, its route or wall mount and its id, the nation
 * from the id prefix every authored part uses. */
export type FittingGroup = 'machinery' | 'armament' | 'outfit';
export const FITTING_GROUPS: { id: FittingGroup; name: string }[] = [{ id: 'machinery', name: 'Machinery' }, { id: 'armament', name: 'Armament' }, { id: 'outfit', name: 'Outfit' }];
export type FittingCategory = 'running-gear' | 'funnels' | 'masts' | 'main-battery' | 'light-aa' | 'torpedoes' | 'fire-control' | 'mooring' | 'access' | 'fixtures' | 'boats-aviation' | 'doors-windows' | 'custom';
export const FITTING_CATEGORIES: { id: FittingCategory; group: FittingGroup; name: string; note: string }[] = [
  { id: 'running-gear', group: 'machinery', name: 'Running gear', note: 'screws and rudders' },
  { id: 'funnels', group: 'machinery', name: 'Funnels', note: 'uptakes and funnel caps' },
  { id: 'masts', group: 'machinery', name: 'Masts', note: 'pole, tripod, cage, lattice and tower masts' },
  { id: 'main-battery', group: 'armament', name: 'Main battery', note: 'guns of 100 mm and up' },
  { id: 'light-aa', group: 'armament', name: 'Light & AA', note: 'guns under 100 mm' },
  { id: 'torpedoes', group: 'armament', name: 'Torpedoes', note: 'deck launchers' },
  { id: 'fire-control', group: 'armament', name: 'Fire control', note: 'directors, rangefinders, searchlights' },
  { id: 'mooring', group: 'outfit', name: 'Mooring', note: 'bollards, bitts, fairleads, capstans, anchors, rope and chain' },
  { id: 'access', group: 'outfit', name: 'Access', note: 'railings, ladders, stairs and hatches' },
  { id: 'fixtures', group: 'outfit', name: 'Fixtures', note: 'vents, lockers, racks, life-saving gear, ensign staff' },
  { id: 'boats-aviation', group: 'outfit', name: 'Boats & aviation', note: 'boats, davits, catapults' },
  { id: 'doors-windows', group: 'outfit', name: 'Doors & windows', note: 'wall-mounted doors, portholes and windows' },
  { id: 'custom', group: 'outfit', name: 'Custom', note: 'this design’s own fittings, saved inside the design' },
];
export const fittingGroup = (category: FittingCategory): FittingGroup => FITTING_CATEGORIES.find(entry => entry.id === category)!.group;
/** Guns at or above this calibre are main battery; below it, light and anti-aircraft. */
export const MAIN_BATTERY_CALIBER_M = .1;

// Deck fittings share one kind; they are shelved by what their id says they are.
const FIRE_CONTROL_FITTING = /director|rangefinder|searchlight/, BOAT_FITTING = /boat|cutter|launch|pinnace|float|raft|catapult|crane|aircraft/,
  MOORING_FITTING = /bitts|bollard|fairlead|capstan|windlass|anchor|hawse|cable-reel|winch/, ACCESS_FITTING = /ladder|stairs|hatch/;

export function fittingCategory(part: ConstructionEquipmentPart, catalog: ConstructionCatalog): FittingCategory {
  if (isCustomFittingPartId(part.id)) return 'custom';
  const route = part.path?.kind;
  if (route === 'rope' || route === 'chain') return 'mooring';
  if (route || ACCESS_FITTING.test(part.id)) return 'access';
  if (wallMount(part) === 'vent' || wallMount(part) === 'hardware') return 'fixtures';
  if (wallMount(part)) return 'doors-windows';
  switch (part.kind) {
    // A gun whose calibre cannot be read is still a gun: it stays on the main battery shelf.
    case 'gun': return (catalog.weapons.parts.find(gun => gun.id === part.gunPartId)?.caliberM ?? MAIN_BATTERY_CALIBER_M) >= MAIN_BATTERY_CALIBER_M ? 'main-battery' : 'light-aa';
    case 'torpedo-launcher': return 'torpedoes';
    case 'director': return 'fire-control';
    case 'funnel': return 'funnels';
    case 'mast': return 'masts';
    case 'propeller': case 'rudder': return 'running-gear';
    default: return FIRE_CONTROL_FITTING.test(part.id) ? 'fire-control' : BOAT_FITTING.test(part.id) ? 'boats-aviation' : MOORING_FITTING.test(part.id) ? 'mooring' : 'fixtures';
  }
}

export type FittingNation =
  | 'United States' | 'Germany' | 'Japan' | 'United Kingdom'
  | 'France' | 'Italy' | 'Poland' | 'Russia' | 'Sweden' | 'Netherlands';
export const NATION_SHORT: Record<FittingNation, string> = {
  'United States': 'USA', Germany: 'Germany', Japan: 'Japan', 'United Kingdom': 'UK',
  France: 'France', Italy: 'Italy', Poland: 'Poland', Russia: 'Russia', Sweden: 'Sweden', Netherlands: 'Netherlands',
};
const NATION_PREFIXES: [RegExp, FittingNation][] = [
  [/^(us|fletcher|iowa|oerlikon|michigan|arizona|colorado|clemson)-/, 'United States'],
  [/^(german|scharnhorst|emden|sk-?c\d|flak)/, 'Germany'],
  [/^(ijn|mikasa|type\d)/, 'Japan'],
  [/^(rn|uk|british|qf|bl|lewis|dreadnought|hood|nelson)-/, 'United Kingdom'],
  [/^(le-fantasque|dunkerque)-/, 'France'],
  [/^(roma|aosta|cesare)-/, 'Italy'],
  [/^blyskawica-/, 'Poland'],
  [/^(gangut|kirov|aurora)-/, 'Russia'],
  [/^halland-/, 'Sweden'],
  [/^friesland-/, 'Netherlands'],
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
