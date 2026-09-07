import type { Vec3 } from '../ships/blueprint';
import type { Aircraft, AirFlight } from './aircraft';
import { aircraftSeed } from './aircraftAccuracy';
import { flyAircraft } from './aircraftFlight';
import { add, clamp, length, scale, sub } from './geometry';

/** Stable shallow V; small, smooth pilot corrections are reproducible per sortie.
 * Slots are never compacted after a loss, so surviving wingmen don't swap sides. */
export function formationOffset(flight: AirFlight, p: Aircraft, time: number, seed: number): Vec3 {
  const slot = Math.max(0, flight.planeIds.indexOf(p.id));
  if (!slot) return [0, 0, 0];
  const row = Math.ceil(slot / 2), side = slot % 2 ? -1 : 1;
  const phase = aircraftSeed(`${p.id}/${p.sortie ?? 0}/formation`, seed) / 0x100000000 * Math.PI * 2;
  return [side * row * 32 + Math.sin(time * .31 + phase) * 1.5,
    row * 3 + Math.sin(time * .23 + phase * 2) * .7,
    row * 27 + Math.sin(time * .27 + phase * 3) * 2];
}

export function formationLeader(flight: AirFlight, planes: Aircraft[]): Aircraft | undefined {
  return flight.planeIds.map(id => planes.find(p => p.id === id)).find(p => p && p.hp >= 25
    && p.flightTime <= 470 && (p.phase === 'outbound' || p.phase === 'attack'));
}

export function formationPosition(flight: AirFlight, p: Aircraft, leader: Aircraft, time: number, seed: number): Vec3 {
  const offset = sub(formationOffset(flight, p, time, seed), formationOffset(flight, leader, time, seed));
  const c = Math.cos(leader.heading), s = Math.sin(leader.heading);
  return add(leader.position, [c * offset[0] - s * offset[2], offset[1], s * offset[0] + c * offset[2]]);
}

/** Velocity feed-forward follows the rotating slot through turns. Position error
 * closes with bounded throttle and normal finite roll/pitch, never pose snapping. */
export function flyFormation(p: Aircraft, leader: Aircraft, flight: AirFlight, dt: number, time: number, seed: number) {
  const slot = formationPosition(flight, p, leader, time, seed), offset = sub(slot, leader.position);
  const leaderSpeed = Math.max(34, length(leader.velocity));
  const turnRate = -9.81 * Math.tan(leader.bank) / Math.max(30, leaderSpeed * Math.cos(leader.pitch));
  const slotVelocity = add(leader.velocity, [-turnRate * offset[2], 0, turnRate * offset[0]]);
  const error = sub(slot, p.position);
  const desired = add(slotVelocity, scale(error, .24));
  const speed = clamp(length(desired), leaderSpeed - 20, leaderSpeed + 24);
  const point = add(p.position, scale(desired, 3));
  // Compensate the normal flight solver's climb/bank drag to hold station.
  flyAircraft(p, point, speed + Math.sin(p.pitch) * 30 + Math.abs(p.bank) * 3 + p.controls.brakes * 14,
    dt, { turnRate, altitudeLookahead: speed * 3, dive: leader.pitch < -.24 });
}
