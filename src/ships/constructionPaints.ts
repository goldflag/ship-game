import finishes from '../../assets/ships/appearance/finishes.json';
import type { ConstructionSurfaceFinish, ConstructionWear } from './blueprint';
type Painted = { construction: { paint?: string; roofPaint?: string; wear?: ConstructionWear } };

/** Player-selected coatings remain nonmetallic; historical defaults stay unchanged. */
export const CONSTRUCTION_SURFACE_FINISHES = [
  { id: 'matte', name: 'Matte', roughness: .85 },
  { id: 'satin', name: 'Satin', roughness: .58 },
  { id: 'semi-gloss', name: 'Semi-gloss', roughness: .34 },
  { id: 'gloss', name: 'Gloss', roughness: .16 },
] as const;
export const isConstructionSurfaceFinish = (value: unknown): value is ConstructionSurfaceFinish => CONSTRUCTION_SURFACE_FINISHES.some(finish => finish.id === value);
export const constructionFinishRoughness = (finish: ConstructionSurfaceFinish | undefined, fallback: number): number => CONSTRUCTION_SURFACE_FINISHES.find(entry => entry.id === finish)?.roughness ?? fallback;
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
  { id: 'teak-natural', name: 'Natural teak', color: '#97856a' },
  { id: 'hipper-source-gray', name: 'Cruiser source gray', color: '#7c8586' },
  { id: 'hipper-source-hull', name: 'Cruiser source hull gray', color: '#6e7779' },
  { id: 'hipper-source-horizontal', name: 'Cruiser source deck gray', color: '#5b6365' },
  { id: 'hipper-source-underwater', name: 'Cruiser source red oxide', color: '#844234' },
  { id: 'hipper-source-linoleum', name: 'Cruiser source linoleum', color: '#7e5548' },
] as const;
export const constructionPaintColor = (id: string) => CONSTRUCTION_PAINTS.find(p => p.id === id)?.color ?? '#7c8c91';
/** Paint on faces without an assignment of their own; matches the compiler. */
export const constructionShipPaint = (source: Painted): string => source.construction.paint ?? 'naval-gray';
/** Linear reflectance kept by a roof-shade paint: close to deck gray under a light-gray ship, since sunlit
 * horizontal steel otherwise reads as bright as the walls. */
export const ROOF_SHADE = .4;
const linear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const encoded = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
/** A paint colour (`#rrggbb`) darkened in linear light, as horizontal steel of that paint is drawn. */
export function roofShade(color: string): string {
  const channel = (i: number) => Math.round(255 * encoded(ROOF_SHADE * linear(parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16) / 255)));
  return '#' + [0, 1, 2].map(i => channel(i).toString(16).padStart(2, '0')).join('');
}
/** Colour of horizontal steel that wears the ship paint: the roof paint, else the ship paint's shade. */
export const constructionRoofColor = (source: Painted): string =>
  source.construction.roofPaint ? constructionPaintColor(source.construction.roofPaint) : roofShade(constructionPaintColor(constructionShipPaint(source)));
/** Colour of the authored roofs of a fitting coated `paint`: the ship's roof colour under the ship paint,
 * else that paint's own shade. An uncoated fitting keeps its authored roofs. */
export const constructionFittingRoofColor = (source: Painted, paint: string | undefined): string | undefined =>
  paint === undefined ? undefined : paint === constructionShipPaint(source) ? constructionRoofColor(source) : roofShade(constructionPaintColor(paint));
/** Weathering presets. `amount` drives every wear layer in the ship shader (0 draws none). */
export const CONSTRUCTION_WEAR = [
  { id: 'fresh', name: 'Fresh from the yard', amount: .1 },
  { id: 'in-commission', name: 'In commission', amount: .4 },
  { id: 'long-deployment', name: 'Long deployment', amount: .7 },
  { id: 'battle-worn', name: 'Battle-worn', amount: 1 },
] as const;
export const DEFAULT_CONSTRUCTION_WEAR: ConstructionWear = 'in-commission';
export const isConstructionWear = (value: unknown): value is ConstructionWear => CONSTRUCTION_WEAR.some(wear => wear.id === value);
export const constructionWearAmount = (source: Painted): number =>
  CONSTRUCTION_WEAR.find(wear => wear.id === (source.construction.wear ?? DEFAULT_CONSTRUCTION_WEAR))!.amount;
/** An installation's own paint, else the ship paint; internal machinery keeps its original finish. */
export const constructionFittingPaint = (source: Painted, item: { paint?: string }, part?: { placement: string }): string | undefined =>
  item.paint ?? (part?.placement === 'internal' ? undefined : source.construction.paint);
export const CONSTRUCTION_FINISH = {
  steelRoughness: finishes.finishes['painted-steel'].roughness,
  deckRoughness: finishes.finishes['painted-deck'].roughness,
  metalness: finishes.finishes['painted-steel'].metallic,
  tileMeters: finishes.finishes['painted-steel'].tileMeters,
  grain: finishes.finishes['painted-steel'].grain,
} as const;
