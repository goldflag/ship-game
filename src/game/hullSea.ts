import type { ShipDefinition } from '../ships/blueprint';
import type { HullFootprint } from './ocean/contracts';
import { HULL_SEA_SLOTS } from './ocean/waves/hullSea';
import { wakeHull } from './wakeHull';

/** A drawn hull as the sea around it reads it: a simulated view's interpolated pose or an observed exterior's. */
export interface SeaHull {
  motion: { x: number; y: number; z: number; heading: number; waveHeave?: number };
  definition: Pick<ShipDefinition, 'hull'> & { submarine?: Pick<NonNullable<ShipDefinition['submarine']>, 'periscopeEye'> };
}

const extents = new WeakMap<object, ReturnType<typeof wakeHull>>();
const smooth = (edge0: number, edge1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/** How much of a hull reaches the surface, 0–1: all of it while its highest point (a submarine's periscope head, a
 * ship's deck edge) stands above the still-water line, none once that point is deeper than the sea's `amplitude` and a
 * metre more, below every trough. A submerged submarine or a wreck going down leaves the sea as drawn. */
export function surfaceContact(hull: SeaHull, amplitude: number): number {
  const { motion, definition } = hull;
  const top = definition.submarine ? definition.submarine.periscopeEye[1] : Math.max(1, definition.hull.depth - definition.hull.draft);
  const mean = motion.y - (motion.waveHeave ?? 0);
  return smooth(-(Math.max(0, amplitude) + 1), 0, mean + top);
}

/** The drawn hulls the sea around them follows: the nearest `slots` to `camera`, their waterplanes' centres and bow
 * bearings in the ocean's frame. With more hulls than slots, those near the cut fade out, so a hull joining or
 * leaving the set as the camera moves does not pop. `amplitude` is the sea's (m), for submarines' contact. */
export function hullFootprints(hulls: readonly SeaHull[], camera: { x: number; z: number }, amplitude: number, slots = HULL_SEA_SLOTS): HullFootprint[] {
  const ranked = hulls.filter(hull => Number.isFinite(hull.motion.x) && Number.isFinite(hull.motion.z))
    .map(hull => ({ hull, distance: Math.hypot(hull.motion.x - camera.x, hull.motion.z - camera.z) }))
    .sort((a, b) => a.distance - b.distance);
  const cut = ranked.length > slots ? ranked[slots].distance : Infinity;
  return ranked.slice(0, slots).map(({ hull, distance }) => {
    let shape = extents.get(hull.definition.hull);
    if (!shape) { shape = wakeHull(hull.definition.hull); extents.set(hull.definition.hull, shape); }
    // Heading is clockwise from north (−Z); a local point (x, z) lies at (cos·x − sin·z, sin·x + cos·z) from the origin.
    const { x, z, heading } = hull.motion, cos = Math.cos(heading), sin = Math.sin(heading);
    const rank = cut === Infinity ? 1 : 1 - smooth(.75 * cut, cut, distance);
    return { x: x + cos * shape.centerX - sin * shape.centerZ, z: z + sin * shape.centerX + cos * shape.centerZ,
      bearing: Math.atan2(-cos, sin), length: shape.length, beam: shape.beam, contact: surfaceContact(hull, amplitude) * rank };
  });
}
