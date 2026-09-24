import { expect, test } from 'bun:test';
import { namedShot, renderShots, texturedParts } from './referenceRender';
import { paintMaterials, geometryGroups, type ReferencePack } from '../../tools/ship-overlay/reference';
import type { ReferenceMeta } from './reference';

const bounds = { min: [-15, -9, -135], max: [15, 45, 135] } as ReferenceMeta['bounds'];

test('named shots frame the bounds the way ship:overlay does: bow right in side and top views', () => {
  const side = namedShot('side', bounds);
  expect(side.eye[0]).toBeGreaterThan(15);
  expect(side.up).toEqual([0, 1, 0]);
  expect(side.ortho).toBeCloseTo(270 * 1.04, 3);
  // Looking down with port up puts the bow (−Z) on the right.
  expect(namedShot('top', bounds).up).toEqual([-1, 0, 0]);
  expect(namedShot('front', bounds).eye[2]).toBeLessThan(-135);
  expect(namedShot('stern', bounds).eye[2]).toBeGreaterThan(135);
  // An offset moves the frame with the reference.
  expect(namedShot('side', bounds, [0, 0, 2.29]).target[2]).toBeCloseTo(2.29, 6);
});

test('render shots default to side and front, add one camera shot, and reject unknown names', () => {
  const meta = { bounds } as ReferenceMeta;
  expect(renderShots(meta, {}).map((shot) => shot.name)).toEqual(['side', 'front']);
  const custom = renderShots(meta, { camera: { eye: [20, 20, -60], target: [0, 16, -24] }, fov: 30 });
  expect(custom.map((shot) => shot.name)).toEqual(['camera']);
  expect(custom[0].fov).toBe(30);
  expect(renderShots(meta, { camera: 'broadside', ortho: 80 })[0].ortho).toBe(80);
  expect(() => renderShots(meta, { shots: ['bridge-ish'] })).toThrow(/Unknown shot/);
});

test('textured parts carry UVs and the paint texture, in ship metres with the reflected winding', () => {
  const pack = {
    vehicle: 'fixture', name: 'Fixture', url: 'https://example.invalid', fetchedAt: '', scheme: {}, omitted: [],
    paints: { default: 'Plain', camo: 'Camo' },
    models: {
      'visual/hull': {
        geometry: { '': { position: [0, 0, 0, 1, 0, 0, 0, 1, 1], index: [0, 1, 2], uv: [0, 0, 1, 0, 0, 1], groups: [{ start: 0, count: 3, material: 0 }] } },
        materials: { '': { default: [{ map: 'textures/hull_a.jpg' }], camo: [{ map: 'textures/hull_camo.jpg' }] } },
      },
    },
  } as unknown as ReferencePack;
  const root = { nodes: { HP_Hull: { visual: 'visual/hull' } } };
  const helpers = { paintMaterials, geometryGroups };
  const [bucket] = texturedParts(pack, root as never, {}, helpers);
  expect(bucket.texture).toBe('textures/hull_a.jpg');
  expect(bucket.uv).toEqual([0, 0, 0, 1, 1, 0]);
  // 15 m per unit with +Z reflected; corners 0, 2, 1 keep the face outward.
  expect(bucket.positions).toEqual([0, 0, 0, 0, 15, -15, 15, 0, 0]);
  expect(bucket.index).toEqual([0, 1, 2]);
  expect(texturedParts(pack, root as never, { paint: 'camo' }, helpers)[0].texture).toBe('textures/hull_camo.jpg');
  expect(texturedParts(pack, root as never, { offset: [0, 0, 2] }, helpers)[0].positions[2]).toBe(2);
  expect(texturedParts(pack, root as never, { parts: ['gun-main'] }, helpers)).toHaveLength(0);
  expect(() => texturedParts(pack, root as never, { paint: 'nope' }, helpers)).toThrow(/Unknown paint/);
});
