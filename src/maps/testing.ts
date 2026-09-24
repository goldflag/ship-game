/** Test seam: the real baked maps, decoded from `public/maps/terrain` and installed as if the page had loaded them. */
import { decodeHeightfield, setHeightfield, type Heightfield } from './heightfield';
import { mapTerrainId, type OceanMapId } from './catalog';

const decoded = new Map<string, Promise<Heightfield>>();
/** Decode the map's baked heightfield once per test file and install it for `loadMapTerrain` and `placedMapTerrain`. */
export async function installMapTerrain(mapId: OceanMapId): Promise<Heightfield> {
  const id = mapTerrainId(mapId);
  if (!id) throw new Error(`${mapId} is open sea.`);
  let field = decoded.get(id);
  if (!field) {
    field = Bun.file(new URL(`../../public/maps/terrain/${id}.ntf`, import.meta.url)).arrayBuffer().then(bytes => decodeHeightfield(new Uint8Array(bytes)));
    decoded.set(id, field);
  }
  const installed = await field;
  setHeightfield(id, installed);
  return installed;
}
