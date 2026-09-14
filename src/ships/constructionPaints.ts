import finishes from '../../assets/ships/appearance/finishes.json';
/** Sandbox paints, using shared painted-steel/deck finish values and an 8 m
 * metric repeat. These are design colors, not claims about historical schemes. */
export const CONSTRUCTION_PAINTS = [
  { id: 'naval-gray', name: 'Naval gray', color: '#7c8c91' },
  { id: 'light-gray', name: 'Light gray', color: '#b5bfbc' },
  { id: 'dark-gray', name: 'Dark gray', color: '#43565f' },
  { id: 'deck-gray', name: 'Deck gray', color: '#64716f' },
  { id: 'sea-blue', name: 'Sea blue', color: '#405d70' },
  { id: 'red-oxide', name: 'Red oxide', color: '#80483c' },
  { id: 'boot-top-black', name: 'Boot topping', color: '#253035' },
] as const;
export const constructionPaintColor = (id: string) => CONSTRUCTION_PAINTS.find(p => p.id === id)?.color ?? '#7c8c91';
export const CONSTRUCTION_FINISH = {
  steelRoughness: finishes.finishes['painted-steel'].roughness,
  deckRoughness: finishes.finishes['painted-deck'].roughness,
  metalness: finishes.finishes['painted-steel'].metallic,
  tileMeters: finishes.finishes['painted-steel'].tileMeters,
  grain: finishes.finishes['painted-steel'].grain,
} as const;
