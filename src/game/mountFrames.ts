import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { localToWorld, radians, sub, type Pose } from './geometry';

export interface CarrierFrame { position: Vec3; heading: number; }
type Mount = ShipDefinition['mounts'][number];
export interface CarriedMountState { train: number; carrier?: CarrierFrame; }
const parents = new WeakMap<ShipDefinition, number[]>();
function parentIndices(def: ShipDefinition): number[] {
  let result = parents.get(def);
  if (!result) { result = def.mounts.map(m => m.parentMountId ? def.mounts.findIndex(p => p.id === m.parentMountId) : -1); parents.set(def, result); }
  return result;
}
/** Pure CPU yaw frame, including independently trained ancestors. Neutral
 * coordinates stay absolute so old definitions and editor placement agree. */
export function mountFrame(def: ShipDefinition, index: number, trains: readonly number[]): Pose {
  const mount = def.mounts[index], parentIndex = parentIndices(def)[index];
  let position = mount.position, inherited = 0;
  if (parentIndex >= 0) {
    const parent = def.mounts[parentIndex], pose = mountFrame(def, parentIndex, trains);
    inherited = pose.heading - radians(parent.bearingDeg);
    position = localToWorld(sub(position, parent.position), { ...pose, heading: inherited });
  }
  return { x: position[0], y: position[1], z: position[2], heading: radians(mount.bearingDeg) + inherited + trains[index], roll: 0, pitch: 0 };
}
/** Refresh the carrier before operating a child; parent-first definition order
 * means the child sees this tick's completed parent traversal. */
export function updateMountCarrier(def: ShipDefinition, index: number, states: CarriedMountState[]): void {
  const state = states[index];
  if (!def.mounts[index].parentMountId) { delete state.carrier; return; }
  const pose = mountFrame(def, index, states.map(s => s.train));
  state.carrier = { position: [pose.x, pose.y, pose.z], heading: pose.heading - radians(def.mounts[index].bearingDeg) - state.train };
}
export function updateMountCarriers(def: ShipDefinition, states: CarriedMountState[]): void {
  def.mounts.forEach((_, index) => updateMountCarrier(def, index, states));
}
export const mountPosition = (m: Mount, state: { carrier?: CarrierFrame }): Vec3 => state.carrier?.position ?? m.position;
export const mountBearing = (m: Mount, state: CarriedMountState): number => radians(m.bearingDeg) + (state.carrier?.heading ?? 0) + state.train;
/** Rotation-independent radius for broad-phase aircraft acquisition. */
export function mountOriginRadius(def: ShipDefinition, index: number): number {
  const parentIndex = parentIndices(def)[index], position = def.mounts[index].position;
  return parentIndex < 0 ? Math.hypot(...position) : mountOriginRadius(def, parentIndex) + Math.hypot(...sub(position, def.mounts[parentIndex].position));
}
