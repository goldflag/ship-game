import type { AirContext, Aircraft } from './aircraft';
import { airborne, onFlightDeck } from './aircraft';
import type { FleetActor } from './battle';
import { ballisticStep, dispersedDirection } from './ballistics';
import { add, dot, length, normalize, scale, segmentBox, sub, worldToLocal } from './geometry';
import { motionVelocity } from './ship';
import { availableAmmunition, muzzleWorld, selectAmmunition, shotDirection, updateMount, type MountDefinition, type MountState } from './weapons';

/** Registered high-angle guns supply AA; the same mount state drives damage,
 * ammunition, obstruction checks and renderer articulation. No ship-ID rules. */
export function antiAircraftRange(m: MountDefinition): number {
  if (m.weapon.elevationMaxDeg < 70 || m.weapon.caliberM > .13) return 0;
  return m.weapon.caliberM > .08 ? 3200 : m.weapon.caliberM > .025 ? 1800 : 1200;
}

function clearLane(actor: FleetActor, from: [number, number, number], to: [number, number, number], ctx: AirContext) {
  const delta = sub(to, from), distance = length(delta), direction = normalize(delta);
  if (ctx.planes.some(p => {
    if (p.team !== actor.team || !airborne(p)) return false;
    const relative = sub(p.position, from), along = dot(relative, direction);
    return along > 0 && along < distance && length(sub(relative, scale(direction, along))) < 20;
  })) return false;
  return !ctx.actors.some(friend => friend !== actor && friend.team === actor.team && !friend.damage.sunk
    && segmentBox(worldToLocal(from, friend.motion), worldToLocal(to, friend.motion), {
      center: [0, (friend.definition.hull.depth - 2 * friend.definition.hull.draft) / 2, 0],
      size: [friend.definition.hull.beam, friend.definition.hull.depth, friend.definition.hull.length],
    }));
}

/** True reserves this mount for a nearby aircraft this tick. Bursts use seeded
 * miss distance and a bounded hit radius; heavy AA approximates a timed burst. */
export function updateAntiAircraft(actor: FleetActor, m: MountDefinition, state: MountState, ctx: AirContext, dt: number): boolean {
  const range = antiAircraftRange(m);
  if (!range || actor.damage.sunk || actor.damage.stability.combatLost || actor.motion.y < -1 || state.hp <= 0 || state.ammo <= 0) return false;
  const origin = muzzleWorld(m, state, 0, actor.motion);
  let target: Aircraft | undefined, closest = range;
  for (const p of ctx.planes) {
    if (p.team === actor.team || p.hp <= 0 || !airborne(p) || onFlightDeck(p)) continue;
    const distance = length(sub(p.position, origin));
    if (distance < closest) { target = p; closest = distance; }
  }
  if (!target) return false;
  const barrels = m.weapon.barrelCount ?? 2;
  if (availableAmmunition(state) < barrels) selectAmmunition(m, state, state.loaded === 'ap' ? 'he' : 'ap');
  const velocity = motionVelocity(actor.motion);
  const flightTime = closest / m.weapon.muzzleSpeed;
  const aim = add(target.position, scale(target.velocity, flightTime));
  const aligned = updateMount(m, state, actor.definition, actor.motion, aim, dt, velocity);
  if (!aligned || state.status !== 'ready') return true;
  const muzzle = muzzleWorld(m, state, 0, actor.motion);
  if (!clearLane(actor, muzzle, aim, ctx)) { state.status = 'blocked'; return true; }
  state.ammo -= barrels; if (state.loaded === 'he') state.heAmmo -= barrels;
  state.reload = Math.max(.35, m.weapon.reloadSeconds); state.recoil = 1; state.status = 'reloading';
  const heavy = m.weapon.caliberM > .08;
  for (let barrel = 0; barrel < barrels; barrel++) {
    const position = muzzleWorld(m, state, barrel, actor.motion);
    const direction = dispersedDirection(shotDirection(m, state, actor.motion), .006 + closest / 200000, ctx.seed ?? 0, ctx.nextId());
    const endpoint = ballisticStep(position, add(scale(direction, m.weapon.muzzleSpeed), velocity), flightTime).position;
    if (length(sub(endpoint, aim)) < (heavy ? 14 : 6)) target.hp -= heavy ? 2.5 : m.weapon.caliberM > .025 ? 1.2 : .8;
    ctx.emit({ kind: 'aircraft-fire', shipId: actor.motion.id, position, message: `${m.name} · AA fire`, aircraft: { id: target.id, target: endpoint, tracerSpeed: m.weapon.muzzleSpeed } });
  }
  return true;
}
