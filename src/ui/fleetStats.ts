import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import { GAMEPLAY_AIRCRAFT, type AircraftRole, type Vec3 } from '../ships/blueprint';
import { reportPosition } from './reconReports';
import { aircraftShortName } from './aircraftNames';

export type ObservedAircraftType = AircraftRole | 'unknown';
/** Observers report the airframe type once evidence is strong; nothing else. */
export function observedAircraftType(classification: string | null | undefined): ObservedAircraftType {
  return classification === 'Fighter' ? 'fighter' : classification === 'Dive bomber' ? 'dive-bomber' : classification === 'Torpedo bomber' ? 'torpedo-bomber' : 'unknown';
}
export const aircraftTypeLabel = (type: ObservedAircraftType, count = 1): string =>
  `${count} ${type === 'fighter' ? (count === 1 ? 'fighter' : 'fighters') : type === 'dive-bomber' ? (count === 1 ? 'dive bomber' : 'dive bombers') : type === 'torpedo-bomber' ? (count === 1 ? 'torpedo bomber' : 'torpedo bombers') : 'aircraft'}`;

export interface AirCluster { id: string; type: ObservedAircraftType; label: string; model?: string; count: number; position: Vec3; heading: number; trackIds: string[]; smoking: number; lastObservedTick: number; stale: boolean }
export interface ObservedModel { id: string; modelId: string }
/** The observer's classification names the type; a recognised exterior can add the model. */
export function reportedAircraftType(track: ContactTrack, observed?: readonly ObservedModel[]): { type: ObservedAircraftType; model?: string } {
  const modelId = observed?.find(o => o.id === track.id)?.modelId;
  const classified = observedAircraftType(track.classification);
  return { type: classified !== 'unknown' ? classified : modelId ? GAMEPLAY_AIRCRAFT[modelId] ?? 'unknown' : 'unknown', model: aircraftShortName(modelId) };
}
/** Reported aircraft flying together read as one group on the chart and in the
 * enemy list; each plane still keeps its own marker. */
export function airClusters(tracks: readonly ContactTrack[], tick: number, radiusM = 900, observed?: readonly ObservedModel[]): AirCluster[] {
  const aircraft = tracks.filter(t => t.kind === 'aircraft').map(t => ({ track: t, position: reportPosition(t, tick), ...reportedAircraftType(t, observed) }));
  const clusters: { members: typeof aircraft }[] = [];
  for (const plane of aircraft) {
    const near = clusters.find(c => c.members[0].type === plane.type && c.members.some(m => Math.hypot(m.position[0] - plane.position[0], m.position[2] - plane.position[2]) <= radiusM));
    if (near) near.members.push(plane); else clusters.push({ members: [plane] });
  }
  return clusters.map(({ members }) => {
    const n = members.length;
    const position = members.reduce<Vec3>((sum, m) => [sum[0] + m.position[0] / n, sum[1] + m.position[1] / n, sum[2] + m.position[2] / n], [0, 0, 0]);
    const lead = members.reduce((a, b) => b.track.lastObservedTick > a.track.lastObservedTick ? b : a);
    const [vx, , vz] = lead.track.velocity;
    const model = members.map(m => m.model).find(Boolean);
    return { id: `air-${members.map(m => m.track.id).sort().join('+')}`, type: lead.type, label: aircraftTypeLabel(lead.type, n), model, count: n, position, heading: Math.atan2(vx, -vz),
      trackIds: members.map(m => m.track.id), smoking: members.filter(m => m.track.visibleCondition?.fire || m.track.visibleCondition?.heavySmoke).length,
      lastObservedTick: lead.track.lastObservedTick, stale: members.every(m => m.track.status === 'stale' || m.track.status === 'lost') };
  });
}

export interface OwnShipRecord { id: string; massKg: number; integrity: number; maxIntegrity: number; lost: boolean }
export interface ComparisonInput {
  own: readonly OwnShipRecord[];
  scores?: Record<string, { damageDealt: number; frags: number }>;
  tracks: readonly ContactTrack[];
  massOf(presetId: string): number;
  enemyLostShips?: number;
  ownAircraft: { remaining: number; total: number };
  enemyAircraftLost?: number;
}
export interface BattleComparison {
  damageDealt: [number, number];
  tonnageAfloat: [number, number];
  unidentified: number;
  aircraft: { own: [number, number]; enemySeen: number; enemyLost: number };
  shipsLost: [number, number];
}
/** Our column is exact. Theirs is built only from what observers reported:
 * spotted hulls, confirmed sinkings and aircraft seen falling. */
export function battleComparison(input: ComparisonInput): BattleComparison {
  const surface = input.tracks.filter(t => t.kind === 'surface' && !t.visibleCondition?.sinking);
  const identified = surface.filter(t => t.identifiedPresetId);
  const confirmedSunk = input.tracks.filter(t => t.kind === 'surface' && t.visibleCondition?.sinking).length;
  return {
    damageDealt: [Math.round(input.own.reduce((n, s) => n + (input.scores?.[s.id]?.damageDealt ?? 0), 0)), Math.round(input.own.reduce((n, s) => n + (s.lost ? s.maxIntegrity : Math.max(0, s.maxIntegrity - s.integrity)), 0))],
    tonnageAfloat: [input.own.filter(s => !s.lost).reduce((n, s) => n + s.massKg, 0), identified.reduce((n, t) => n + input.massOf(t.identifiedPresetId!), 0)],
    unidentified: surface.length - identified.length,
    aircraft: { own: [input.ownAircraft.remaining, input.ownAircraft.total], enemySeen: input.tracks.filter(t => t.kind === 'aircraft' && t.status !== 'stale' && t.status !== 'lost').length, enemyLost: input.enemyAircraftLost ?? 0 },
    shipsLost: [input.own.filter(s => s.lost).length, Math.max(confirmedSunk, input.enemyLostShips ?? 0)],
  };
}

/** Marker opacity from the ship's on-screen length: full when the model is a
 * speck, gone once the hull itself is readable. */
export function markerOpacity(pixelLength: number, fadeStart = 24, fadeEnd = 48): number {
  return Math.max(0, Math.min(1, (fadeEnd - pixelLength) / (fadeEnd - fadeStart)));
}
