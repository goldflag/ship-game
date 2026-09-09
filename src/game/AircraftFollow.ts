import type { Aircraft } from '../simulation/aircraft';
import { aircraftDeckSpot, onFlightDeck } from '../simulation/aircraft';
import type { FleetActor } from '../simulation/battle';
import { aircraftAttitude } from '../simulation/aircraftFlight';
import { add, localToWorld, scale, sub, type Pose } from '../simulation/geometry';
import type { ShellView } from './ShellFollow';
import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { aircraftDeckRotation } from './AircraftDeckPresentation';

/** Camera samples the same interpolated flight/deck poses as the aircraft renderer. */
export function aircraftFollowView(plane: Aircraft, actor: FleetActor, hull: Pose, alpha: number): ShellView | undefined {
  if (plane.phase === 'lost' || plane.phase === 'withdrawn') return;
  const deck = onFlightDeck(plane);
  if (!deck && !['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(plane.phase)) return;
  const position = deck
    ? localToWorld(plane.deckPosition ?? aircraftDeckSpot(actor, plane), hull)
    : add(plane.previousPosition, scale(sub(plane.position, plane.previousPosition), alpha));
  if (deck) {
    const rotation = aircraftDeckRotation(plane, actor.motion, new Quaternion())
      .premultiply(new Quaternion().setFromEuler(new Euler(hull.pitch, -hull.heading, hull.roll, 'YXZ')));
    // Follow the fitted airframe's nose, including taxi turns and deck slope.
    return { position, velocity: new Vector3(0, 0, -1).applyQuaternion(rotation).toArray() };
  }
  const attitude = aircraftAttitude(plane, alpha);
  const { heading, pitch } = attitude;
  return { position, velocity: [Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch)] };
}
