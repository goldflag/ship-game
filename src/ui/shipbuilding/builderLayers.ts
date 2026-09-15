import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSurfaceAssignment, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_PAINTS } from './paints';
import { CONSTRUCTION_SHAPE_NAMES } from '../../ships/constructionShapes';

/** Layer tabs, tool rails and hotbar palettes of the "Slipway rails" editor.
 * Pure data: the component maps these onto source commands. */
export type BuilderLayer = 'hull' | 'armor' | 'internals' | 'fittings' | 'paint';
export const BUILDER_LAYERS: { id: BuilderLayer; name: string }[] = [
  { id: 'hull', name: 'Hull' }, { id: 'armor', name: 'Armor' }, { id: 'internals', name: 'Internals' }, { id: 'fittings', name: 'Fittings' }, { id: 'paint', name: 'Paint' },
];

export type BuilderTool = 'select' | 'place' | 'fill' | 'erase' | 'measure' | 'apply' | 'area' | 'eyedrop' | 'opening' | 'deck' | 'bulkhead' | 'longitudinal' | 'merge' | 'module';
export type BuilderToggle = 'mirror' | 'arc';
export type BuilderAction = 'rotate' | 'suggest';
export type RailEntry =
  | { kind: 'tool'; id: BuilderTool; name: string; key: string; glyph: string }
  | { kind: 'toggle'; id: BuilderToggle; name: string; key: string; glyph: string }
  | { kind: 'action'; id: BuilderAction; name: string; key: string; glyph: string };

const tool = (id: BuilderTool, name: string, key: string, glyph = name): RailEntry => ({ kind: 'tool', id, name, key, glyph });
const toggle = (id: BuilderToggle, name: string, key: string, glyph = name): RailEntry => ({ kind: 'toggle', id, name, key, glyph });
const action = (id: BuilderAction, name: string, key: string, glyph = name): RailEntry => ({ kind: 'action', id, name, key, glyph });
const select = tool('select', 'Select', 'V'), mirror = toggle('mirror', 'Mirror', 'M');

export const BUILDER_RAIL: Record<BuilderLayer, RailEntry[]> = {
  hull: [select, tool('place', 'Place', 'B'), tool('fill', 'Fill', 'F'), tool('erase', 'Erase', 'E'), mirror, tool('measure', 'Measure', 'T')],
  armor: [select, tool('apply', 'Paint', 'B', 'Paint'), tool('area', 'Area', 'A'), tool('eyedrop', 'Eyedrop', 'I'), mirror, tool('opening', 'Opening', 'O')],
  internals: [select, tool('deck', 'Deck', 'D'), tool('bulkhead', 'Bulkhead', 'B'), tool('longitudinal', 'Split', 'L', 'Split'), tool('merge', 'Merge', 'J'), tool('module', 'Module', 'U'), action('suggest', 'Suggest', 'G')],
  fittings: [select, tool('place', 'Place', 'B'), action('rotate', 'Rotate', 'R'), toggle('arc', 'Arc', 'A'), mirror, action('suggest', 'Suggest', 'G')],
  paint: [select, tool('apply', 'Paint', 'B', 'Paint'), tool('area', 'Area', 'A'), tool('eyedrop', 'Eyedrop', 'I'), mirror],
};
/** The tool a layer starts with; Select is always one key away. */
export const DEFAULT_TOOL: Record<BuilderLayer, BuilderTool> = { hull: 'place', armor: 'apply', internals: 'module', fittings: 'place', paint: 'apply' };

export interface HullShape { id: string; name: string; note: string; kind: ConstructionPrimitive['kind']; size: Vec3 }
/** Width × height × length in metres, on the 1 m hull grid. Quarter plates are the thinnest useful skin. */
export const HULL_SHAPES: HullShape[] = [
  { id: 'cube', name: 'Cube', note: '1 m', kind: 'box', size: [1, 1, 1] },
  { id: 'slab', name: 'Slab', note: '4 × 1 × 4', kind: 'box', size: [4, 1, 4] },
  { id: 'bar', name: 'Bar', note: '1 × 1 × 4', kind: 'box', size: [1, 1, 4] },
  { id: 'wedge', name: 'Wedge', note: '1 : 1', kind: 'wedge', size: [4, 4, 4] },
  { id: 'slope', name: 'Slope', note: '1 : 2', kind: 'wedge', size: [4, 2, 4] },
  { id: 'long-slope', name: 'Long slope', note: '1 : 4', kind: 'wedge', size: [4, 1, 4] },
  { id: 'corner-out', name: 'Corner out', note: '4 m', kind: 'corner', size: [4, 4, 4] },
  { id: 'corner-in', name: 'Corner in', note: '4 m', kind: 'inverse-corner', size: [4, 4, 4] },
  { id: 'plate', name: 'Plate', note: '4 × ¼ × 4', kind: 'box', size: [4, .25, 4] },
  { id: 'block', name: 'Block', note: '4 m', kind: 'box', size: [4, 4, 4] },
  { id: 'wide-slab', name: 'Wide slab', note: '8 × 1 × 8', kind: 'box', size: [8, 1, 8] },
  { id: 'long-bar', name: 'Long bar', note: '1 × 1 × 8', kind: 'box', size: [1, 1, 8] },
  { id: 'hull-section', name: 'Hull section', note: '8 × 5 × 8', kind: 'box', size: [8, 5, 8] },
  { id: 'bow-wedge', name: 'Bow wedge', note: '8 × 5 × 8', kind: 'wedge', size: [8, 5, 8] },
  { id: 'tall-wedge', name: 'Tall wedge', note: '4 × 8 × 4', kind: 'wedge', size: [4, 8, 4] },
  ...([
    ['ballast', [3, 1.5, 3]],
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
    note: `${size.join(' × ')} m${kind === 'ballast' ? ' · 100 t fixed load + casing' : kind.includes('shell') ? ' · open underneath' : kind.includes('bridge') ? ' · open windows' : ''}`,
  })),
];

export interface ArmorPreset { id: string; name: string; note: string; thicknessMm: number; material: ConstructionSurfaceAssignment['material'] }
export const ARMOR_PRESETS: ArmorPreset[] = [
  { id: 'skin', name: 'Skin', note: 'structural', thicknessMm: 0, material: 'steel' },
  { id: 'splinter', name: 'Splinter', note: '25 mm', thicknessMm: 25, material: 'armor-steel' },
  { id: 'deck', name: 'Deck', note: '40 mm', thicknessMm: 40, material: 'armor-steel' },
  { id: 'light-belt', name: 'Light belt', note: '50 mm', thicknessMm: 50, material: 'armor-steel' },
  { id: 'belt', name: 'Belt', note: '100 mm', thicknessMm: 100, material: 'armor-steel' },
  { id: 'heavy-belt', name: 'Heavy belt', note: '200 mm', thicknessMm: 200, material: 'armor-steel' },
  { id: 'turret-face', name: 'Turret face', note: '300 mm', thicknessMm: 300, material: 'armor-steel' },
];

export type SlotItem =
  | { kind: 'shape'; id: string; name: string; note: string; shape: HullShape }
  | { kind: 'armor'; id: string; name: string; note: string; thicknessMm: number; material: ConstructionSurfaceAssignment['material'] }
  | { kind: 'custom-armor'; id: 'custom'; name: string; note: string }
  | { kind: 'opening'; id: 'opening'; name: string; note: string }
  | { kind: 'tool'; id: string; name: string; note: string; tool: BuilderTool }
  | { kind: 'part'; id: string; name: string; note: string; part: ConstructionEquipmentPart }
  | { kind: 'paint'; id: string; name: string; note: string; color: string }
  | { kind: 'scheme'; id: 'two-tone' | 'disruptive'; name: string; note: string }
  | { kind: 'empty'; id: string; name: string; note: string };

export const HOTBAR_SIZE = 9;
const FAMILY_ORDER: ConstructionEquipmentPart['kind'][] = ['gun', 'torpedo-launcher', 'funnel', 'director', 'mast', 'propeller', 'rudder', 'engine', 'magazine'];
export const FAMILY_NAMES: Record<ConstructionEquipmentPart['kind'], string> = {
  gun: 'gun', 'torpedo-launcher': 'torpedoes', engine: 'machinery', magazine: 'magazine', funnel: 'funnel', propeller: 'screw', rudder: 'rudder', mast: 'mast', director: 'director',
};
export const formatTonnes = (kg: number, digits = 1) => `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: digits })} t`;

export function partSlot(part: ConstructionEquipmentPart, catalog: ConstructionCatalog): SlotItem {
  const massKg = part.kind === 'gun' ? catalog.weapons.parts.find(gun => gun.id === part.gunPartId)?.massKg : part.massKg;
  const shortName = part.name.replace(/^Fletcher /, '').replace(/ package$/, '').replace(' machinery', '').replace(' mod.0', '').replace(' torpedo bank', '').replace('four-blade ', '').replace('starboard ', '').replace('-round magazine', ' rds');
  return { kind: 'part', id: part.id, name: shortName, note: `${FAMILY_NAMES[part.kind]}${massKg ? ` · ${formatTonnes(massKg)}` : ''}`, part };
}
export function sortedParts(catalog: ConstructionCatalog, placement: (part: ConstructionEquipmentPart) => boolean): ConstructionEquipmentPart[] {
  return catalog.equipment.filter(placement).slice().sort((a, b) => FAMILY_ORDER.indexOf(a.kind) - FAMILY_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** Nine keyed slots plus the drawer, which lists everything the layer can place. */
export function paletteFor(layer: BuilderLayer, catalog: ConstructionCatalog): { bar: SlotItem[]; drawer: SlotItem[] } {
  const pad = (items: SlotItem[]): SlotItem[] => [...items.slice(0, HOTBAR_SIZE), ...Array.from({ length: Math.max(0, HOTBAR_SIZE - items.length) }, (_, index): SlotItem => ({ kind: 'empty', id: `empty-${index}`, name: '', note: '' }))];
  switch (layer) {
    case 'hull': {
      const shapes = HULL_SHAPES.map((shape): SlotItem => ({ kind: 'shape', id: shape.id, name: shape.name, note: shape.note, shape }));
      return { bar: shapes.slice(0, HOTBAR_SIZE), drawer: shapes };
    }
    case 'armor': {
      const items: SlotItem[] = [...ARMOR_PRESETS.map((preset): SlotItem => ({ kind: 'armor', id: preset.id, name: preset.name, note: preset.note, thicknessMm: preset.thicknessMm, material: preset.material })),
        { kind: 'custom-armor', id: 'custom', name: 'Custom', note: '… mm' }, { kind: 'opening', id: 'opening', name: 'Opening', note: 'open to sea' }];
      return { bar: pad(items), drawer: items };
    }
    case 'internals': {
      const tools: SlotItem[] = [{ kind: 'tool', id: 'deck', name: 'Deck', note: 'level', tool: 'deck' }, { kind: 'tool', id: 'bulkhead', name: 'Bulkhead', note: 'transverse', tool: 'bulkhead' },
        { kind: 'tool', id: 'longitudinal', name: 'Split', note: 'lengthwise', tool: 'longitudinal' }, { kind: 'tool', id: 'merge', name: 'Merge', note: 'rooms', tool: 'merge' }];
      const parts = sortedParts(catalog, part => part.placement === 'internal').map(part => partSlot(part, catalog));
      return { bar: pad([...tools, ...parts]), drawer: [...tools, ...parts] };
    }
    case 'fittings': {
      const parts = sortedParts(catalog, part => part.placement !== 'internal').map(part => partSlot(part, catalog));
      return { bar: pad(parts), drawer: parts };
    }
    case 'paint': {
      const items: SlotItem[] = [...CONSTRUCTION_PAINTS.map((paint): SlotItem => ({ kind: 'paint', id: paint.id, name: paint.name, note: 'paint', color: paint.color })),
        { kind: 'scheme', id: 'two-tone', name: 'Two tone', note: 'deck + sides' }, { kind: 'scheme', id: 'disruptive', name: 'Disruptive', note: '12 m bands' }];
      return { bar: pad(items), drawer: items };
    }
  }
}

export const KEY_LABELS: Record<string, string> = { Delete: '⌫', Enter: '⏎', Escape: 'Esc' };
