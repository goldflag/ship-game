import type { AirContext, Aircraft } from './aircraft';
import { antiAircraftRange } from '../ships/armament';
import { airborne, onFlightDeck } from './aircraft';
import type { FleetActor } from './battle';
import type { ShipDefinition } from '../ships/blueprint';
import { isPassiveAi } from './aiLevels';
import { ballisticStep, dispersedDirection } from './ballistics';
import { add, dot, length, normalize, scale, segmentBox, sub, worldToLocal } from './geometry';
import { motionVelocity } from './ship';
import { availableAmmunition, muzzleWorld, selectAmmunition, shotDirection, updateMount, type MountDefinition, type MountState } from './weapons';

export { antiAircraftRange } from '../ships/armament';

const reachByDefinition = new WeakMap<ShipDefinition, number>();
/** Conservative ship-wide broad phase. Called once per actor, not per gun.
 * Inputs are this tick's airborne, off-deck aircraft in their original order. */
export function antiAircraftCandidates(actor: FleetActor, planes: readonly Aircraft[]): Aircraft[] {
  let reach = reachByDefinition.get(actor.definition);
  if (reach === undefined) {
    reach = 0;
    for (const mount of actor.definition.mounts) {
      const range = antiAircraftRange(mount), w = mount.weapon;
      if (!range) continue;
      // Triangle bound covers every barrel through traverse, elevation and hull roll.
      const offset = Math.hypot(...mount.position) + Math.abs(w.pivotHeight) + Math.abs(w.trunnionForward)
        + Math.abs(w.muzzleForward - w.trunnionForward) + Math.abs(w.barrelSpacing) * (w.barrelCount ?? 2);
      reach = Math.max(reach, range + offset + 1e-6);
    }
    reachByDefinition.set(actor.definition, reach);
  }
  if (!reach || actor.damage.sunk || actor.damage.stability.combatLost || actor.motion.y < -1
    || (actor.controller === 'bot' && isPassiveAi(actor.bot?.aiLevel))) return [];
  return planes.filter(p => p.team !== actor.team && p.hp > 0
    && Math.abs(p.position[0] - actor.motion.x) <= reach!
    && Math.abs(p.position[1] - actor.motion.y) <= reach!
    && Math.abs(p.position[2] - actor.motion.z) <= reach!);
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
export function updateAntiAircraft(actor: FleetActor, m: MountDefinition, state: MountState, ctx: AirContext, dt: number, candidates?: readonly Aircraft[]): boolean {
  const range = antiAircraftRange(m);
  if (!range || actor.damage.sunk || actor.damage.stability.combatLost || actor.motion.y < -1 || state.hp <= 0 || state.ammo <= 0
    || (actor.controller === 'bot' && isPassiveAi(actor.bot?.aiLevel))) return false;
  if (candidates?.length === 0) return false;
  const origin = muzzleWorld(m, state, 0, actor.motion);
  let target: Aircraft | undefined, closest = range;
  for (const p of candidates ?? ctx.planes) {
    // Earlier guns can kill a candidate in this same tick. Preserve that check
    // and stable nearest-target ties; aircraft movement follows all ship guns.
    if (p.hp <= 0 || (!candidates && (p.team === actor.team || !airborne(p) || onFlightDeck(p)))) continue;
    const dx = p.position[0] - origin[0], dy = p.position[1] - origin[1], dz = p.position[2] - origin[2];
    if (Math.abs(dx) >= closest || Math.abs(dy) >= closest || Math.abs(dz) >= closest) continue;
    // Reject clear losers before the scale-safe hypot; keep its original exact
    // comparison near the boundary, including equal-distance target ordering.
    if (dx * dx + dy * dy + dz * dz > closest * closest * (1 + 1e-14)) continue;
    const distance = Math.hypot(dx, dy, dz);
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
