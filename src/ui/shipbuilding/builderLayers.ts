import { EDITABLE_SHAPES } from '../../ships/constructionMesh';
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_PAINTS } from '../../ships/constructionPaints';
import { CONSTRUCTION_SHAPE_NAMES } from '../../ships/constructionShapes';
import { filterFittings, type FittingFilter } from './fittingCategories';

/** Layer tabs, tool rails and hotbar palettes of the "Slipway rails" editor.
 * Pure data: the component maps these onto source commands. */
export type BuilderLayer = 'hull' | 'armor' | 'internals' | 'fittings' | 'paint';
export const BUILDER_LAYERS: { id: BuilderLayer; name: string }[] = [
  { id: 'hull', name: 'Hull' }, { id: 'armor', name: 'Armor' }, { id: 'internals', name: 'Internals' }, { id: 'fittings', name: 'Fittings' }, { id: 'paint', name: 'Paint' },
];

export type BuilderToolId = 'select' | 'place' | 'fill' | 'erase' | 'measure' | 'apply' | 'area' | 'eyedrop' | 'opening' | 'deck' | 'bulkhead' | 'longitudinal' | 'merge' | 'module';
export type BuilderAction = 'rotate' | 'suggest';
export type RailEntry =
  | { kind: 'tool'; id: BuilderToolId; name: string; key: string; glyph: string }
  | { kind: 'action'; id: BuilderAction; name: string; key: string; glyph: string };

const tool = (id: BuilderToolId, name: string, key: string, glyph = name): RailEntry => ({ kind: 'tool', id, name, key, glyph });
const action = (id: BuilderAction, name: string, key: string, glyph = name): RailEntry => ({ kind: 'action', id, name, key, glyph });
const select = tool('select', 'Select', 'V');

/** The rail holds what a click does: modes and one-shot actions. Mirror and Snap, which change where a click lands, sit under the rail as modifiers; Arcs and Centers, which draw overlays, sit in the view strip. */
export const BUILDER_RAIL: Record<BuilderLayer, RailEntry[]> = {
  hull: [select, tool('place', 'Place', 'B'), tool('fill', 'Fill', 'F'), tool('erase', 'Erase', 'E'), tool('measure', 'Measure', 'T')],
  armor: [select, tool('apply', 'Paint', 'B', 'Paint'), tool('area', 'Area', 'A'), tool('eyedrop', 'Eyedrop', 'I'), tool('opening', 'Opening', 'O')],
  internals: [select, tool('deck', 'Deck', 'D'), tool('bulkhead', 'Bulkhead', 'B'), tool('longitudinal', 'Split', 'L', 'Split'), tool('merge', 'Merge', 'J'), tool('module', 'Module', 'U'), action('suggest', 'Suggest', 'G')],
  fittings: [select, tool('place', 'Place', 'B'), action('rotate', 'Rotate', 'R'), action('suggest', 'Suggest', 'G')],
  paint: [select, tool('apply', 'Paint', 'B', 'Paint'), tool('area', 'Area', 'A'), tool('eyedrop', 'Eyedrop', 'I')],
};
/** The tool a layer starts with; Select is always one key away. */
export const DEFAULT_TOOL: Record<BuilderLayer, BuilderToolId> = { hull: 'select', armor: 'apply', internals: 'module', fittings: 'place', paint: 'apply' };

export interface HullShape { id: string; name: string; note: string; kind: ConstructionPrimitive['kind']; size: Vec3 }
/** Width × height × length in metres, on the 1 m hull grid. Quarter plates are the thinnest useful skin.
 * The first nine fill the keyed bar; freeform hull and balcony lead the palette. */
export const HULL_SHAPES: HullShape[] = [
  { id: 'vertex', name: 'Freeform hull', note: 'vertices, edges and faces · 4 m', kind: 'vertex', size: [4, 4, 4] },
  { id: 'balcony', name: 'Balcony', note: '2 × 1 m platform · editable outline and walls', kind: 'balcony', size: [2, .08, 1] },
  { id: 'cube', name: 'Cube', note: '1 m', kind: 'box', size: [1, 1, 1] },
  { id: 'slab', name: 'Slab', note: '4 × 1 × 4', kind: 'box', size: [4, 1, 4] },
  { id: 'bar', name: 'Bar', note: '1 × 1 × 4', kind: 'box', size: [1, 1, 4] },
  { id: 'wedge', name: 'Wedge', note: '1 : 1', kind: 'wedge', size: [4, 4, 4] },
  { id: 'slope', name: 'Slope', note: '1 : 2', kind: 'wedge', size: [4, 2, 4] },
  { id: 'long-slope', name: 'Long slope', note: '1 : 4', kind: 'wedge', size: [4, 1, 4] },
  { id: 'corner-out', name: 'Corner out', note: '4 m', kind: 'corner', size: [4, 4, 4] },
  { id: 'corner-in', name: 'Corner in', note: '4 m', kind: 'inverse-corner', size: [4, 4, 4] },
  { id: 'custom-hull', name: 'Custom hull', note: 'whole hull · editable cross-sections', kind: 'custom-hull', size: [6.5, 4, 36] },
  { id: 'plate', name: 'Plate', note: '4 × ¼ × 4', kind: 'box', size: [4, .25, 4] },
  { id: 'block', name: 'Block', note: '4 m', kind: 'box', size: [4, 4, 4] },
  { id: 'wide-slab', name: 'Wide slab', note: '8 × 1 × 8', kind: 'box', size: [8, 1, 8] },
  { id: 'long-bar', name: 'Long bar', note: '1 × 1 × 8', kind: 'box', size: [1, 1, 8] },
  { id: 'hull-section', name: 'Hull section', note: '8 × 5 × 8', kind: 'box', size: [8, 5, 8] },
  { id: 'bow-wedge', name: 'Bow wedge', note: '8 × 5 × 8', kind: 'wedge', size: [8, 5, 8] },
  { id: 'tall-wedge', name: 'Tall wedge', note: '4 × 8 × 4', kind: 'wedge', size: [4, 8, 4] },
  ...([
    ['ballast', [3, 1.5, 3]],
    ['prism', [4, 4, 4]], ['half-hemisphere', [2, 2, 4]], ['quarter-hemisphere', [2, 2, 2]],
    ['pyramid', [4, 4, 4]], ['cylinder', [4, 4, 4]], ['half-cylinder', [2, 4, 4]],
    ['quarter-cylinder', [4, 4, 4]], ['quarter-cylinder-wall', [4, 4, 4]],
    ['sphere', [4, 4, 4]], ['hemisphere', [4, 2, 4]], ['sphere-octant', [4, 4, 4]],
    ['hemisphere-shell', [4, 2, 4]], ['half-hemisphere-shell', [2, 2, 4]],
    ['quarter-hemisphere-shell', [4, 4, 4]], ['parabolic-shell', [4, 1, 4]],
    ['cone', [4, 4, 4]], ['hollow-cube', [4, 4, 4]], ['concave-corner', [4, 4, 4]],
    ['bridge', [4, 3, 4]], ['diagonal-bridge', [4, 3, 4]], ['rounded-bridge', [4, 3, 4]],
    ['bridge-panel', [4, 3, .25]], ['diagonal-bridge-panel', [4, 3, 4]],
    ['rounded-bridge-panel', [4, 3, 4]], ['breakwater', [8, 1.5, 2]],
  ] satisfies [ConstructionPrimitive['kind'], Vec3][]).map(([kind, size]): HullShape => ({
    id: kind, kind, name: CONSTRUCTION_SHAPE_NAMES[kind], size,
    note: `${size.join(' × ')} m${EDITABLE_SHAPES.has(kind) ? ' · freeform (D)' : ''}${kind === 'hemisphere' ? ' · dome' : ''}${kind === 'ballast' ? ' · 100 t fixed load + casing' : kind.includes('shell') ? ' · open underneath' : kind.includes('bridge') ? ' · open windows' : ''}`,
  })),
];

export type SlotItem =
  | { kind: 'shape'; id: string; name: string; note: string; shape: HullShape }
  | { kind: 'armor'; id: 'armor'; name: string; note: string }
  /** One thickness already on the ship, so a value in use is one key away while sweeping faces. */
  | { kind: 'thickness'; id: string; name: string; note: string; mm: number }
  | { kind: 'opening'; id: 'opening'; name: string; note: string }
  | { kind: 'tool'; id: string; name: string; note: string; tool: BuilderToolId }
  | { kind: 'part'; id: string; name: string; note: string; part: ConstructionEquipmentPart }
  | { kind: 'paint'; id: string; name: string; note: string; color: string }
  | { kind: 'scheme'; id: 'two-tone' | 'disruptive'; name: string; note: string }
  | { kind: 'empty'; id: string; name: string; note: string };

export const HOTBAR_SIZE = 9;
const FAMILY_ORDER: ConstructionEquipmentPart['kind'][] = ['gun', 'torpedo-launcher', 'funnel', 'director', 'mast', 'propeller', 'rudder', 'engine', 'magazine', 'deck-fitting'];
export const FAMILY_NAMES: Record<ConstructionEquipmentPart['kind'], string> = {
  'deck-fitting': 'deck fittings', gun: 'gun', 'torpedo-launcher': 'torpedoes', engine: 'machinery', magazine: 'magazine', funnel: 'funnel', propeller: 'screw', rudder: 'rudder', mast: 'mast', director: 'director',
};
export const formatTonnes = (kg: number, digits = 1) => Math.abs(kg) < 1000 ? `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg` : `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: digits })} t`;

export function partSlot(part: ConstructionEquipmentPart, catalog: ConstructionCatalog): SlotItem {
  const massKg = part.kind === 'gun' ? catalog.weapons.parts.find(gun => gun.id === part.gunPartId)?.massKg : part.massKg;
  const shortName = part.name.replace(/^Fletcher /, '').replace(/ package$/, '').replace(' machinery', '').replace(' mod.0', '').replace(' torpedo bank', '').replace('four-blade ', '').replace('starboard ', '').replace('-round magazine', ' rds');
  return { kind: 'part', id: part.id, name: shortName, note: part.path ? `${part.path.kind} path · ${formatTonnes(part.path.massKgPerM)}/m` : `${FAMILY_NAMES[part.kind]}${massKg ? ` · ${formatTonnes(massKg)}` : ''}`, part };
}
export function sortedParts(catalog: ConstructionCatalog, placement: (part: ConstructionEquipmentPart) => boolean): ConstructionEquipmentPart[] {
  // Guns run from the heaviest calibre down, so a shelf reads as a battery list; every other family is alphabetical.
  const caliber = (part: ConstructionEquipmentPart) => part.kind === 'gun' ? catalog.weapons.parts.find(gun => gun.id === part.gunPartId)?.caliberM ?? 0 : 0;
  return catalog.equipment.filter(part => part.kind !== 'magazine' && part.id !== 'generic-vertical-ladder' && placement(part)).slice().sort((a, b) => FAMILY_ORDER.indexOf(a.kind) - FAMILY_ORDER.indexOf(b.kind) || caliber(b) - caliber(a) || a.name.localeCompare(b.name));
}

export const thicknessSlotId = (mm: number) => `mm-${mm}`;
/** Nine keyed slots plus the drawer, which lists everything the layer can place. The Armor layer's cards are the
 * editable millimetre value, every thickness the ship already uses (thickest first) and the opening. A fitting
 * filter narrows Fittings to one shelf and nation; `all` stays the whole layer, for the drawer's search. */
export function paletteFor(layer: BuilderLayer, catalog: ConstructionCatalog, thicknesses: readonly number[] = [], fittings?: FittingFilter): { bar: SlotItem[]; drawer: SlotItem[]; all?: SlotItem[] } {
  const pad = (items: SlotItem[]): SlotItem[] => [...items.slice(0, HOTBAR_SIZE), ...Array.from({ length: Math.max(0, HOTBAR_SIZE - items.length) }, (_, index): SlotItem => ({ kind: 'empty', id: `empty-${index}`, name: '', note: '' }))];
  switch (layer) {
    case 'hull': {
      const shapes = HULL_SHAPES.map((shape): SlotItem => ({ kind: 'shape', id: shape.id, name: shape.name, note: shape.note, shape }));
      return { bar: shapes.slice(0, HOTBAR_SIZE), drawer: shapes };
    }
    case 'armor': {
      // The first card is the editor's millimetre field, not a preset; it shows the current value. The values in use follow it, the opening closes the bar.
      const armor: SlotItem = { kind: 'armor', id: 'armor', name: 'Armor', note: 'thickness in mm' }, opening: SlotItem = { kind: 'opening', id: 'opening', name: 'Opening', note: 'open to sea' };
      const values = [...new Set(thicknesses)].sort((a, b) => b - a).map((mm): SlotItem => ({ kind: 'thickness', id: thicknessSlotId(mm), name: `${mm} mm`, note: mm > 0 ? 'armor in use on this ship' : 'structural skin in use on this ship', mm }));
      return { bar: [armor, ...values.slice(0, HOTBAR_SIZE - 2), opening], drawer: [armor, ...values, opening] };
    }
    case 'internals': {
      const tools: SlotItem[] = [{ kind: 'tool', id: 'deck', name: 'Deck', note: 'level', tool: 'deck' }, { kind: 'tool', id: 'bulkhead', name: 'Bulkhead', note: 'transverse', tool: 'bulkhead' },
        { kind: 'tool', id: 'longitudinal', name: 'Split', note: 'lengthwise', tool: 'longitudinal' }, { kind: 'tool', id: 'merge', name: 'Merge', note: 'rooms', tool: 'merge' }];
      const parts = sortedParts(catalog, part => part.placement === 'internal').map(part => partSlot(part, catalog));
      return { bar: pad([...tools, ...parts]), drawer: [...tools, ...parts] };
    }
    case 'fittings': {
      const every = sortedParts(catalog, part => part.placement !== 'internal'), all = every.map(part => partSlot(part, catalog));
      if (!fittings) return { bar: pad(all), drawer: all, all };
      const shelf = new Set(filterFittings(every, catalog, fittings)), parts = all.filter(item => item.kind === 'part' && shelf.has(item.part));
      return { bar: pad(parts), drawer: parts, all };
    }
    case 'paint': {
      const items: SlotItem[] = [...CONSTRUCTION_PAINTS.map((paint): SlotItem => ({ kind: 'paint', id: paint.id, name: paint.name, note: 'paint', color: paint.color })),
        { kind: 'scheme', id: 'two-tone', name: 'Two tone', note: 'deck + sides' }, { kind: 'scheme', id: 'disruptive', name: 'Disruptive', note: '12 m bands' }];
      return { bar: pad(items), drawer: items };
    }
  }
}

export const KEY_LABELS: Record<string, string> = { Delete: '⌫', Enter: '⏎', Escape: 'Esc' };
