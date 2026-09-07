import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Pose } from './geometry';

const shellRadii = new WeakMap<ShipDefinition,number>();
const shellBounds = new WeakMap<ShipDefinition, { center: Vec3; size: Vec3 }>();
/** Legacy hull envelope, expanded for authored exposed equipment at every bank yaw. */
export function shellHullBounds(def: ShipDefinition): { center: Vec3; size: Vec3 } {
  const cached=shellBounds.get(def); if(cached) return cached;
  const low:Vec3=[-(def.hull.beam+30)/2,-20,-(def.hull.length+40)/2], high:Vec3=[-low[0],40,-low[2]];
  for(const module of def.modules) {
    const launcher=def.torpedoLaunchers?.find(l=>l.id===module.torpedoLauncherId);
    const radius=launcher ? Math.hypot(module.center[0]-launcher.position[0],module.center[2]-launcher.position[2])+Math.hypot(module.size[0]/2,module.size[2]/2) : 0;
    for(let axis=0;axis<3;axis++) {
      const center=launcher&&axis!==1?launcher.position[axis]:module.center[axis], half=launcher&&axis!==1?radius:module.size[axis]/2;
      low[axis]=Math.min(low[axis],center-half); high[axis]=Math.max(high[axis],center+half);
    }
  }
  const box={center:low.map((v,i)=>(v+high[i])/2) as Vec3,size:low.map((v,i)=>high[i]-v) as Vec3};
  shellBounds.set(def,box);return box;
}
/** Origin-centered sphere encloses the complete ship-local box under heel/trim. */
export function shellHullRadius(definition: ShipDefinition): number {
  let radius=shellRadii.get(definition);
  if(radius===undefined) {const box=shellHullBounds(definition);radius=Math.hypot(...box.center.map((v,i)=>Math.abs(v)+box.size[i]/2));shellRadii.set(definition,radius);}
  return radius;
}

const torpedoRadii = new WeakMap<ShipDefinition, number>();
/** Enclose the torpedo's authored hull box, including submerged and listed poses. */
export function torpedoHullRadius(definition: ShipDefinition): number {
  let radius = torpedoRadii.get(definition);
  if (radius === undefined) {
    const h = definition.hull;
    radius = Math.hypot(h.beam / 2, Math.max(h.draft, Math.abs(h.depth - h.draft)), h.length / 2) + 1e-5;
    torpedoRadii.set(definition, radius);
  }
  return radius;
}

/** Conservative world-space rejection before expensive ship-local transforms.
 * Keep the complete segment, so fast shells crossing a hull cannot tunnel.
 */
export function mayReachHull(from: Vec3, to: Vec3, pose: Pose, radius: number): boolean {
  return Math.min(from[0], to[0]) <= pose.x + radius && Math.max(from[0], to[0]) >= pose.x - radius
    && Math.min(from[1], to[1]) <= pose.y + radius && Math.max(from[1], to[1]) >= pose.y - radius
    && Math.min(from[2], to[2]) <= pose.z + radius && Math.max(from[2], to[2]) >= pose.z - radius;
}
