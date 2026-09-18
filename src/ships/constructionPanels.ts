import type { ConstructionPrimitive, ConstructionSurfaceAssignment } from './blueprint';
import { contourAt, hullEdgeFace, hullEdgeId } from './customHullTopology';
export type HullPanel = Pick<ConstructionSurfaceAssignment, 'face' | 'panelId'>;
/** Stable section IDs keep assignments attached through movement and resizing.
 * A changed section adjacency makes a new panel, inheriting its side default. */
export function customHullPanels(primitive: ConstructionPrimitive): HullPanel[] {
  const stations = primitive.customHull?.stations;
  if (primitive.kind !== 'custom-hull' || !stations) return [];
  return [...stations.slice(0, -1).flatMap((station, i) => station.points.map((_, edge) => {
    const start = contourAt(station.points, edge), end = edge === station.points.length - 1 ? 9 : contourAt(station.points, edge + 1);
    return { face: hullEdgeFace(start, end), panelId: `${hullEdgeId(start, end)}@${JSON.stringify([station.id, stations[i + 1].id])}` };
  })), { face: 'bow', panelId: 'bow' }, { face: 'stern', panelId: 'stern' }];
}
export function mirroredPanelId(panelId?: string): string | undefined {
  if (!panelId || !panelId.includes('@')) return panelId;
  const edge = panelId.slice(0, panelId.indexOf('@'));
  const [start, end] = edge.includes('~') ? edge.split('~').map(Number) : [Number(edge), Number(edge) + 1];
  return `${start === 8 ? '8' : hullEdgeId(8 - end, 8 - start)}${panelId.slice(panelId.indexOf('@'))}`;
}
