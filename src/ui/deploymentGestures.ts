import type { Placement } from '../multiplayer/generated/Placement';
import { moveFormation } from './pveSetup';

export interface DeploymentPoint { x: number; z: number }
export interface DeploymentView { center: DeploymentPoint; zoom: number }

export function formationCenter(placements: Placement[], selected: string[]): DeploymentPoint | undefined {
  const moving = placements.filter(p => selected.includes(p.id));
  if (!moving.length) return;
  return { x: moving.reduce((sum, p) => sum + p.spawn.x, 0) / moving.length,
    z: moving.reduce((sum, p) => sum + p.spawn.z, 0) / moving.length };
}

/** Every preview starts from the grabbed formation, so dragging never accumulates error. */
export function dragFormation(placements: Placement[], selected: string[], start: DeploymentPoint, point: DeploymentPoint): Placement[] {
  const center = formationCenter(placements, selected);
  return center ? moveFormation(placements, selected, center.x + point.x - start.x, center.z + point.z - start.z) : placements;
}

export function rotateFormation(placements: Placement[], selected: string[], start: DeploymentPoint, point: DeploymentPoint): Placement[] {
  const center = formationCenter(placements, selected);
  if (!center || Math.hypot(point.x - center.x, point.z - center.z) < 1) return placements;
  const angle = Math.atan2(point.z - center.z, point.x - center.x) - Math.atan2(start.z - center.z, start.x - center.x);
  return moveFormation(placements, selected, center.x, center.z, Math.atan2(Math.sin(angle), Math.cos(angle)));
}

/** Keep the world point under the cursor fixed while changing scale. */
export function zoomDeployment(view: DeploymentView, anchor: DeploymentPoint, wheelDelta: number): DeploymentView {
  const zoom = Math.max(1, Math.min(8, view.zoom * Math.exp(-Math.max(-240, Math.min(240, wheelDelta)) * .002)));
  const ratio = view.zoom / zoom;
  return { zoom, center: { x: anchor.x + (view.center.x - anchor.x) * ratio, z: anchor.z + (view.center.z - anchor.z) * ratio } };
}
