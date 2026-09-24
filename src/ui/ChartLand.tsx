import { chartContours } from '../maps/chartContours';
import type { PlacedTerrain } from '../maps/heightfield';

/** The battle's coastline and relief on a chart: the land, then each elevation band drawn over it, traced from the
 * same heightfield ships ground on (`chartContours`). Paths are in chart metres; the default transform lays them in the
 * battle's world by its placement offset, and a chart drawn at another scale passes its own. */
export function ChartLand({ terrain, transform }: { terrain?: PlacedTerrain; transform?: string }) {
  if (!terrain?.field) return null;
  return (
    <g className="chart-coast" transform={transform ?? `translate(${terrain.offset[0]} ${terrain.offset[1]})`}>
      {chartContours(terrain.field).map(({ level, path }) => (
        <path key={level} d={path} fillRule="evenodd" className={level ? `chart-relief chart-relief-${level}` : 'chart-land'}>
          <title>{level ? `Land above ${level} m` : 'Coastline'}</title>
        </path>
      ))}
    </g>
  );
}
