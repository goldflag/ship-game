import { Euler, Quaternion } from 'three/webgpu';
import { aircraftGroundPose } from './aircraftGroundPose';
import type { Pose } from './geometry';
import type { Aircraft } from '../game/session/elements';

/** Keep the CPU-fitted attitude relative to the hull while its displayed pose interpolates. */
export function aircraftDeckRotation(plane: Aircraft, hull: Pick<Pose, 'heading' | 'pitch' | 'roll'>, target: Quaternion): Quaternion {
  if (plane.deckPosition) {
    target.setFromEuler(new Euler(hull.pitch, -hull.heading, hull.roll, 'YXZ')).invert();
    return target.multiply(new Quaternion().setFromEuler(new Euler(plane.pitch, -plane.heading, plane.bank, 'YXZ')));
  }
  // A rearmed plane has its deck pose cleared and is identified only by its parking slot.
  const heading = plane.deckHeading ?? (plane.phase === 'taxi' || plane.phase === 'parking' ? plane.heading - hull.heading : 0);
  return target.setFromEuler(new Euler(aircraftGroundPose(plane.modelId).pitch, -heading, 0, 'YXZ'));
}
