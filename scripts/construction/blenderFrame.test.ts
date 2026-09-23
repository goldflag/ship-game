import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { orientVector } from '../../src/ships/constructionOrientation';
import type { Vec3 } from '../../src/ships/blueprint';
import {
  TO_BLENDER,
  bearingToBlenderYaw,
  blenderWorld,
  blenderYawToBearing,
  blenderYawToRotation,
  fromBlender,
  rotationToBlenderYaw,
  sizeFromBlender,
  sizeToBlender,
  toBlender,
} from './blenderFrame';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((n, k) => expect(n).toBeCloseTo(b[k], 9));
/** Rotation about Blender +Z, counter-clockwise from above. */
const yawBlender = (degrees: number, v: Vec3): Vec3 => {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1], v[2]];
};

test('named directions land on the Blender authoring axes', () => {
  close(toBlender([0, 0, -1]), [1, 0, 0]); // bow
  close(toBlender([-1, 0, 0]), [0, 1, 0]); // port
  close(toBlender([0, 1, 0]), [0, 0, 1]); // up
  close(toBlender([1, 0, 0]), [0, -1, 0]); // starboard
  close(fromBlender([1, 0, 0]), [0, 0, -1]);
  close(sizeToBlender([2, 3, 40]), [40, 2, 3]);
  close(sizeFromBlender([40, 2, 3]), [2, 3, 40]);
});

test('the frame change is a proper rotation and round-trips both ways', () => {
  const [a, b, c] = TO_BLENDER;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  expect(det).toBe(1);
  for (const v of [[1, 2, 3], [-4.5, 0.25, -7], [1e-7, -3e3, 12]] as Vec3[]) {
    close(fromBlender(toBlender(v)), v);
    close(toBlender(fromBlender(v)), v);
    close(sizeFromBlender(sizeToBlender(v)), v);
    close(toBlender(v), TO_BLENDER.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));
  }
});

test('hull-piece yaw is the Blender Z rotation; equipment bearing is its negation', () => {
  for (const degrees of [0, 30, 90, 135, 180, 270, 359]) {
    // A hull piece: orientVector applies rotationDeg exactly as the compiler does.
    const bow: Vec3 = [0, 0, -1];
    close(toBlender(orientVector({ rotationDeg: degrees }, bow)), yawBlender(rotationToBlenderYaw(degrees), [1, 0, 0]));
    expect(blenderYawToRotation(rotationToBlenderYaw(degrees))).toBeCloseTo(degrees, 9);
    // Equipment: the compiler turns a part by −bearing about +Y, so bearing 90 faces starboard.
    const facing = orientVector({ rotationDeg: -degrees }, bow);
    close(toBlender(facing), yawBlender(bearingToBlenderYaw(degrees), [1, 0, 0]));
    expect(blenderYawToBearing(bearingToBlenderYaw(degrees))).toBeCloseTo(degrees, 9);
  }
  close(toBlender(orientVector({ rotationDeg: -90 }, [0, 0, -1])), [0, -1, 0]); // bearing 90: starboard
  expect(bearingToBlenderYaw(90)).toBe(270);
  expect(blenderYawToBearing(-30)).toBe(30);
  expect(blenderYawToBearing(360)).toBe(0);
});

test('a Blender world matrix yields construction location, yaw and what is not a yaw', () => {
  const yaw = 30,
    a = (yaw * Math.PI) / 180;
  const matrix = [
    [Math.cos(a), -Math.sin(a), 0, 5],
    [Math.sin(a), Math.cos(a), 0, -2],
    [0, 0, 1, 3],
    [0, 0, 0, 1],
  ];
  const world = blenderWorld(matrix);
  expect(world.yawDeg).toBeCloseTo(30, 9);
  expect(world.offYaw).toBeLessThan(1e-12);
  close(world.location, [2, 3, -5]);
  close(world.point([1, 0, 0]), fromBlender([5 + Math.cos(a), -2 + Math.sin(a), 3]));
  const scaled = blenderWorld([
    [2, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]);
  close(scaled.scale, [2, 1, 1]);
  expect(scaled.offYaw).toBe(1);
});

test('the Python twin agrees with the TypeScript module', () => {
  const run = spawnSync('python3', [join(import.meta.dir, 'blender/frame.py')], { encoding: 'utf8' });
  if (run.error || run.status !== 0) {
    console.warn('python3 is unavailable; the Python frame module was not compared.');
    return;
  }
  const table = JSON.parse(run.stdout) as Record<string, number[] | number[][]>;
  const points: Vec3[] = [[1, 2, 3], [-4.5, 0.25, -7], [0, 0, -1], [1, 0, 0], [0, 1, 0]];
  const angles = [0, 30, 90, 180, 270, -45, 725.5];
  const expected: Record<string, number[] | number[][]> = {
    toBlender: points.map(toBlender),
    fromBlender: points.map(fromBlender),
    sizeToBlender: points.map(sizeToBlender),
    sizeFromBlender: points.map(sizeFromBlender),
    bearingToBlenderYaw: angles.map(bearingToBlenderYaw),
    blenderYawToBearing: angles.map(blenderYawToBearing),
    rotationToBlenderYaw: angles.map(rotationToBlenderYaw),
    blenderYawToRotation: angles.map(blenderYawToRotation),
  };
  for (const [name, values] of Object.entries(expected)) close((table[name] as number[] | number[][]).flat(), (values as number[] | number[][]).flat());
});
