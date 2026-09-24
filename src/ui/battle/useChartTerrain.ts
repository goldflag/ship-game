import { useEffect, useState } from 'react';
import { loadMapTerrain, placedMapTerrain, type OceanMapId } from '../../maps/catalog';
import type { PlacedTerrain } from '../../maps/heightfield';

/** The map's land laid at `offset`, for a chart: undefined while its heightfield loads (the component renders again
 * when it arrives) or after the load failed, which `error` then names until `retry`. Choosing the map starts the load,
 * so the coast is usually charted before the fleet reaches the deployment chart. */
export function useChartTerrain(mapId: OceanMapId, offset: readonly [number, number]): { terrain?: PlacedTerrain; error?: string; retry(): void } {
  const [failure, setFailure] = useState<{ mapId: OceanMapId; message: string }>();
  const [attempt, setAttempt] = useState(0);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    let live = true;
    setFailure(undefined);
    loadMapTerrain(mapId).then(
      () => { if (live) setLoaded(count => count + 1); },
      (error: unknown) => { if (live) setFailure({ mapId, message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { live = false; };
  }, [mapId, attempt]);
  const terrain = placedMapTerrain(mapId, offset);
  const error = !terrain && failure?.mapId === mapId ? failure.message : undefined;
  return { terrain, error, retry: () => { if (error) setAttempt(count => count + 1); } };
}
