import type { Aircraft } from '../simulation/aircraft';
import { aircraftDeckSpot, onFlightDeck } from '../simulation/aircraft';
import type { FleetActor } from '../simulation/battle';
import { aircraftAttitude } from '../simulation/aircraftFlight';
import { add, localToWorld, scale, sub, type Pose } from '../simulation/geometry';
import type { ShellView } from './ShellFollow';

/** Camera samples the same interpolated flight/deck poses as the aircraft renderer. */
export function aircraftFollowView(plane: Aircraft, actor: FleetActor, hull: Pose, alpha: number): ShellView | undefined {
  if (plane.phase === 'lost') return;
  const deck = onFlightDeck(plane);
  const position = deck
    ? localToWorld(['ready', 'queued', 'rearming'].includes(plane.phase) ? aircraftDeckSpot(actor, plane) : plane.deckPosition!, hull)
    : add(plane.previousPosition, scale(sub(plane.position, plane.previousPosition), alpha));
  const attitude = aircraftAttitude(plane, alpha);
  const heading = deck ? plane.heading + hull.heading - actor.motion.heading : attitude.heading;
  // Heading remains defined while parked; carrier velocity would point the camera
  // the wrong way during taxi or on a stopped deck.
  const pitch = deck ? hull.pitch : attitude.pitch;
  return { position, velocity: [Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch)] };
}
