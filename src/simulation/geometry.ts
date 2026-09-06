import type { Vec3, Volume } from '../ships/blueprint';
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const length = (a: Vec3) => Math.hypot(...a);
export const normalize = (a: Vec3) => scale(a, 1 / (length(a) || 1));
export const wrapAngle = (a: number) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export interface Pose { x: number; y: number; z: number; heading: number; roll: number; pitch: number; }
/** Rotation order matches Three.js Euler YXZ with yaw = -heading. */
export function rotate(v: Vec3, pose: Pick<Pose, 'heading' | 'roll' | 'pitch'>): Vec3 {
  const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  const ch = Math.cos(pose.heading), sh = Math.sin(pose.heading);
  const x = cr * v[0] - sr * v[1], y = sr * v[0] + cr * v[1];
  const yy = cp * y - sp * v[2], z = sp * y + cp * v[2];
  return [ch * x - sh * z, yy, sh * x + ch * z];
}
export const localToWorld = (v: Vec3, pose: Pose) => add(rotate(v, pose), [pose.x, pose.y, pose.z]);
export function worldToLocal(v: Vec3, pose: Pose): Vec3 {
  const p = sub(v, [pose.x, pose.y, pose.z]);
  const ch = Math.cos(pose.heading), sh = Math.sin(pose.heading), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), cr = Math.cos(pose.roll), sr = Math.sin(pose.roll);
  const x = ch * p[0] + sh * p[2], zz = -sh * p[0] + ch * p[2];
  const y = cp * p[1] + sp * zz, z = -sp * p[1] + cp * zz;
  return [cr * x + sr * y, -sr * x + cr * y, z];
}
export interface SegmentHit { t: number; exit: number; normal: Vec3; point: Vec3; }
/** Slab intersection for a complete swept segment, including starts inside a volume. */
export function segmentBox(from: Vec3, to: Vec3, box: Pick<Volume, 'center' | 'size'>): SegmentHit | null {
  let enter = 0, exit = 1;
  let normal: Vec3 = [0, 0, 0];
  const delta = sub(to, from);
  for (let axis = 0; axis < 3; axis++) {
    const low = box.center[axis] - box.size[axis] / 2, high = box.center[axis] + box.size[axis] / 2;
    if (Math.abs(delta[axis]) < 1e-10) { if (from[axis] < low || from[axis] > high) return null; continue; }
    let a = (low - from[axis]) / delta[axis], b = (high - from[axis]) / delta[axis];
    let sign = -1;
    if (a > b) { [a, b] = [b, a]; sign = 1; }
    if (a >= enter) { enter = a; normal = [0, 0, 0]; normal[axis] = sign; }
    exit = Math.min(exit, b);
    if (enter > exit) return null;
  }
  return { t: enter, exit, normal, point: add(from, scale(delta, enter)) };
}
export const contains = (box: Pick<Volume, 'center' | 'size'>, point: Vec3) => point.every((v, i) => Math.abs(v - box.center[i]) <= box.size[i] / 2);

/** Allocation-free conservative broad phase, including the compiler's bounds tolerance. */
export function segmentOverlapsBox(from: Vec3, to: Vec3, box: Pick<Volume, 'center' | 'size'>): boolean {
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = to[axis] - from[axis], half = box.size[axis] / 2 + 1e-5;
    const low = box.center[axis] - half, high = box.center[axis] + half;
    if (Math.abs(delta) < 1e-10) { if (from[axis] < low || from[axis] > high) return false; continue; }
    const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

export const dot = (a: Vec3, b: Vec3): number => a.reduce((n, v, i) => n + v * b[i], 0);
