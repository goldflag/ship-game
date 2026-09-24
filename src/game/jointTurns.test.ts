import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { jointTurns, setJointsX, setJointY, turnFrom } from './jointTurns';

type Fields = { _x: number; _y: number; _z: number; _w?: number; _order?: string };
const state = (object: THREE.Object3D) => {
  const r = object.rotation as unknown as Fields, q = object.quaternion as unknown as Fields;
  return [r._x, r._y, r._z, r._order, q._x, q._y, q._z, q._w];
};
const identical = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

let seed = 5;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
// Zeros of both signs, half and whole turns, large angles and NaN, besides ordinary ones.
const angles = [0, -0, Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, 2 * Math.PI, 1e-300, -1e-300, 1e6, -123.456, NaN,
  ...Array.from({ length: 4000 }, () => (random() - .5) * 20)];

test('single-axis joint turns write the Euler and quaternion three writes, bit for bit', () => {
  const direct = new THREE.Object3D(), reference = new THREE.Object3D(), barrels = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
  for (const angle of angles) {
    // Whatever the joint held before, as a glTF node's quaternion would decompose into.
    for (const o of [direct, reference]) o.quaternion.set(random(), random(), random(), random()).normalize();
    setJointY(direct, angle); reference.rotation.set(0, angle, 0);
    expect(identical(state(direct), state(reference))).toBe(true);
    setJointsX([direct], angle); reference.rotation.set(angle, 0, 0);
    expect(identical(state(direct), state(reference))).toBe(true);
    // Barrels sharing one elevation share its trigonometry.
    for (const o of barrels) o.quaternion.set(random(), random(), random(), random()).normalize();
    setJointsX(barrels, angle);
    for (const o of barrels) expect(identical(state(o), state(reference))).toBe(true);
    direct.updateMatrix(); reference.updateMatrix();
    expect(identical(direct.matrix.elements, reference.matrix.elements)).toBe(true);
  }
});

test('another Euler order and the comparison switch go through three', () => {
  const direct = new THREE.Object3D(), reference = new THREE.Object3D();
  direct.rotation.order = reference.rotation.order = 'YXZ';
  for (const angle of angles.slice(0, 200)) {
    setJointY(direct, angle); reference.rotation.set(0, angle, 0);
    expect(identical(state(direct), state(reference))).toBe(true);
    setJointsX([direct], angle); reference.rotation.set(angle, 0, 0);
    expect(identical(state(direct), state(reference))).toBe(true);
  }
  jointTurns.direct = false;
  try {
    const other = new THREE.Object3D();
    setJointY(other, 1.25); reference.rotation.order = 'XYZ'; reference.rotation.set(0, 1.25, 0);
    expect(identical(state(other), state(reference))).toBe(true);
  } finally { jointTurns.direct = true; }
});

test('turning from a rest quaternion matches copy and rotateOnAxis, Euler included', () => {
  const direct = new THREE.Object3D(), reference = new THREE.Object3D(), base = new THREE.Quaternion();
  const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-0, 1, -0], [.6, 0, .8]];
  for (const angle of angles) {
    base.set(random() - .5, random() - .5, random() - .5, random() - .5).normalize();
    if (random() < .1) base.identity();
    for (const [x, y, z] of axes) {
      for (const order of ['XYZ', 'ZYX'] as const) {
        direct.rotation.order = reference.rotation.order = order;
        turnFrom(direct, base, x, y, z, angle);
        reference.quaternion.copy(base); reference.rotateOnAxis(new THREE.Vector3(x, y, z), angle);
        expect(identical(state(direct), state(reference))).toBe(true);
      }
    }
  }
  // The three methods the ship view used before: rotateY, rotateZ and rotateX, whose axes are these.
  for (const [turn, axis] of [['rotateX', [1, 0, 0]], ['rotateY', [0, 1, 0]], ['rotateZ', [0, 0, 1]]] as const) {
    for (const angle of angles.slice(0, 500)) {
      turnFrom(direct, base, axis[0], axis[1], axis[2], angle);
      reference.quaternion.copy(base); reference[turn](angle);
      expect(identical(state(direct), state(reference))).toBe(true);
    }
  }
});
