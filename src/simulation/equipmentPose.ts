import type { Module, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from './damage';
import { localToWorld, sub, type Pose } from './geometry';

/** Launcher-specific yaw path; directors remain fixed. Pose is ship-local. */
export function equipmentPose(actor: Combatant, def: ShipDefinition, module: Module): Pose | undefined {
  if (!module.torpedoLauncherId) return;
  const launcher = def.torpedoLaunchers!.find(l => l.id === module.torpedoLauncherId)!;
  return { x: launcher.position[0], y: launcher.position[1], z: launcher.position[2], heading: actor.torpedoLaunchers?.find(l => l.id === launcher.id)?.train ?? 0, roll: 0, pitch: 0 };
}
export function equipmentBox(def: ShipDefinition, module: Module): { center: Vec3; size: Vec3 } {
  const launcher = module.torpedoLauncherId && def.torpedoLaunchers!.find(l => l.id === module.torpedoLauncherId)!;
  return launcher ? { center: sub(module.center, launcher.position), size: module.size } : module;
}
export function equipmentCenter(actor: Combatant, def: ShipDefinition, module: Module): Vec3 {
  const pose = equipmentPose(actor, def, module), box = equipmentBox(def, module);
  return pose ? localToWorld(box.center, pose) : box.center;
}
