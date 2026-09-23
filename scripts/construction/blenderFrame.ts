/** The one conversion between construction coordinates and this repository's Blender authoring frame.
 * `blender/frame.py` is the Python twin; `blenderFrame.test.ts` checks both against each other.
 *
 * | Frame | +X | +Y | +Z | Units |
 * | --- | --- | --- | --- | --- |
 * | Construction (runtime) | starboard | up | stern (bow is −Z) | metres |
 * | Blender authoring | bow | port | up | metres |
 *
 * The map is a proper rotation (determinant +1), so it keeps handedness and triangle winding.
 * Yaw about the vertical is counter-clockwise seen from above in both frames, so a hull piece's
 * `rotationDeg` is the Blender Z rotation unchanged. Equipment `bearingDeg` is clockwise seen from
 * above (0 bow, 90 starboard), so it is the negated Blender Z rotation. */
import type { Vec3 } from '../../src/ships/blueprint';

/** Construction point or direction (x starboard, y up, −z bow) to Blender (x bow, y port, z up). */
export const toBlender = ([x, y, z]: readonly number[]): Vec3 => [-z, -x, y];
/** Blender point or direction to construction coordinates. */
export const fromBlender = ([bx, by, bz]: readonly number[]): Vec3 => [-by, bz, -bx];
/** Box dimensions (always positive) from construction axes to Blender axes and back. */
export const sizeToBlender = ([x, y, z]: readonly number[]): Vec3 => [z, x, y];
export const sizeFromBlender = ([bx, by, bz]: readonly number[]): Vec3 => [by, bz, bx];

/** The rotation matrix of `toBlender`, row-major. */
export const TO_BLENDER: readonly Vec3[] = [
  [0, 0, -1],
  [-1, 0, 0],
  [0, 1, 0],
];

/** Degrees in [0, 360), with −0 and float dust folded to 0. */
export function degrees360(value: number): number {
  const n = ((value % 360) + 360) % 360;
  const rounded = Math.round(n * 1e9) / 1e9;
  return rounded === 360 || Math.abs(rounded) < 1e-9 ? 0 : rounded;
}
/** Equipment bearing (clockwise from the bow) to the Blender Z rotation in degrees. */
export const bearingToBlenderYaw = (bearingDeg: number) => degrees360(-bearingDeg);
export const blenderYawToBearing = (yawDeg: number) => degrees360(-yawDeg);
/** Hull piece yaw (`rotationDeg`, counter-clockwise from above) to the Blender Z rotation and back. */
export const rotationToBlenderYaw = (rotationDeg: number) => degrees360(rotationDeg);
export const blenderYawToRotation = (yawDeg: number) => degrees360(yawDeg);

/** A Blender `matrix_world` (row-major 4×4) as a construction-space affine map: `point` applies it to a
 * Blender-local point and returns construction coordinates. */
export function blenderWorld(matrix: readonly (readonly number[])[]) {
  const apply = (v: readonly number[]): Vec3 => [0, 1, 2].map((r) => matrix[r][0] * v[0] + matrix[r][1] * v[1] + matrix[r][2] * v[2] + matrix[r][3]) as Vec3;
  const turn = (v: readonly number[]): Vec3 => [0, 1, 2].map((r) => matrix[r][0] * v[0] + matrix[r][1] * v[1] + matrix[r][2] * v[2]) as Vec3;
  const column = (k: number): Vec3 => [matrix[0][k], matrix[1][k], matrix[2][k]];
  const length = (v: Vec3) => Math.hypot(...v);
  const scale: Vec3 = [length(column(0)), length(column(1)), length(column(2))];
  // The object's local +X is its forward (bow) axis in Blender; its heading on the waterplane is the yaw.
  const forward = column(0);
  const yawDeg = degrees360((Math.atan2(forward[1], forward[0]) * 180) / Math.PI);
  // Anything that is not a pure yaw with unit scale: pitch, roll, shear or scale.
  const yaw = (yawDeg * Math.PI) / 180;
  const pure: Vec3[] = [
    [Math.cos(yaw), -Math.sin(yaw), 0],
    [Math.sin(yaw), Math.cos(yaw), 0],
    [0, 0, 1],
  ];
  const offYaw = Math.max(...[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => Math.abs(matrix[r][c] - pure[r][c]))));
  return {
    /** Blender-local point to construction coordinates. */
    point: (v: readonly number[]) => fromBlender(apply(v)),
    /** Blender-local direction to construction coordinates (no translation). */
    direction: (v: readonly number[]) => fromBlender(turn(v)),
    location: fromBlender([matrix[0][3], matrix[1][3], matrix[2][3]]),
    yawDeg,
    scale,
    /** Largest matrix entry by which the rotation part differs from a pure yaw at unit scale. */
    offYaw,
  };
}
