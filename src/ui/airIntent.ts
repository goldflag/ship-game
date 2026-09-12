import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { ObservedAircraft } from '../game/session/BattleSession';
import type { Vec3 } from '../ships/blueprint';
import type { AirCluster, ObservedAircraftType } from './fleetStats';
import { reportState } from './reconReports';

/** An own ship the chart can name, as a point on the water. */
export interface OwnShipPoint { id: string; name: string; x: number; z: number }
/** Where a reported strike is heading, inferred from its course and closing speed. */
export interface StrikeIntent { shipId: string; name: string; rangeM: number; releaseSeconds: number }
/** One reported air group with what an observer can say about its load and its course. */
export interface AirStrike {
  cluster: AirCluster;
  /** Planes seen with their weapon still slung, seen after release, and current planes whose load was not observed. */
  carrying: number; released: number; unobserved: number;
  intent?: StrikeIntent;
}

/** Metres short of the target where the run ends: a torpedo drops at 650–1050 m, a bomb over the hull. */
export const RELEASE_RANGE_M: Record<ObservedAircraftType, number> = { 'torpedo-bomber': 900, 'dive-bomber': 150, unknown: 500, fighter: 0 };
/** A group counts as heading for a ship when the ship sits within this half-angle of its course. */
export const INTENT_CONE_RAD = 30 * Math.PI / 180;
export const INTENT_REACH_M = 15000;
const MIN_STRIKE_SPEED_MPS = 25;

/** The own ship a strike is closing on: inside the course cone, within reach, and
 * soonest to its release point. Fighters have no ship target; a slow or stale
 * group has no course to read. */
export function inferredTarget(position: Vec3, velocity: Vec3, type: ObservedAircraftType, ships: readonly OwnShipPoint[]): StrikeIntent | undefined {
  if (type === 'fighter') return undefined;
  const [vx, , vz] = velocity, speed = Math.hypot(vx, vz);
  if (speed < MIN_STRIKE_SPEED_MPS) return undefined;
  let best: StrikeIntent | undefined;
  for (const ship of ships) {
    const dx = ship.x - position[0], dz = ship.z - position[2], range = Math.hypot(dx, dz);
    if (range < 1 || range > INTENT_REACH_M) continue;
    const cos = (dx * vx + dz * vz) / (range * speed);
    if (cos < Math.cos(INTENT_CONE_RAD)) continue;
    const releaseSeconds = Math.max(0, (range - RELEASE_RANGE_M[type]) / (speed * cos));
    if (!best || releaseSeconds < best.releaseSeconds) best = { shipId: ship.id, name: ship.name, rangeM: range, releaseSeconds };
  }
  return best;
}

/** What each reported air group carries and where it is going. Payload is read
 * only off current sightings; a group seen wholly after release draws no intent. */
export function airStrikes(clusters: readonly AirCluster[], tracks: readonly ContactTrack[], observed: readonly ObservedAircraft[], tick: number, ships: readonly OwnShipPoint[]): AirStrike[] {
  return clusters.map(cluster => {
    const members = cluster.trackIds.flatMap(id => tracks.find(t => t.id === id) ?? []);
    const loads = members.map(t => reportState(t, tick) === 'current' ? observed.find(o => o.id === t.id)?.payload : undefined);
    const carrying = loads.filter(l => l === true).length, released = loads.filter(l => l === false).length;
    const unobserved = members.length - carrying - released;
    const lead = members.reduce<ContactTrack | undefined>((a, b) => !a || b.lastObservedTick > a.lastObservedTick ? b : a, undefined);
    const spent = cluster.type !== 'fighter' && released > 0 && carrying === 0 && unobserved === 0;
    const intent = cluster.stale || spent || !lead ? undefined : inferredTarget(cluster.position, lead.velocity, cluster.type, ships);
    return { cluster, carrying, released, unobserved, intent };
  });
}

/** The load in words: "3 carrying", "2 carrying · 1 released", "load unobserved". Fighters carry nothing to report. */
export function loadLabel(strike: AirStrike): string | undefined {
  if (strike.cluster.type === 'fighter') return undefined;
  const parts = [strike.carrying > 0 && `${strike.carrying} carrying`, strike.released > 0 && `${strike.released} released`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'load unobserved';
}
/** A strike still threatens a ship while any plane may still be carrying. */
export const threatens = (strike: AirStrike): strike is AirStrike & { intent: StrikeIntent } => !!strike.intent && strike.carrying + strike.unobserved > 0;
