import shapes from './constructionHullPresets.generated.json';

/** Editable approximations of our original in-game hulls. Regenerate from their
 * blueprints with bun scripts/construction/hull-presets.ts. */
export const HULL_PRESETS = [
  { id: 'bismarck-hull', shipId: 'bismarck', name: 'Bismarck', category: 'Battleship', note: 'Battleship · broad beam', ...shapes.bismarck },
  { id: 'king-george-v-hull', shipId: 'king-george-v', name: 'King George V', category: 'Battleship', note: 'Battleship · compact, full hull', ...shapes['king-george-v'] },
  { id: 'admiral-hipper-hull', shipId: 'admiral-hipper', name: 'Admiral Hipper', category: 'Cruiser', note: 'Cruiser · flared bow', ...shapes['admiral-hipper'] },
  { id: 'baltimore-hull', shipId: 'baltimore', name: 'Baltimore', category: 'Cruiser', note: 'Cruiser · broad transom stern', ...shapes.baltimore },
  { id: 'fletcher-hull', shipId: 'fletcher', name: 'Fletcher', category: 'Destroyer', note: 'Destroyer · broad stern', ...shapes.fletcher },
  { id: 'yukikaze-hull', shipId: 'yukikaze', name: 'Yukikaze', category: 'Destroyer', note: 'Destroyer · raised forecastle', ...shapes.yukikaze },
] as const;
export const DEFAULT_HULL_PRESET = 'fletcher-hull';
export type HullPresetChoice = typeof HULL_PRESETS[number]['id'] | 'blank';
