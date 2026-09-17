/** A plane's rendered attitude and control surfaces between two frames, read
 * from the wing element the frame carries; the flight model itself is Rust's. */
import type { Aircraft } from './session/elements';
import type { FlightControls } from '../multiplayer/generated/FlightControls';
import type { FlightAttitude } from '../multiplayer/generated/FlightAttitude';
import { wrapAngle } from './geometry';
export type { FlightControls } from '../multiplayer/generated/FlightControls';
export type { FlightAttitude } from '../multiplayer/generated/FlightAttitude';
export const TAKEOFF_ROLL_SECONDS = 3.6;
export function aircraftAttitude(p: Pick<Aircraft, 'heading' | 'pitch' | 'bank' | 'previousAttitude'>, alpha: number): FlightAttitude {
  const previous = p.previousAttitude ?? p;
  return { heading: wrapAngle(previous.heading + wrapAngle(p.heading - previous.heading) * alpha), pitch: previous.pitch + (p.pitch - previous.pitch) * alpha, bank: previous.bank + (p.bank - previous.bank) * alpha };
}

export function aircraftControls(p: Pick<Aircraft, 'controls' | 'previousControls'>, alpha: number): FlightControls {
  const previous = p.previousControls ?? p.controls;
  const controls = { ...p.controls };
  for (const key of Object.keys(controls) as (keyof FlightControls)[]) {
    const delta = p.controls[key] - previous[key];
    controls[key] = previous[key] + (key === 'propeller' ? wrapAngle(delta) : delta) * alpha;
  }
  return controls;
}
