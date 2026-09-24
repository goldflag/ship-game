import * as THREE from 'three/webgpu';

/** The private fields three keeps an Euler and a quaternion in; `Object3D` links its rotation and quaternion through their
 * change callbacks, which these writes stand in for. */
type EulerFields = { _x: number; _y: number; _z: number; _order: string };
type QuaternionFields = { _x: number; _y: number; _z: number; _w: number };

/** A zero angle's cosine and sine, as `Quaternion.setFromEuler` finds them. */
const C = 1, S = 0;
const axis = new THREE.Vector3();

/** Joint turns written directly: the same Euler and quaternion values three computes, without the change callbacks, and
 * for a single-axis Euler without the trigonometry of its two zero angles. Off: three's own calls, for comparison. */
export const jointTurns = { direct: true };

/** `object.rotation.set(x, 0, 0)` for every joint in `objects` (barrels sharing one elevation): the Euler, and the
 * quaternion `Quaternion.setFromEuler` derives from it in XYZ order with every product kept (a product with a zero sine
 * keeps that zero's sign), from one cosine and sine. A joint in another order goes through three. */
export function setJointsX(objects: readonly THREE.Object3D[], x: number): void {
  if (!objects.length) return;
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const qx = s1 * C * C + c1 * S * S, qy = c1 * S * C - s1 * C * S, qz = c1 * C * S + s1 * S * C, qw = c1 * C * C - s1 * S * S;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i], r = object.rotation as unknown as EulerFields;
    if (!jointTurns.direct || r._order !== 'XYZ') { object.rotation.set(x, 0, 0); continue; }
    const q = object.quaternion as unknown as QuaternionFields;
    r._x = x; r._y = 0; r._z = 0; q._x = qx; q._y = qy; q._z = qz; q._w = qw;
  }
}

/** `object.rotation.set(0, y, 0)`, as `setJointsX` for one joint. */
export function setJointY(object: THREE.Object3D, y: number): void {
  const r = object.rotation as unknown as EulerFields;
  if (!jointTurns.direct || r._order !== 'XYZ') { object.rotation.set(0, y, 0); return; }
  const q = object.quaternion as unknown as QuaternionFields, c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  r._x = 0; r._y = y; r._z = 0;
  q._x = S * c2 * C + C * s2 * S; q._y = C * s2 * C - S * c2 * S; q._z = C * c2 * S + S * s2 * C; q._w = C * c2 * C - S * s2 * S;
}

/** `object.quaternion.copy(base)` then `object.rotateOnAxis(axis, angle)` for a unit axis (ax, ay, az): the product
 * `multiplyQuaternions` forms with `setFromAxisAngle`'s quaternion, and the Euler three derives from it. The copy's own
 * Euler is replaced before anything can read it, so it is derived once, for the product. */
export function turnFrom(object: THREE.Object3D, base: THREE.Quaternion, ax: number, ay: number, az: number, angle: number): void {
  if (!jointTurns.direct) { object.quaternion.copy(base); object.rotateOnAxis(axis.set(ax, ay, az), angle); return; }
  const half = angle / 2, s = Math.sin(half), qbx = ax * s, qby = ay * s, qbz = az * s, qbw = Math.cos(half);
  const b = base as unknown as QuaternionFields, qax = b._x, qay = b._y, qaz = b._z, qaw = b._w;
  const q = object.quaternion as unknown as QuaternionFields;
  q._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
  q._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
  q._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
  q._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
  object.rotation.setFromQuaternion(object.quaternion, undefined, false);
}
