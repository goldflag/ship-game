import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Pose } from './geometry';

/** Encloses the existing shell/hull broad-phase box under any heading/list/trim. */
export function shellHullRadius(definition: ShipDefinition): number {
  return Math.hypot((definition.hull.beam + 30) / 2, 40, (definition.hull.length + 40) / 2);
}

/** Conservative world-space rejection before expensive ship-local transforms.
 * Keep the complete segment, so fast shells crossing a hull cannot tunnel.
 */
export function mayReachHull(from: Vec3, to: Vec3, pose: Pose, radius: number): boolean {
  return Math.min(from[0], to[0]) <= pose.x + radius && Math.max(from[0], to[0]) >= pose.x - radius
    && Math.min(from[1], to[1]) <= pose.y + radius && Math.max(from[1], to[1]) >= pose.y - radius
    && Math.min(from[2], to[2]) <= pose.z + radius && Math.max(from[2], to[2]) >= pose.z - radius;
}
