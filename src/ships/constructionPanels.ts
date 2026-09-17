import type { ConstructionPrimitive, ConstructionSurfaceAssignment } from './blueprint';
export type HullPanel = Pick<ConstructionSurfaceAssignment, 'face' | 'panelId'>;
const faceOf = (edge: number): HullPanel['face'] => edge < 3 ? 'port' : edge < 5 ? 'bottom' : edge < 8 ? 'starboard' : 'top';
/** Stable section IDs keep assignments attached through movement and resizing.
 * A changed section adjacency makes a new panel, inheriting its side default. */
export function customHullPanels(primitive: ConstructionPrimitive): HullPanel[] {
  const stations = primitive.customHull?.stations;
  if (primitive.kind !== 'custom-hull' || !stations) return [];
  return [...stations.slice(0, -1).flatMap((station, i) => Array.from({ length: 9 }, (_, edge) => ({ face: faceOf(edge), panelId: `${edge}@${JSON.stringify([station.id, stations[i + 1].id])}` }))), { face: 'bow', panelId: 'bow' }, { face: 'stern', panelId: 'stern' }];
}
export function mirroredPanelId(panelId?: string): string | undefined {
  if (!panelId || !panelId.includes('@')) return panelId;
  const edge = Number(panelId.slice(0, panelId.indexOf('@')));
  return `${edge === 8 ? 8 : 7 - edge}${panelId.slice(panelId.indexOf('@'))}`;
}
