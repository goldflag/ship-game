import { expect, test } from 'bun:test';
import { Object3D, Vector3 } from 'three/webgpu';
import { MAX_GENERATORS, WakeGenerators, type WakeEmission } from './generators';

const STEP = 1 / 30;
/** Advance one frame that runs `steps` equal simulation steps and return their emissions. */
function frame(generators: WakeGenerators, steps = 1): WakeEmission[][] {
  generators.beginFrame();
  return Array.from({ length: steps }, (_, i) => { const out: WakeEmission[] = []; generators.step((i + 1) / steps, STEP, out); return out.map(e => ({ ...e })); });
}

test('the first step after adding only records the position, then the swept path is continuous', () => {
  const generators = new WakeGenerators(), hull = new Object3D();
  generators.add(hull, { depth: .3, radius: 8 });
  expect(frame(generators)[0]).toEqual([]);
  const emitted: WakeEmission[] = [];
  for (let i = 1; i <= 6; i++) {
    hull.position.x = i * .5;
    emitted.push(...frame(generators)[0]);
  }
  expect(emitted).toHaveLength(6);
  emitted.forEach((e, i) => {
    expect(e.x0).toBeCloseTo(i * .5, 9); expect(e.x1).toBeCloseTo((i + 1) * .5, 9);
    expect(e.depth).toBeCloseTo(.3, 9); expect(e.gate).toBe(1); expect(e.radius).toBe(8);
  });
});

test('steps inside one frame split the frame move, and slow motion fades the depth', () => {
  const generators = new WakeGenerators(), hull = new Object3D();
  generators.add(hull, { depth: .2 });
  frame(generators);
  hull.position.z = -3;
  const [first, second] = frame(generators, 2);
  expect(first[0]).toMatchObject({ x0: 0, z0: 0, x1: 0, z1: -1.5 });
  expect(second[0]).toMatchObject({ z0: -1.5, z1: -3 });
  hull.position.z -= .001; // 3 cm/s
  const [slow] = frame(generators);
  expect(slow[0].depth).toBeGreaterThan(0);
  expect(slow[0].depth).toBeLessThan(.2 * .01);
  expect(frame(generators)[0]).toEqual([]);
});

test('the offset turns with yaw only', () => {
  const generators = new WakeGenerators(), hull = new Object3D();
  generators.add(hull, { offset: new Vector3(0, 0, -100) });
  hull.position.set(10, 5, 20);
  hull.rotation.set(.3, Math.PI / 2, -.2, 'YXZ');
  frame(generators);
  hull.position.x += 1;
  const [[emission]] = frame(generators);
  expect(emission.x1).toBeCloseTo(11 - 100, 6);
  expect(emission.z1).toBeCloseTo(20, 6);
});

test('a teleport emits nothing and never streaks between the old and new positions', () => {
  const generators = new WakeGenerators(), hull = new Object3D();
  generators.add(hull, { teleportThreshold: 40 });
  frame(generators);
  hull.position.x = 1; frame(generators);
  hull.position.x = 500;
  expect(frame(generators, 3).flat()).toEqual([]);
  hull.position.x = 501;
  const [[emission]] = frame(generators);
  expect(emission.x0).toBe(500);
  expect(emission.x1).toBe(501);
});

test('inactive generators keep tracking, and restart forgets every position', () => {
  const generators = new WakeGenerators(), hull = new Object3D();
  const id = generators.add(hull, { active: false });
  frame(generators);
  hull.position.x = 30; expect(frame(generators)[0]).toEqual([]);
  generators.update(id, { active: true });
  hull.position.x = 31;
  expect(frame(generators)[0][0]).toMatchObject({ x0: 30, x1: 31 });
  generators.restart();
  hull.position.x = 32; expect(frame(generators)[0]).toEqual([]);
  hull.position.x = 33; expect(frame(generators)[0][0]).toMatchObject({ x0: 32, x1: 33 });
  expect(generators.update(99, {})).toBe(false);
  expect(generators.remove(id)).toBe(true);
  expect(generators.remove(id)).toBe(false);
});

test('the field holds at most sixteen generators', () => {
  const generators = new WakeGenerators();
  for (let i = 0; i < MAX_GENERATORS; i++) generators.add(new Object3D());
  expect(() => generators.add(new Object3D())).toThrow();
});
