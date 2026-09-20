import { MIN_SHIP_SEPARATION_M } from '../game/session/battleSetup';
import type { Placement } from '../multiplayer/generated/Placement';
import { moveFormation } from './pveSetup';

export interface DeploymentPoint { x: number; z: number }
export interface DeploymentView { center: DeploymentPoint; zoom: number }

export function formationCenter(placements: readonly Placement[], selected: readonly string[]): DeploymentPoint | undefined {
  const moving = placements.filter(p => selected.includes(p.id));
  if (!moving.length) return;
  return { x: moving.reduce((sum, p) => sum + p.spawn.x, 0) / moving.length,
    z: moving.reduce((sum, p) => sum + p.spawn.z, 0) / moving.length };
}

/** Every ship holds a clear berth: no gesture may close the gap to another ship below
 * MIN_SHIP_SEPARATION_M, so the chart never has to report the crowding afterwards.
 * A berth that is already crowded still lets its ships move, as long as they open the gap
 * rather than close it — otherwise a setup saved under an older rule would be stuck. */
export function berthsClear(before: readonly Placement[], after: readonly Placement[], moving: readonly string[]): boolean {
  const gap = (a: Placement, b: Placement) => Math.hypot(a.spawn.x - b.spawn.x, a.spawn.z - b.spawn.z);
  const selected = new Set(moving), started = new Map(before.map(ship => [ship.id, ship]));
  for (const ship of after) {
    if (!selected.has(ship.id)) continue;
    for (const other of after) {
      if (other.id === ship.id || selected.has(other.id) || gap(ship, other) >= BERTH_CLEARANCE_M) continue;
      const was = started.get(ship.id), stood = started.get(other.id);
      if (!was || !stood || gap(ship, other) < gap(was, stood)) return false;
    }
  }
  return true;
}
/** A committed custom deployment snaps to a 10 m grid, which can shave up to
 * hypot(5, 5) m off a gap the gesture measured exactly. Stopping this much outside the
 * rim — a fraction of a pixel on the chart — keeps the committed positions clear too. */
const COMMIT_SNAP_M = Math.hypot(5, 5) + .01;
/** Where a gesture actually comes to rest: the drawn rim plus that snapping allowance. */
export const BERTH_CLEARANCE_M = MIN_SHIP_SEPARATION_M + COMMIT_SNAP_M;
/** Enough halvings to settle within a metre of the rim across the whole 80 km chart. */
const BERTH_STEPS = 18;
/** Run a gesture as far as the berths allow: the whole move when it lands clear, otherwise
 * the last clear fraction of it, so the selection slides up to the circle and stops there. */
export function limitToBerths<T extends Placement>(placements: T[], selected: readonly string[], at: (fraction: number) => T[]): T[] {
  const full = at(1);
  if (berthsClear(placements, full, selected)) return full;
  let clear = 0, blocked = 1;
  for (let step = 0; step < BERTH_STEPS; step++) {
    const middle = (clear + blocked) / 2;
    if (berthsClear(placements, at(middle), selected)) clear = middle; else blocked = middle;
  }
  return clear > 0 ? at(clear) : placements;
}
/** Every preview starts from the grabbed formation, so dragging never accumulates error. */
export function dragFormation<T extends Placement>(placements: T[], selected: readonly string[], start: DeploymentPoint, point: DeploymentPoint): T[] {
  const center = formationCenter(placements, selected);
  if (!center) return placements;
  const dx = point.x - start.x, dz = point.z - start.z;
  return limitToBerths(placements, selected, fraction => moveFormation(placements, selected, center.x + dx * fraction, center.z + dz * fraction));
}
/** A drop or an arrow-key nudge lands the selection on a point, stopping short of a taken berth. */
export function placeFormation<T extends Placement>(placements: T[], selected: readonly string[], x: number, z: number, turn = 0): T[] {
  const center = formationCenter(placements, selected);
  if (!center) return placements;
  return limitToBerths(placements, selected, fraction =>
    moveFormation(placements, selected, center.x + (x - center.x) * fraction, center.z + (z - center.z) * fraction, turn * fraction));
}

/** Snap rounds the turn to whole steps (radians), so a ring drag lands on readable headings. */
export function rotateFormation<T extends Placement>(placements: T[], selected: readonly string[], start: DeploymentPoint, point: DeploymentPoint, snap = 0): T[] {
  const center = formationCenter(placements, selected);
  if (!center || Math.hypot(point.x - center.x, point.z - center.z) < 1) return placements;
  let angle = Math.atan2(point.z - center.z, point.x - center.x) - Math.atan2(start.z - center.z, start.x - center.x);
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (snap > 0) angle = Math.round(angle / snap) * snap;
  if (angle === 0) return placements;
  return limitToBerths(placements, selected, fraction => moveFormation(placements, selected, center.x, center.z, angle * fraction));
}

/** Zoom 1 fits the whole battle area on the chart's shorter axis; below it the
 * player can pull back far enough to see the sea around the boundary. */
export const MIN_DEPLOYMENT_ZOOM = .35;
export const MAX_DEPLOYMENT_ZOOM = 8;

/** Keep the world point under the cursor fixed while changing scale. */
export function zoomDeployment(view: DeploymentView, anchor: DeploymentPoint, wheelDelta: number): DeploymentView {
  const zoom = Math.max(MIN_DEPLOYMENT_ZOOM, Math.min(MAX_DEPLOYMENT_ZOOM, view.zoom * Math.exp(-Math.max(-240, Math.min(240, wheelDelta)) * .002)));
  const ratio = view.zoom / zoom;
  return { zoom, center: { x: anchor.x + (view.center.x - anchor.x) * ratio, z: anchor.z + (view.center.z - anchor.z) * ratio } };
}
