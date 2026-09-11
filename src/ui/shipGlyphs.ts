import type { ShipDefinition } from '../ships/blueprint';

export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'carrier' | 'submarine' | 'auxiliary';

/** Class from the hull itself: what it carries and how much of it there is. */
export function shipClassOf(definition: Pick<ShipDefinition, 'hull' | 'mounts' | 'airWing' | 'submarine'>): ShipClass {
  if (definition.submarine) return 'submarine';
  if (definition.airWing) return 'carrier';
  const caliberMm = Math.max(0, ...definition.mounts.map(m => (m.weapon?.caliberM ?? 0) * 1000));
  const tonnes = definition.hull.massKg / 1000;
  if (caliberMm >= 280) return 'battleship';
  if (caliberMm >= 150) return 'cruiser';
  // Light guns on a big hull is a merchant or a tender; on a small hull, a destroyer or corvette.
  if (tonnes >= 5000) return 'auxiliary';
  return 'destroyer';
}
/** Observers size an unidentified hull before they can name it. */
export function shipClassFromReport(classification: string | null | undefined): ShipClass {
  return classification === 'Large warship' ? 'battleship' : classification === 'Warship' ? 'cruiser' : classification === 'Small warship' ? 'destroyer' : 'cruiser';
}
/** Top-down silhouettes, bow up, about 24 px tall: the hull outline plus a
 * class mark drawn in the marker colour (turrets, an island, a conning tower). */
export const SHIP_GLYPHS: Record<ShipClass, { hull: string; mark: string }> = {
  battleship: { hull: 'M0 -12 6.5 -4 6 10 -6 10 -6.5 -4Z', mark: 'M-2.6 -6h5.2v3.2h-5.2ZM-2.6 3h5.2v3.2h-5.2Z' },
  cruiser: { hull: 'M0 -12 4.8 -4 4.4 10 -4.4 10 -4.8 -4Z', mark: 'M-1.8 -5h3.6v2.6h-3.6ZM-1.8 4h3.6v2.6h-3.6Z' },
  destroyer: { hull: 'M0 -12 3.2 -4 2.8 10 -2.8 10 -3.2 -4Z', mark: 'M-1 -1h2v4h-2Z' },
  carrier: { hull: 'M-5 -12h10v22h-10Z', mark: 'M2.2 -4h2.2v6h-2.2Z' },
  submarine: { hull: 'M0 -11c2.6 2 3 7 3 11s-.4 9-3 11c-2.6-2-3-7-3-11s.4-9 3-11Z', mark: 'M-1.2 -3h2.4v4h-2.4Z' },
  auxiliary: { hull: 'M0 -11 4.2 -6 4.2 10 -4.2 10 -4.2 -6Z', mark: 'M-2.4 -1h4.8v1.6h-4.8Z' },
};
