import { hullDepth } from './session/motion';
import type { ShipDefinition, TorpedoPart, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './session/elements';
import { add, localToWorld, radians, rotate, sub, wrapAngle, scale } from './geometry';
import { launcherAvailable, equipmentCondition } from './machinery';

export type TubeDefinition = NonNullable<ShipDefinition['torpedoTubes']>[number];
export type { TubeState } from './session/elements';
import type { TubeState } from './session/elements';
export interface TorpedoLauncherState { id: string; train: number; }
export interface Torpedo {
  id: number; ownerId: string; tubeId: string; position: Vec3; velocity: Vec3;
  distance: number; age: number; weapon: TorpedoPart;
}
export const createTubeState = (tube: TubeDefinition): TubeState => ({ id: tube.id, ammo: tube.ammo, reload: 0, status: tube.ammo ? 'ready' : 'empty' });

export function tubeLocalPosition(actor: Pick<FleetActor, 'definition' | 'torpedoLaunchers'>, tube: TubeDefinition): Vec3 {
  const launcher = actor.definition.torpedoLaunchers?.find(l => l.id === tube.launcherId);
  if (!launcher) return tube.position;
  const train = actor.torpedoLaunchers?.find(l => l.id === launcher.id)?.train ?? 0;
  return add(launcher.position, rotate(sub(tube.position, launcher.position), { heading: train, roll: 0, pitch: 0 }));
}

export function tubeSolution(actor: FleetActor, tube: TubeDefinition, state: TubeState, aim: Vec3, dt: number) {
  state.reload = Math.max(0, state.reload - dt);
  const origin = localToWorld(tubeLocalPosition(actor, tube), actor.motion);
  const heading = Math.atan2(aim[0] - origin[0], origin[2] - aim[2]);
  const range = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]);
  const magazine = actor.definition.modules.find(m => m.id === tube.magazineId);
  const launcher = actor.definition.torpedoLaunchers?.find(l => l.id === tube.launcherId);
  const train = actor.torpedoLaunchers?.find(l => l.id === tube.launcherId)?.train ?? radians(tube.bearingDeg);
  const relative = wrapAngle(heading - actor.motion.heading);
  const inArc = launcher ? launcher.launchArcsDeg.some(([a, b]) => relative >= radians(a) && relative <= radians(b)) : Math.abs(wrapAngle(relative - train)) <= radians(tube.arcDeg) + 1e-8;
  state.status = actor.damage.sunk || actor.damage.stability.combatLost || !launcherAvailable(actor, actor.definition, tube.launcherModuleId) || !magazine || equipmentCondition(actor, actor.definition, magazine).availability <= 0 ? 'disabled' : state.ammo === 0 ? 'empty' :
    actor.definition.submarine && hullDepth(actor.motion) > actor.definition.submarine.maxTorpedoDepthM ? 'too-deep' :
    !launcher && origin[1] > 0 ? 'above-water' :
    !aim.every(Number.isFinite) || !inArc ? 'out-of-arc' :
    range < tube.weapon.armingDistanceM ? 'too-close' : range > tube.weapon.rangeM ? 'out-of-range' : state.reload > 0 ? 'reloading' :
    launcher && Math.abs(wrapAngle(relative - train)) > radians(tube.arcDeg) ? 'turning' : 'ready';
  return { origin, heading, range };
}

export function torpedoIntercept(from: Vec3, point: Vec3, velocity: Vec3, speed: number): Vec3 | null {
  const dx = point[0] - from[0], dz = point[2] - from[2];
  const a = velocity[0] ** 2 + velocity[2] ** 2 - speed ** 2;
  const b = 2 * (dx * velocity[0] + dz * velocity[2]), c = dx ** 2 + dz ** 2;
  let time: number;
  if (Math.abs(a) < 1e-8) time = Math.abs(b) > 1e-8 ? -c / b : c < 1e-8 ? 0 : Infinity;
  else {
    const d = b * b - 4 * a * c;
    if (d < 0) return null;
    time = Math.min(...[(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)].filter(t => t >= 0));
  }
  return Number.isFinite(time) && time >= 0 ? add(point, scale([velocity[0], 0, velocity[2]], time)) : null;
}
