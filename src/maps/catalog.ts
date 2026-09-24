/** The battle maps: open sea and real places where naval battles were fought
 * (`assets/maps/environments.v1.json`; framing and data in `assets/maps/terrain-notes.md`).
 * A map with land names its baked heightfield (`./heightfield.ts`); a battle places that
 * chart in its own world frame, and everything that reads the land reads that one surface. */
import source from '../../assets/maps/environments.v1.json';
import { OPEN_SEA, cachedHeightfield, loadHeightfield, type Heightfield, type PlacedTerrain } from './heightfield';

export type OceanMapId = 'north-atlantic' | 'iron-bottom-sound' | 'vestfjord' | 'sunda-strait' | 'strait-of-dover';
export interface OceanMap {
  id: OceanMapId;
  name: string;
  region: string;
  /** True bearing of the chart's top, degrees clockwise from north: true north lies this far
   * counter-clockwise from chart up. The game frame is the chart's (x right, z down). */
  bearing: number;
  /** The actions fought in these waters, with their dates; open sea has none. */
  battle?: string;
  description: string;
  /** `windDirection` is in the chart frame, as the simulation reads it. */
  water: { waterColor: string; transmissionColor: string; absorptionColor: string; amplitudeScale: number; windScale: number; wavelengthScale: number; windDirection: number; foam: number };
  /** `azimuth` is a true direction in the sky's convention (`celestialModel.ts`): the battle environment turns it into the chart frame. */
  sky: { elevation: number; azimuth: number; intensity: number; coverage: number; altitude: number; thickness: number; turbidity: number; rayleigh: number; mie: number; mieG: number; multiple: number; ambient: number };
  fog: { color: string; start: number; end: number; skyBlend: number };
  /** `terrain` names `public/maps/terrain/<id>.ntf`; null is open sea. */
  land: { style: 'rock' | 'tropical' | 'snow' | 'volcanic' | 'chalk'; shore: string; low: string; high: string; terrain: string | null };
}
export const OCEAN_MAPS = source.maps as OceanMap[];
export const DEFAULT_MAP: OceanMapId = 'north-atlantic';
export const isOceanMapId = (id: unknown): id is OceanMapId => OCEAN_MAPS.some(map => map.id === id);
export function oceanMap(id: OceanMapId = DEFAULT_MAP): OceanMap {
  const map = OCEAN_MAPS.find(map => map.id === id);
  if (!map) throw new Error('Choose an available ocean map.');
  return map;
}
/** The first action a map records, with its date ("Channel Dash, 12 February 1942"); undefined for open sea. */
export const mapAction = (map: OceanMap): string | undefined => map.battle?.split(' · ')[0];
/** The map's baked heightfield, or undefined for open sea. */
export const mapTerrainId = (id: OceanMapId): string | undefined => oceanMap(id).land.terrain ?? undefined;

/** A spawn needs this much clear water to every land sample, metres. The Rust battle checks the same radius. */
export const DEPLOYMENT_CLEARANCE_M = 300;
/** Custom and online battles centre the chart between the default spawn lines, which run from z = 0 to −spawnDistance. */
export const customTerrainOffset = (spawnDistance: number): readonly [number, number] => [0, -spawnDistance / 2];
/** Missions centre the chart on the mission area. */
export const MISSION_TERRAIN_OFFSET: readonly [number, number] = [0, 0];
/** Where a battle with this setup places its chart. */
export const battleTerrainOffset = (setup: { spawnDistance: number; missionRules?: unknown }): readonly [number, number] =>
  setup.missionRules ? MISSION_TERRAIN_OFFSET : customTerrainOffset(setup.spawnDistance);

/** Fetch and decode the map's heightfield once per page; resolves undefined for open sea. */
export async function loadMapTerrain(id: OceanMapId): Promise<Heightfield | undefined> {
  const terrain = mapTerrainId(id);
  return terrain ? loadHeightfield(terrain) : undefined;
}
/** The map's land placed at `offset`, synchronously: `OPEN_SEA` for open sea, undefined while its heightfield has not loaded. */
export function placedMapTerrain(id: OceanMapId, offset: readonly [number, number]): PlacedTerrain | undefined {
  const terrain = mapTerrainId(id);
  if (!terrain) return OPEN_SEA;
  const field = cachedHeightfield(terrain);
  return field && { field, offset };
}

/** A chart-frame bearing (degrees clockwise from chart up) as the true bearing a compass reads on this map. */
export const trueBearing = (chartDegrees: number, mapBearing: number): number => (((chartDegrees + mapBearing) % 360) + 360) % 360;
/** How a chart with this bearing lies, for its readers: which way is up, and where north is. */
export const chartUp = (mapBearing: number): string => mapBearing ? `${String(mapBearing).padStart(3, '0')}° up` : 'North up';
export const northFromUp = (mapBearing: number): string =>
  !mapBearing ? 'north up' : mapBearing <= 180 ? `north ${mapBearing}° left of up` : `north ${360 - mapBearing}° right of up`;

