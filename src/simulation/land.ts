import { islandRadius, islandRim, landHeight, type Island } from '../maps/catalog';
import type { FleetActor } from './battle';
import type { Vec3 } from '../ships/blueprint';
import { clamp, wrapAngle } from './geometry';
import type { HelmCommand } from './ship';

/** Conservative hull clearance. No grounding damage: contact removes inward motion. */
export function resolveLandContact(actor: FleetActor, islands: readonly Island[]): void {
  const ship = actor.motion, clearance = actor.definition.hull.length / 2 + 25;
  for (const island of islands) {
    const dx = ship.x - island.x, dz = ship.z - island.z, angle = Math.atan2(dz / island.rz, dx / island.rx);
    const rim = islandRim(angle, island.seed), rx = island.rx * rim + clearance, rz = island.rz * rim + clearance;
    const radius = Math.hypot(dx / rx, dz / rz);
    if (radius >= 1) continue;
    const nx = radius > 1e-6 ? dx / radius : rx, nz = radius > 1e-6 ? dz / radius : 0;
    ship.x = island.x + nx * 1.001; ship.z = island.z + nz * 1.001;
    const forwardX = Math.sin(ship.heading), forwardZ = -Math.cos(ship.heading);
    if ((forwardX * dx + forwardZ * dz) * ship.speed < 0 || radius < .01) ship.speed = 0;
    ship.swaySpeed = 0;
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
    return { throttle: .4, rudder: Math.abs(rudder) < .05 ? 1 : rudder };
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
