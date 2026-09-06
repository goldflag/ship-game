import type { Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { ballisticStep, travelFactor, velocityPenetration } from './ballistics';
import { burstShell } from './burst';
import { resolveShipContact, shipContacts, type DamageEvent, type Shell, type ShipContact } from './damage';
import { add, length, localToWorld, radians, scale, segmentOverlapsBox, sub, worldToLocal } from './geometry';
import { hullContains } from './hull';

export type ProjectileEnd = 'burst' | 'stopped' | 'passed-through' | 'splash' | 'expired';
/** Swept chords remain bounded to a CPU tick. Every contact splits elapsed time,
 * so residual speed and fuze delay affect travel during that same tick. */
export function advanceProjectile(shell: Shell, actors: FleetActor[], dt: number, emit: (event: DamageEvent | { kind: 'splash'; shipId: string; position: Vec3; message: string; shell: Pick<Shell, 'id' | 'caliberM' | 'velocity'> }) => void): ProjectileEnd | undefined {
  const insideHull = (point: Vec3) => actors.some(a => a.motion.id !== shell.ownerId && hullContains(a.definition.hull, worldToLocal(point, a.motion)));
  let remaining = dt;
  for (let iteration = 0; iteration < 64; iteration++) {
    if (shell.lodged) {
      const actor = actors.find(a => a.motion.id === shell.lodged!.shipId);
      if (actor) {
        const index = actor.definition.mounts.findIndex(m => m.id === shell.lodged!.mountId), mount = actor.definition.mounts[index];
        const local = mount ? localToWorld(shell.lodged.position, { x: mount.position[0], y: mount.position[1], z: mount.position[2], heading: radians(mount.bearingDeg) + actor.mounts[index].train, roll: 0, pitch: 0 }) : shell.lodged.position;
        shell.position = localToWorld(local, actor.motion);
      }
    }
    if (shell.detonateAtAge !== undefined && shell.age >= shell.detonateAtAge - 1e-10) {
      burstShell(shell, actors, emit); return 'burst';
    }
    if (remaining <= 1e-10) return;
    if (shell.age >= 180) return 'expired';
    const horizon = Math.min(remaining, 180 - shell.age, shell.detonateAtAge === undefined ? remaining : shell.detonateAtAge - shell.age);
    if (shell.lodged) { shell.age += horizon; remaining -= horizon; continue; }
    const from: Vec3 = [...shell.position];
    if (from[1] <= 0 && !insideHull(from)) return shell.visited.length ? 'passed-through' : 'splash';
    const drag = shell.dragPerSecond ?? 0, flight = ballisticStep(from, shell.velocity, horizon, drag);
    const to = flight.position;
    const fraction = from[1] > 0 && to[1] <= 0 ? from[1] / (from[1] - to[1]) : 1;
    const seaPoint = add(from, scale(sub(to, from), fraction));
    const crossesSea = from[1] > 0 && to[1] <= 0 && !insideHull(seaPoint);
    const end = crossesSea ? seaPoint : to;
    let nearest: { actor: FleetActor; hit: ShipContact } | undefined;
    for (const actor of actors) {
      if (actor.motion.id === shell.ownerId || actor.motion.y <= -40) continue;
      const def = actor.definition;
      if (!segmentOverlapsBox(worldToLocal(from, actor.motion), worldToLocal(end, actor.motion), { center: [0, 10, 0], size: [def.hull.beam + 30, 60, def.hull.length + 40] })) continue;
      const hit = shipContacts(shell, from, end, actor, def)[0];
      if (hit && (!nearest || hit.t < nearest.hit.t)) nearest = { actor, hit };
    }
    if (nearest) {
      const t = nearest.hit.t * (crossesSea ? fraction : 1);
      const elapsed = drag > 1e-9 ? -Math.log1p(-drag * t * travelFactor(horizon, drag)) / drag : horizon * t;
      const atHit = ballisticStep(from, shell.velocity, elapsed, drag);
      shell.penetrationMm = velocityPenetration(shell.penetrationMm, length(shell.velocity), length(atHit.velocity));
      shell.velocity = atHit.velocity; shell.age += elapsed; remaining -= elapsed;
      shell.position = localToWorld(nearest.hit.point, nearest.actor.motion);
      const stopped = resolveShipContact(shell, nearest.hit, nearest.actor, nearest.actor.definition, emit);
      if (stopped && !shell.lodged && shell.detonateAtAge === undefined) return 'stopped';
      continue;
    }
    shell.penetrationMm = velocityPenetration(shell.penetrationMm, length(shell.velocity), length(flight.velocity));
    shell.velocity = flight.velocity; shell.position = end; shell.age += horizon; remaining -= horizon;
    if (crossesSea || (to[1] < 0 && !insideHull(to))) {
      if (!insideHull([end[0], 0, end[2]])) emit({ kind: 'splash', position: [end[0], 0, end[2]], shipId: '', message: 'Shell splash', shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] } });
      return shell.visited.length ? 'passed-through' : 'splash';
    }
  }
  // Malformed/extremely dense definitions cannot monopolize a simulation tick.
  return 'expired';
}
