import type { AircraftRole, Vec3 } from '../ships/blueprint';
import type { Aircraft } from './aircraft';
import { add, clamp, length, scale, wrapAngle } from '../game/geometry';

export interface FlightControls { gear: number; hook: number; brakes: number; aileron: number; elevator: number; rudder: number; propeller: number; }
export interface FlightAttitude { heading: number; pitch: number; bank: number; }
export { TAKEOFF_ROLL_SECONDS, aircraftAttitude, aircraftControls } from '../game/aircraftPose';
import { TAKEOFF_ROLL_SECONDS, aircraftAttitude, aircraftControls } from '../game/aircraftPose';
export const initialFlightControls = (): FlightControls => ({ gear: 1, hook: 0, brakes: 0, aileron: 0, elevator: 0, rudder: 0, propeller: 0 });
export const approachValue = (value: number, target: number, rate: number, dt: number) => value + clamp(target - value, -rate * dt, rate * dt);

// Role envelopes are game tuning in SI units, not historical performance tables.
const envelopes: Record<AircraftRole, { bank: number; rollRate: number; climb: number; acceleration: number; minSpeed: number }> = {
  fighter: { bank: 1.12, rollRate: .85, climb: .24, acceleration: 7, minSpeed: 38 },
  'dive-bomber': { bank: .85, rollRate: .5, climb: .18, acceleration: 4.5, minSpeed: 36 },
  'torpedo-bomber': { bank: .72, rollRate: .4, climb: .15, acceleration: 3.5, minSpeed: 34 },
};

/** Coordinated turns: roll develops first; lateral lift turns the velocity vector.
 * Pitch and throttle have finite response, and dives exchange height for speed.
 * All poses and mechanisms advance on the CPU fixed tick, including while offscreen. */
export function flyAircraft(p: Aircraft, point: Vec3, requestedSpeed: number, dt: number, options: { dive?: boolean; landing?: boolean; bankLimit?: number; altitudeLookahead?: number; turnRate?: number } = {}) {
  if (dt <= 0) return;
  p.navigationTarget = [...point];
  const envelope = envelopes[p.role];
  const speed = Math.max(envelope.minSpeed, length(p.velocity));
  const dx = point[0] - p.position[0], dz = point[2] - p.position[2];
  const horizontal = Math.hypot(dx, dz);
  const error = wrapAngle(Math.atan2(dx, -dz) - p.heading);
  const maxBank = options.bankLimit ?? (options.landing ? .38 : envelope.bank);
  const desiredBank = clamp(-Math.atan((error / 2.2 + (options.turnRate ?? 0)) * speed / 9.81), -maxBank, maxBank);
  const oldBank = p.bank, oldPitch = p.pitch;
  p.bank = approachValue(p.bank, desiredBank, envelope.rollRate, dt);
  const turnRate = -9.81 * Math.tan(p.bank) / Math.max(30, speed * Math.cos(p.pitch));
  p.heading = wrapAngle(p.heading + turnRate * dt);

  let desiredPitch = clamp(Math.atan2(point[1] - p.position[1], Math.max(Math.min(horizontal, options.altitudeLookahead ?? Infinity), options.landing ? 45 : speed * 2)), options.dive ? -1.05 : -.24, envelope.climb);
  // Start the pullout before reaching the sea; no clamping/teleporting the position.
  const pulloutHeight = 22 + Math.max(0, -p.velocity[1]) * 3;
  if (!options.landing && p.position[1] < pulloutHeight) desiredPitch = Math.max(desiredPitch, .12);
  p.pitch = approachValue(p.pitch, desiredPitch, options.dive ? .25 : .18, dt);
  const drag = Math.abs(p.bank) * 3 + p.controls.brakes * 14;
  const targetSpeed = Math.max(envelope.minSpeed, requestedSpeed - Math.sin(p.pitch) * 30 - drag);
  const nextSpeed = approachValue(speed, targetSpeed, envelope.acceleration, dt);
  p.velocity = [Math.sin(p.heading) * Math.cos(p.pitch) * nextSpeed, Math.sin(p.pitch) * nextSpeed, -Math.cos(p.heading) * Math.cos(p.pitch) * nextSpeed];
  p.position = add(p.position, scale(p.velocity, dt));
  p.controls.aileron = clamp((p.bank - oldBank) / dt * .45, -.35, .35);
  p.controls.elevator = clamp(-(p.pitch - oldPitch) / dt * .8 - Math.abs(p.bank) * .035, -.3, .3);
  p.controls.rudder = clamp(turnRate * .28, -.16, .16);
}

