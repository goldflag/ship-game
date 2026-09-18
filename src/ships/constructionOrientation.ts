import type { ConstructionPrimitive, Vec3 } from './blueprint';

type Orientation = Pick<ConstructionPrimitive, 'rotationDeg' | 'tilt'>;
const radians = Math.PI / 180;
/** Source angles are pitch X, yaw Y, roll Z; local vectors rotate in YXZ order. */
export function blockAngles(p: Orientation): Vec3 { return [p.tilt?.pitchDeg ?? 0, p.rotationDeg, p.tilt?.rollDeg ?? 0]; }
export function orientVector(p: Orientation, v: Vec3): Vec3 {
  const [pitch, yaw, roll] = blockAngles(p).map(n => n * radians);
  const sr = Math.sin(roll), cr = Math.cos(roll), sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const x = cr * v[0] - sr * v[1], y = sr * v[0] + cr * v[1];
  const yy = cp * y - sp * v[2], z = sp * y + cp * v[2];
  return [cy * x + sy * z, yy, -sy * x + cy * z];
}
const basis = (p: Orientation) => ([0, 1, 2] as const).map(k => orientVector(p, [+(k === 0), +(k === 1), +(k === 2)]));
export function unorientVector(p: Orientation, v: Vec3): Vec3 { return basis(p).map(b => b.reduce((sum, n, k) => sum + n * v[k], 0)) as Vec3; }
export function primitivePoint(p: ConstructionPrimitive, v: Vec3): Vec3 { return orientVector(p, v).map((n, k) => n + p.position[k]) as Vec3; }
export function normalizedAngle(value: number) { const n = ((value + 180) % 360 + 360) % 360 - 180; return Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e9) / 1e9; }
export function withBlockAngles(p: ConstructionPrimitive, angles: Vec3): ConstructionPrimitive {
  const [pitchDeg, yaw, rollDeg] = angles.map(normalizedAngle), out = { ...p, rotationDeg: (yaw + 360) % 360 };
  if (pitchDeg || rollDeg) out.tilt = { version: 1, pitchDeg, rollDeg }; else delete out.tilt;
  return out;
}
function fromBasis(p: ConstructionPrimitive, [x, y, z]: Vec3[]) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -z[1])));
  const regular = Math.abs(z[1]) < .999999999;
  return withBlockAngles(p, [pitch / radians, Math.atan2(regular ? z[0] : -x[2], regular ? z[2] : x[0]) / radians, regular ? Math.atan2(x[1], y[1]) / radians : 0]);
}
/** Increment about a ship/world axis, matching the visible gizmo. */
export function rotateBlock(p: ConstructionPrimitive, axis: number, degrees: number): ConstructionPrimitive {
  const angles: Vec3 = [0, 0, 0]; angles[axis] = degrees;
  const rotation = withBlockAngles({ ...p, rotationDeg: 0 }, angles);
  return fromBasis(p, basis(p).map(v => orientVector(rotation, v)));
}
/** S R S: reflect world and local X, then account for asymmetric preset mirroring. */
export function mirroredOrientation(p: ConstructionPrimitive, yaw = 0): Pick<ConstructionPrimitive, 'rotationDeg' | 'tilt'> {
  if (!p.tilt) return { rotationDeg: ((-p.rotationDeg + yaw) % 360 + 360) % 360 };
  const local = basis({ rotationDeg: yaw });
  const columns = local.map(v => orientVector(p, [-v[0], v[1], v[2]]).map((n, k) => k === 0 ? -n : n) as Vec3);
  const result = fromBasis(p, columns); return { rotationDeg: result.rotationDeg, tilt: result.tilt };
}
