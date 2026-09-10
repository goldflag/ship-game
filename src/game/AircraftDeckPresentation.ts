import { Euler, Quaternion } from 'three/webgpu';
import type { Aircraft } from '../simulation/aircraft';
import { aircraftGroundPose } from '../simulation/aircraftGroundPose';
import type { Pose } from '../simulation/geometry';

/** Keep the CPU-fitted attitude relative to the hull while its displayed pose interpolates. */
export function aircraftDeckRotation(plane: Aircraft, hull: Pick<Pose, 'heading' | 'pitch' | 'roll'>, target: Quaternion): Quaternion {
  if (plane.deckPosition) {
    target.setFromEuler(new Euler(hull.pitch, -hull.heading, hull.roll, 'YXZ')).invert();
    return target.multiply(new Quaternion().setFromEuler(new Euler(plane.pitch, -plane.heading, plane.bank, 'YXZ')));
  }
  // Older snapshots may only identify a parking slot, without a fitted CPU pose.
  const heading = plane.deckHeading ?? (plane.phase === 'taxi' || plane.phase === 'parking' ? plane.heading - hull.heading : 0);
  return target.setFromEuler(new Euler(aircraftGroundPose(plane.modelId).pitch, -heading, 0, 'YXZ'));
}
