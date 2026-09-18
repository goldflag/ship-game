import finishes from '../../assets/ships/appearance/finishes.json';
import type { ConstructionSurfaceFinish } from './blueprint';

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
export const CONSTRUCTION_FINISH = {
  steelRoughness: finishes.finishes['painted-steel'].roughness,
  deckRoughness: finishes.finishes['painted-deck'].roughness,
  metalness: finishes.finishes['painted-steel'].metallic,
  tileMeters: finishes.finishes['painted-steel'].tileMeters,
  grain: finishes.finishes['painted-steel'].grain,
} as const;
