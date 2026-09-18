import shapes from './constructionHullPresets.generated.json';
import type { ConstructionCustomHull } from './blueprint';

/** Original generic starters, stored in the same editable section format. */
function genericShape(length: number, beam: number, depth: number, widths: number[], round: number, flat = false) {
  const customHull: ConstructionCustomHull = {
    version: 1, bulb: 0, rake: flat ? 0 : .65, redPaintY: -.02 * depth,
    stations: [0, .08, .2, .36, .54, .72, .88, 1].map((t, i) => {
      const w = widths[i], keel = flat ? -.45 : -.52 + .28 * Math.pow(Math.abs(t - .5) * 2, 3), deck = .45;
      const half = [
        { x: w, y: deck },
        { x: w * .96, y: keel + (deck - keel) * .63 },
        { x: w * (.85 - round * .14), y: keel + (deck - keel) * .18 },
        { x: w * .36, y: keel + (flat ? 0 : .02) },
      ];
      return { id: `section-${i}`, t, points: [...half.map(p => ({ ...p, x: p.x ? -p.x : 0 })),
        { x: 0, y: keel }, ...half.slice().reverse().map(p => ({ ...p }))] };
    }),
  };
  return { length, beam, depth, customHull };
}

/** Editable ship hulls and generic sandbox starters. Regenerate ship-derived
 * sections from their blueprints with bun scripts/construction/hull-presets.ts. */
export const HULL_PRESETS = [
  { id: 'bismarck-hull', shipId: 'bismarck', name: 'Bismarck', category: 'Battleship', note: 'Battleship · broad beam', ...shapes.bismarck },
  { id: 'king-george-v-hull', shipId: 'king-george-v', name: 'King George V', category: 'Battleship', note: 'Battleship · compact, full hull', ...shapes['king-george-v'] },
  { id: 'admiral-hipper-hull', shipId: 'admiral-hipper', name: 'Admiral Hipper', category: 'Cruiser', note: 'Cruiser · flared bow', ...shapes['admiral-hipper'] },
  { id: 'baltimore-hull', shipId: 'baltimore', name: 'Baltimore', category: 'Cruiser', note: 'Cruiser · broad transom stern', ...shapes.baltimore },
  { id: 'fletcher-hull', shipId: 'fletcher', name: 'Fletcher', category: 'Destroyer', note: 'Destroyer · broad stern', ...shapes.fletcher },
  { id: 'yukikaze-hull', shipId: 'yukikaze', name: 'Yukikaze', category: 'Destroyer', note: 'Destroyer · raised forecastle', ...shapes.yukikaze },
  { id: 'patrol-hull', shipId: null, name: 'Patrol boat', category: 'Generic', note: 'Generic · fine bow, flat stern', ...genericShape(36, 6.5, 4, [.015, .26, .66, .94, 1, .96, .83, .7], .45) },
  { id: 'destroyer-hull', shipId: null, name: 'Destroyer', category: 'Generic', note: 'Generic · slender, tapered stern', ...genericShape(120, 12, 9, [0, .24, .62, .92, 1, .9, .55, .08], .78) },
  { id: 'battleship-hull', shipId: null, name: 'Battleship', category: 'Generic', note: 'Generic · broad beam, full bilges', ...genericShape(220, 32, 18, [.01, .3, .73, .97, 1, .96, .66, .12], .88) },
  { id: 'barge-hull', shipId: null, name: 'Barge', category: 'Generic', note: 'Generic · flat bottom, hard chines', ...genericShape(65, 15, 6, [.74, .87, 1, 1, 1, 1, .9, .78], 0, true) },
] as const;
export const DEFAULT_HULL_PRESET = 'fletcher-hull';
export type HullPresetChoice = typeof HULL_PRESETS[number]['id'] | 'blank';
