import type { Island } from '../maps/catalog';
import { firstLandHit } from './land';
import type { Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { ballisticStep, travelFactor, velocityPenetration } from './ballistics';
import { burstShell } from './burst';
import { resolveShipContact, shipContacts, type DamageEvent, type Shell, type ShipContact } from './damage';
import { add, length, localToWorld, radians, scale, segmentOverlapsBox, sub, worldToLocal } from './geometry';
import { hullContains } from './hull';
import { mayReachHull, shellHullRadius } from './spatial';

export type ProjectileEnd = 'burst' | 'stopped' | 'passed-through' | 'splash' | 'expired';
/** Swept chords remain bounded to a CPU tick. Every contact splits elapsed time,
 * so residual speed and fuze delay affect travel during that same tick. */
export function advanceProjectile(shell: Shell, actors: FleetActor[], dt: number, emit: (event: DamageEvent | { kind: 'splash'; shipId: string; position: Vec3; message: string; shell: Pick<Shell, 'id' | 'caliberM' | 'velocity' | 'type' | 'ammunition'> }) => void, islands: readonly Island[] = [], surfaceAt: (x: number, z: number) => number = () => 0): ProjectileEnd | undefined {
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
    let horizon = Math.min(remaining, 180 - shell.age, shell.detonateAtAge === undefined ? remaining : shell.detonateAtAge - shell.age);
    if (shell.lodged) { shell.age += horizon; remaining -= horizon; continue; }
    const from: Vec3 = [...shell.position];
    const inWater = from[1] <= surfaceAt(from[0], from[2]) && !insideHull(from);
    if (inWater && length(shell.velocity) < 20 && shell.detonateAtAge === undefined) return shell.visited.length ? 'passed-through' : 'splash';
    if (inWater) shell.waterDragPerSecond ??= Math.max(1, length(shell.velocity) * .04 * .38 / Math.max(.007, shell.caliberM));
    const drag = inWater ? shell.waterDragPerSecond! : shell.dragPerSecond ?? 0;
    let flight = ballisticStep(from, shell.velocity, horizon, drag);
    // Split at the exact sea crossing; never advance the fuze through the air
    // portion using an underwater velocity, or discard the remaining tick.
    let crossesSea = false;
    const endsInWater = flight.position[1] <= surfaceAt(flight.position[0], flight.position[2]);
    if (inWater !== endsInWater && (inWater || from[1] > surfaceAt(from[0], from[2]))) {
      let low = 0, high = horizon;
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        const point = ballisticStep(from, shell.velocity, mid, drag).position;
        if ((point[1] <= surfaceAt(point[0], point[2])) === inWater) low = mid; else high = mid;
      }
      const crossing = ballisticStep(from, shell.velocity, high, drag);
      if (!insideHull(crossing.position)) { horizon = high; flight = crossing; crossesSea = true; }
    }
    const end = flight.position;
    let nearest: { actor: FleetActor; hit: ShipContact } | undefined;
    for (const actor of actors) {
      if (actor.motion.id === shell.ownerId || !mayReachHull(from, end, actor.motion, shellHullRadius(actor.definition))) continue;
      const def = actor.definition;
      if (!segmentOverlapsBox(worldToLocal(from, actor.motion), worldToLocal(end, actor.motion), { center: [0, 10, 0], size: [def.hull.beam + 30, 60, def.hull.length + 40] })) continue;
      const hit = shipContacts(shell, from, end, actor, def)[0];
      if (hit && (!nearest || hit.t < nearest.hit.t)) nearest = { actor, hit };
    }
    const land = firstLandHit(islands, from, end);
    if (land && (!nearest || land.t < nearest.hit.t)) {
      shell.position = land.point;
      emit({ kind: 'stopped', shipId: '', position: land.point, message: 'Shell struck the coast', normal: [0, 1, 0], shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity], ammunition: shell.ammunition, type: shell.type ?? 'AP' } });
      return 'stopped';
    }
    if (nearest) {
      const t = nearest.hit.t;
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
    if (crossesSea && inWater) {
      shell.position[1] = surfaceAt(end[0], end[2]) + 1e-7;
      shell.waterDragPerSecond = undefined;
    } else if (crossesSea) {
      shell.position[1] = surfaceAt(end[0], end[2]) - 1e-7;
      emit({ kind: 'splash', position: [end[0], surfaceAt(end[0], end[2]), end[2]], shipId: '', message: 'Shell entering water', shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity], ammunition: shell.ammunition, type: shell.type ?? (shell.ammunition === 'he' ? 'HE' : 'AP') } });
      if (shell.he) { shell.detonateAtAge = shell.age; continue; }
      // Water impact strips energy before the high-resistance underwater run.
      const before = length(shell.velocity);
      shell.velocity = scale(shell.velocity, .75);
      shell.penetrationMm = velocityPenetration(shell.penetrationMm, before, length(shell.velocity));
      shell.waterDragPerSecond = Math.max(1, length(shell.velocity) * .04 * .38 / Math.max(.007, shell.caliberM));
      if (shell.ap && shell.detonateAtAge === undefined && Math.abs(shell.velocity[1]) / length(shell.velocity) > .15)
        shell.detonateAtAge = shell.age + shell.ap.fuzeDelaySeconds;
    }

  }
  // Malformed/extremely dense definitions cannot monopolize a simulation tick.
  return 'expired';
}
