import { expect, test } from 'bun:test';
import { Euler, Vector3 } from 'three';
import type { ConstructionPrimitive, Vec3 } from './blueprint';
import { orientVector, unorientVector, rotateBlock, withBlockAngles } from './constructionOrientation';
import { mirroredPrimitive, decodeConstructionSource } from './constructionEditor';
import { cornerVertices, freeformEdit, worldVertex } from './constructionVertex';
import { customHullPrimitive } from './customHullModel';
import { makeHull } from './customHullStarter';
import { hullBounds } from '../ui/shipbuilding/builderReadings';
import { primitiveSnapFeatures } from '../ui/shipbuilding/snapping';
const base: ConstructionPrimitive = { id: 'a', kind: 'box', position: [3, 2, -1], size: [2, 4, 6], rotationDeg: 0 };
const close = (a: Vec3, b: Vec3) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 7));
const source = (p: ConstructionPrimitive) => ({ schemaVersion: 1 as const, id: 'orientation', name: 'Orientation', revision: 'r1', coordinates: 'meters-y-up-bow-negative-z' as const, construction: { version: 1 as const, catalogRevision: 'test', defaultThicknessMm: 10, primitives: [p], surfaces: [], equipment: [], boundaries: [], loads: [] } });

test('source orientation agrees with Three YXZ, inverses and world-axis turns at gimbal poles', () => {
  for (const angles of [[0, 15, 0], [24, 53, -33], [90, 45, 22], [-90, 60, 10], [179, -33, 88]] as Vec3[]) {
    const p = withBlockAngles(base, angles), v: Vec3 = [1.4, -2.2, 3.3];
    const [x, y, z] = angles.map(n => n * Math.PI / 180);
    close(orientVector(p, v), new Vector3(...v).applyEuler(new Euler(x, y, z, 'YXZ')).toArray());
    close(unorientVector(p, orientVector(p, v)), v);
    for (const axis of [0, 1, 2]) {
      const direction = new Vector3().setComponent(axis, 1);
      close(orientVector(rotateBlock(p, axis, 31), v), new Vector3(...orientVector(p, v)).applyAxisAngle(direction, 31 * Math.PI / 180).toArray());
      close(orientVector(rotateBlock(rotateBlock(p, axis, 90), axis, -90), v), orientVector(p, v));
    }
  }
});

test('tilted mirrored corners and asymmetric presets reflect across the ship centerline', () => {
  for (const kind of ['box', 'vertex', 'corner', 'inverse-corner'] as const) {
    const p = withBlockAngles({ ...base, kind }, [23, 41, -32]), twin = mirroredPrimitive(p);
    const back = mirroredPrimitive(twin);
    for (const v of cornerVertices(p)) close(worldVertex(back, v), worldVertex(p, v));
    // The rectangular envelope of a reflected tilted solid has the reflected world corners.
    const expected = cornerVertices(p).map(v => worldVertex(p, v).map((n, k) => k === 0 ? -n : n) as Vec3);
    for (const point of cornerVertices(twin).map(v => worldVertex(twin, v))) expect(expected.some(v => v.every((n, k) => Math.abs(n - point[k]) < 1e-7))).toBe(true);
  }
});

test('freeform, bounds, snapping and saved sources keep a pitched block in the same frame', () => {
  const p = rotateBlock(base, 0, 90), s = source(p);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(s)))).toEqual(s);
  const bounds = hullBounds(s)!; close(bounds.min, [2, -1, -3]); close(bounds.max, [4, 5, 1]);
  const corners = primitiveSnapFeatures(p).filter(f => f.kind === 'corner');
  for (const v of cornerVertices(p)) expect(corners.some(f => f.point.every((n, k) => Math.abs(n - worldVertex(p, v)[k]) < 1e-7))).toBe(true);
  const edited = freeformEdit(s, p.id, { mode: 'vertex', index: 0 }, [0, 1, 0], [false, false, false], false)[0];
  close(worldVertex(edited, cornerVertices(edited)[0]), worldVertex(p, cornerVertices(p)[0]).map((n, k) => n + (k === 2 ? 1 : 0)) as Vec3);
  const h = withBlockAngles(customHullPrimitive(makeHull(0)), [10, 20, 30]);
  expect(customHullPrimitive(makeHull(0), h).tilt).toEqual(h.tilt);
  expect(withBlockAngles(edited, [0, 0, 0]).tilt).toBeUndefined();
});

test('saved tilt rejects unknown versions and unbounded angles', () => {
  for (const tilt of [{ version: 2, pitchDeg: 0, rollDeg: 0 }, { version: 1, pitchDeg: 5000, rollDeg: 0 }, { version: 1, pitchDeg: '90', rollDeg: 0 }]) {
    expect(() => decodeConstructionSource(source({ ...base, tilt } as ConstructionPrimitive))).toThrow();
  }
});
