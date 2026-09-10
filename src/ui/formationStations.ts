import type { Formation } from '../multiplayer/generated/Formation';
import type { ShipClass } from './shipGlyphs';

export type { Formation };

/** Every formation the picker offers, in display order. */
export const FORMATIONS: readonly { id: Formation; label: string; hint: string }[] = [
  { id: 'column', label: 'Column', hint: 'Line ahead. Followers turn in succession along the guide\'s track.' },
  { id: 'double-column', label: 'Double column', hint: 'Two columns d apart; the guide leads the port column. Turns in succession.' },
  { id: 'triple-column', label: 'Triple column', hint: 'Three columns; the guide leads the centre column. Turns in succession.' },
  { id: 'screen', label: 'Screen', hint: 'Cruisers on an inner ring, destroyers on an outer ring ahead and around the guide. Turns together.' },
  { id: 'line-abreast', label: 'Line abreast', hint: 'Ships alternate to starboard and port of the guide. Turns together.' },
];
export const formationLabel = (formation: Formation | undefined): string => FORMATIONS.find(f => f.id === (formation ?? 'column'))?.label ?? 'Column';

export interface StationShip { id: string; shipClass: ShipClass }
export interface Station { id: string; offset: [number, number]; slot: number }

/** Radius of the escort station tolerance passed with every escort order. */
export const STATION_RADIUS_M = 160;
/** Ring radii of the screen: cruisers and heavies inside, destroyers outside. */
export const SCREEN_INNER_RADIUS_M = 700;
export const SCREEN_OUTER_RADIUS_M = 1300;
/** The protocol rejects a station closer than this, so no offset in the table may fall under it. */
export const MIN_STATION_OFFSET_M = 350;

/** Interval `d` between ships in the column and line formations, from the guide's hull.
 * Close order: a battle line keeps 450 m, escorts 360 m, so a group reads as one body
 * on the chart and the guide's screen stays inside gun and lookout range. */
export function roleInterval(guideClass: ShipClass): number {
  return guideClass === 'battleship' || guideClass === 'carrier' ? 450 : guideClass === 'auxiliary' ? 400 : 360;
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

/** Two columns `d` apart with the guide at the head of the port column (x = 0); the
 * starboard column is at x = +d. The first follower takes the berth abeam of the guide,
 * then each rank astern fills port before starboard. */
function doubleColumnCell(i: number, d: number): [number, number] {
  if (i === 0) return [d, 0];
  const j = i - 1;
  return [j % 2 ? d : 0, d * (Math.floor(j / 2) + 1)];
}
/** Three columns at x = −d, 0, +d with the guide at the head of the centre column. The
 * first rank fills the wings abeam of the guide, then each rank astern fills centre,
 * port, starboard. */
function tripleColumnCell(i: number, d: number): [number, number] {
  if (i < 2) return [i === 0 ? -d : d, 0];
  const j = i - 2, lane = j % 3;
  return [lane === 0 ? 0 : lane === 1 ? -d : d, d * (Math.floor(j / 3) + 1)];
}

/** Escort stations in the sim's [starboard, aft] frame for one guide and its followers.
 * Slot 0 is the first ship to take the guide if the guide is lost. The same table
 * seeds the deployment chart and the in-battle escort orders, so what the player
 * placed is what sails. */
export function formationStations(formation: Formation, guide: StationShip, followers: readonly StationShip[]): Station[] {
  const ordered = roleOrder(followers.filter(f => f.id !== guide.id));
  const d = roleInterval(guide.shipClass);
  if (formation === 'column') return ordered.map((ship, i) => ({ id: ship.id, offset: [0, d * (i + 1)], slot: i }));
  if (formation === 'line-abreast') return ordered.map((ship, i) => ({ id: ship.id, offset: [(i % 2 ? -1 : 1) * d * Math.ceil((i + 1) / 2), 0], slot: i }));
  // Columns abeam: the guide holds the head of its own column and the cells fill across
  // then back, so the group keeps its beam short and every rank is complete before the next.
  if (formation === 'double-column') return ordered.map((ship, i) => ({ id: ship.id, offset: doubleColumnCell(i, d), slot: i }));
  if (formation === 'triple-column') return ordered.map((ship, i) => ({ id: ship.id, offset: tripleColumnCell(i, d), slot: i }));
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
