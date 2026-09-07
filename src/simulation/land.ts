import { islandRadius, landHeight, type Island } from '../maps/catalog';
import type { FleetActor } from './battle';
import type { Vec3 } from '../ships/blueprint';
import { clamp, wrapAngle, localToWorld } from './geometry';
import { motionVelocity, type HelmCommand } from './ship';
import { interpolate } from './hull';
import { damageHullContact, type HullImpact } from './contactDamage';

/** Sample keel stations against the same sloping seabed used by the map.
 * Draft and heading matter; the deep ocean remains navigable to submarines. */
export function resolveLandContact(actor: FleetActor, islands: readonly Island[], emit?: (impact: HullImpact) => void): void {
  const ship = actor.motion, hull = actor.definition.hull;
  for (const island of islands) {
    if (Math.hypot((ship.x - island.x) / (island.rx + hull.length), (ship.z - island.z) / (island.rz + hull.length)) > 1.3) continue;
    // Extend the authored shore slope into deep water. The visual terrain's
    // -45 m clipping floor is not a global submarine depth limit.
    const bottom = (x: number, z: number) => islandRadius(island, x, z) >= 1
      ? Math.max(-1000, (1 - islandRadius(island, x, z)) * 500) : landHeight([island], x, z);
    const points = hull.keelHeights.flatMap(([station, keel]) => [-.6, 0, .6].map(side =>
      localToWorld([side * interpolate(hull.halfBreadths, station), keel, hull.length / 2 - station], ship)));
    const hits = points.filter(point => bottom(point[0], point[2]) >= point[1]);
    if (!hits.length) continue;
    const position = hits[0];
    const dx = position[0] - island.x, dz = position[2] - island.z, distance = Math.hypot(dx, dz);
    const nx = distance > 1e-6 ? dx / distance : 1, nz = distance > 1e-6 ? dz / distance : 0;
    const velocity = motionVelocity(ship);
    const inward = -(velocity[0] * nx + velocity[2] * nz);
    if (inward > .75) {
      const damage = damageHullContact(actor, position, .5 * hull.massKg * inward ** 2);
      if (damage > 0) emit?.({ actor, position, damage, kind: 'grounding' });
    }
    if (inward > 0) { ship.speed = 0; ship.swaySpeed = 0; }
    // Move to the closest safe position along the outward direction. The
    // search includes keel depth, so shallow-draft ships approach more closely.
    const clear = (offset: number) => points.every(p => bottom(p[0] + nx * offset, p[2] + nz * offset) < p[1] - .02);
    let low = 0, high = Math.max(island.rx, island.rz) * 3 + hull.length;
    for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (clear(mid)) high = mid; else low = mid; }
    ship.x += nx * high; ship.z += nz * high;
  }
}

/** Blend an outward course into the bot's intended route before it reaches shore. */
export function avoidLand(actor: FleetActor, command: HelmCommand, islands: readonly Island[]): HelmCommand {
  const ship = actor.motion;
  for (const island of islands) {
    const look = Math.max(650, Math.abs(ship.speed) * 50);
    const x = ship.x + Math.sin(ship.heading) * look, z = ship.z - Math.cos(ship.heading) * look;
    if (islandRadius(island, x, z) > 1.3 && islandRadius(island, ship.x, ship.z) > 1.2) continue;
    const away = Math.atan2(ship.x - island.x, island.z - ship.z);
    const rudder = clamp(wrapAngle(away - ship.heading) * 2, -1, 1);
    return { ...command, throttle: .4, rudder: Math.abs(rudder) < .05 ? 1 : rudder };
  }
  return command;
}

/** Swept terrain query, refined to the first intersection. Shared by shells and torpedoes. */
export function firstLandHit(islands: readonly Island[], from: Vec3, to: Vec3): { t: number; point: Vec3 } | undefined {
  if (!islands.length) return;
  const near = islands.filter(island => Math.min(from[0], to[0]) <= island.x + island.rx * 1.2 && Math.max(from[0], to[0]) >= island.x - island.rx * 1.2
    && Math.min(from[2], to[2]) <= island.z + island.rz * 1.2 && Math.max(from[2], to[2]) >= island.z - island.rz * 1.2);
  if (!near.length) return;
  const point = (t: number): Vec3 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
  const solid = (p: Vec3) => p[1] <= landHeight(near, p[0], p[2]);
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 20));
  if (solid(from)) return { t: 0, point: [...from] };
  for (let i = 1; i <= steps; i++) if (solid(point(i / steps))) {
    let a = (i - 1) / steps, b = i / steps;
    for (let j = 0; j < 16; j++) { const mid = (a + b) / 2; if (solid(point(mid))) b = mid; else a = mid; }
    return { t: b, point: point(b) };
  }
}
