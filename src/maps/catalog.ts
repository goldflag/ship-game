import { islandRim, sampleTerrain } from './terrain';
export { islandRim } from './terrain';
import source from '../../assets/maps/environments.v1.json';

export type OceanMapId = 'north-atlantic' | 'pacific-islands' | 'arctic-passage' | 'indian-volcanic-coast';
export interface IslandRecipe { id: string; side: number; offset: number; along: number; rx: number; rz: number; height: number; seed: number; }
export interface Island extends IslandRecipe { x: number; z: number; style: string; }
export type OceanMap = Omit<typeof source.maps[number], 'id'> & { id: OceanMapId };
export const OCEAN_MAPS = source.maps as OceanMap[];
export const DEFAULT_MAP: OceanMapId = 'north-atlantic';
export const isOceanMapId = (id: unknown): id is OceanMapId => OCEAN_MAPS.some(map => map.id === id);
export function oceanMap(id: OceanMapId = DEFAULT_MAP): OceanMap {
  const map = OCEAN_MAPS.find(map => map.id === id);
  if (!map) throw new Error('Choose an available ocean map.');
  return map;
}

/** Widen the central shipping lane for large fleets; both deployment lines stay offshore. */
export function mapIslands(id: OceanMapId, spawnDistance: number, teamSize: number): Island[] {
  const lane = Math.max(2100, Math.ceil((teamSize - 1) / 2) * 650 + 1000);
  const land = oceanMap(id).land;
  return land.islands.map(island => ({ ...island, style: land.style,
    x: island.side * (lane + island.rx * 1.25 + island.offset), z: -spawnDistance / 2 + island.along }));
}
export function islandRadius(island: Island, x: number, z: number): number {
  const dx = (x - island.x) / island.rx, dz = (z - island.z) / island.rz;
  return Math.hypot(dx, dz) / islandRim(Math.atan2(dz, dx), island.seed);
}
export function islandHeight(island: Island, x: number, z: number): number {
  return sampleTerrain(island, (x-island.x)/island.rx, (z-island.z)/island.rz);
}
export function landHeight(islands: readonly Island[], x: number, z: number): number {
  return islands.reduce((height, island) => Math.max(height, islandHeight(island, x, z)), -45);
}
export function coastOutline(island: Island, count = 192): [number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2, r = islandRim(angle, island.seed);
    return [island.x + Math.cos(angle) * island.rx * r, island.z + Math.sin(angle) * island.rz * r];
  });
}
