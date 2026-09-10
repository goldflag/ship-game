import type { Formation } from '../multiplayer/generated/Formation';
import type { ShipClass } from './shipGlyphs';

export type { Formation };

/** Every formation the picker offers, in display order. */
export const FORMATIONS: readonly { id: Formation; label: string; hint: string }[] = [
  { id: 'column', label: 'Column', hint: 'Line ahead. Followers turn in succession along the guide\'s track.' },
  { id: 'screen', label: 'Screen', hint: 'Cruisers on an inner ring, destroyers on an outer ring ahead and around the guide. Turns together.' },
  { id: 'line-abreast', label: 'Line abreast', hint: 'Ships alternate to starboard and port of the guide. Turns together.' },
];
export const formationLabel = (formation: Formation | undefined): string => FORMATIONS.find(f => f.id === (formation ?? 'column'))?.label ?? 'Column';

export interface StationShip { id: string; shipClass: ShipClass }
export interface Station { id: string; offset: [number, number]; slot: number }

/** Radius of the escort station tolerance passed with every escort order. */
export const STATION_RADIUS_M = 160;
/** Ring radii of the screen: cruisers and heavies inside, destroyers outside. */
export const SCREEN_INNER_RADIUS_M = 1500;
export const SCREEN_OUTER_RADIUS_M = 2500;

/** Interval `d` between ships in column and line abreast, from the guide's hull:
 * 1,000 yd for a battle line, 500 yd for destroyers and cruisers. */
export function roleInterval(guideClass: ShipClass): number {
  return guideClass === 'battleship' || guideClass === 'carrier' ? 900 : guideClass === 'auxiliary' ? 550 : 500;
}

const ROLE_RANK: Record<ShipClass, number> = { battleship: 0, carrier: 0, cruiser: 1, auxiliary: 2, destroyer: 3, submarine: 4 };
/** Heavies nearest the guide, cruisers next, destroyers outermost. Ties keep the caller's order. */
export function roleOrder<T extends StationShip>(ships: readonly T[]): T[] {
  return ships.map((ship, index) => ({ ship, index })).sort((a, b) => ROLE_RANK[a.ship.shipClass] - ROLE_RANK[b.ship.shipClass] || a.index - b.index).map(({ ship }) => ship);
}

/** Bearings for `count` stations on a ring, spread evenly with the first dead ahead
 * and the rest alternating to starboard and port so the bow is covered first. */
function ringBearings(count: number): number[] {
  const step = Math.PI * 2 / count;
  return Array.from({ length: count }, (_, k) => {
    const n = Math.ceil(k / 2), sign = k % 2 ? 1 : -1;
    return k === 0 ? 0 : sign * n * step;
  });
}
const onRing = (radius: number, bearing: number): [number, number] => [Math.round(radius * Math.sin(bearing)), Math.round(-radius * Math.cos(bearing))];

/** Escort stations in the sim's [starboard, aft] frame for one guide and its followers.
 * Slot 0 is the first ship to take the guide if the guide is lost. The same table
 * seeds the deployment chart and the in-battle escort orders, so what the player
 * placed is what sails. */
export function formationStations(formation: Formation, guide: StationShip, followers: readonly StationShip[]): Station[] {
  const ordered = roleOrder(followers.filter(f => f.id !== guide.id));
  const d = roleInterval(guide.shipClass);
  if (formation === 'column') return ordered.map((ship, i) => ({ id: ship.id, offset: [0, d * (i + 1)], slot: i }));
  if (formation === 'line-abreast') return ordered.map((ship, i) => ({ id: ship.id, offset: [(i % 2 ? -1 : 1) * d * Math.ceil((i + 1) / 2), 0], slot: i }));
  // Screen: destroyers take the outer ring, everything else the inner ring. A lone
  // ring still starts dead ahead, so the guide is never the first ship to meet a threat.
  const outer = ordered.filter(s => s.shipClass === 'destroyer' || s.shipClass === 'submarine');
  const inner = ordered.filter(s => !outer.includes(s));
  const innerBearings = ringBearings(inner.length), outerBearings = ringBearings(outer.length);
  const stations: Station[] = [];
  inner.forEach((ship, i) => stations.push({ id: ship.id, offset: onRing(SCREEN_INNER_RADIUS_M, innerBearings[i]), slot: stations.length }));
  outer.forEach((ship, i) => stations.push({ id: ship.id, offset: onRing(SCREEN_OUTER_RADIUS_M, outerBearings[i]), slot: stations.length }));
  return stations;
}

/** World position of a station for a guide at (x, z) with the formation axis `heading` (radians, 0 = north, clockwise). */
export function stationPosition(guide: { x: number; z: number; heading: number }, offset: [number, number]): { x: number; z: number } {
  const sin = Math.sin(guide.heading), cos = Math.cos(guide.heading);
  return { x: guide.x + offset[0] * cos - offset[1] * sin, z: guide.z + offset[0] * sin + offset[1] * cos };
}
