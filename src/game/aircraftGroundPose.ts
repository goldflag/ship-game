import catalog from '../../assets/aircraft/catalog.json';
import wildcat from '../../assets/aircraft/shapes/f4f-4-wildcat.json';
import dauntless from '../../assets/aircraft/shapes/sbd-3-dauntless.json';
import devastator from '../../assets/aircraft/shapes/tbd-1-devastator.json';
import zero from '../../assets/aircraft/shapes/a6m2-zero.json';
import val from '../../assets/aircraft/shapes/d3a1-val.json';
import kate from '../../assets/aircraft/shapes/b5n2-kate.json';
import { rotate, type Pose } from './geometry';

// Use the original gear dimensions, including the wheel-center offsets in
// assets/aircraft/build.py. Three round tyres define the resting deck plane.
const poses = new Map([wildcat, dauntless, devastator, zero, val, kate].map(shape => {
  const length = catalog.aircraft.find(model => model.id === shape.id)!.length;
  const gear = shape.gear;
  const mainZ = length * (gear.mainU - .5) - .06;
  const tailZ = length * (gear.tailU + .006 - .5);
  const dy = gear.tailWheelZM - gear.wheelZM, dz = tailZ - mainZ;
  const pitch = Math.atan2(dy, dz) - Math.asin((.135 - gear.wheelRadiusM) / Math.hypot(dy, dz));
  const clearance = gear.wheelRadiusM - gear.wheelZM * Math.cos(pitch) + mainZ * Math.sin(pitch);
  // The published rig is generated only by extras.wingFold. Legacy notes such
  // as wingFoldFraction do not create a hinge in the asset pipeline.
  return [shape.id, { pitch, clearance, foldingWings: 'wingFold' in shape.extras }];
}));

export function aircraftGroundPose(modelId: string) {
  const pose = poses.get(modelId);
  if (!pose) throw new Error(`No authored landing gear for ${modelId}`);
  return pose;
}

/** CPU composition of carrier pose, taxi heading and the gear's resting pitch. */
export function aircraftDeckAttitude(carrier: Pick<Pose, 'heading' | 'pitch' | 'roll'>, modelId: string, heading = 0) {
  const local = { heading, pitch: aircraftGroundPose(modelId).pitch, roll: 0 };
  const right = rotate(rotate([1, 0, 0], local), carrier);
  const up = rotate(rotate([0, 1, 0], local), carrier);
  const back = rotate(rotate([0, 0, 1], local), carrier);
  return { heading: -Math.atan2(back[0], back[2]), pitch: Math.asin(Math.max(-1, Math.min(1, -back[1]))), bank: Math.atan2(right[1], up[1]) };
}
