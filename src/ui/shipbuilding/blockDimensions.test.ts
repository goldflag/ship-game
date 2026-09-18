import { expect, test } from 'bun:test';
import type { ConstructionPrimitive, ConstructionSource } from '../../ships/blueprint';
import { editableMesh, scaleMeshRing } from '../../ships/constructionMesh';
import { cornerVertices, freeformEdit } from '../../ships/constructionVertex';
import { blockDimensions, resizeBlock } from './blockDimensions';

const block: ConstructionPrimitive = { id: 'block', kind: 'box', position: [7, 2, -9], rotationDeg: 90, size: [4, 4, 4] };

test('measured dimensions and subsequent numeric resize follow a freeform face edit', () => {
  const source = { construction: { primitives: [block] } } as ConstructionSource;
  const [edited] = freeformEdit(source, block.id, { mode: 'face', index: 5 }, [0, 1, 0], [false, false, false], false);
  expect(edited.size).toEqual([4, 4, 4]);
  expect(blockDimensions(edited)).toEqual([4, 5, 4]);
  const resized = resizeBlock(edited, 1, 7);
  blockDimensions(resized).forEach((value, axis) => expect(value).toBeCloseTo([4, 7, 4][axis], 9));
  expect(resized.position).toEqual(block.position);
  expect(resized.rotationDeg).toBe(90);
  expect(blockDimensions(edited)).toEqual([4, 5, 4]);
});

test('curved topology measures edited rings and retains the taper on numeric resize', () => {
  const cylinder = editableMesh({ ...block, kind: 'cylinder' });
  const edited = scaleMeshRing(cylinder, 0, 0, 1.5);
  expect(blockDimensions(edited)).toEqual([6, 4, 4]);
  const resized = resizeBlock(edited, 0, 9);
  expect(blockDimensions(resized)).toEqual([9, 4, 4]);
  expect(resized.mesh?.faces).toEqual(edited.mesh?.faces);
  expect(resized.mesh?.vertices.map(v => v[0])).toEqual(edited.mesh?.vertices.map(v => v[0] * 1.5));
});

test('treated deformed blocks resize the rendered envelope without changing the treatment', () => {
  const primitive: ConstructionPrimitive = { ...block, kind: 'vertex', vertices: cornerVertices(block).map(v => [v[0] + v[1] * .4, v[1], v[2]]),
    shaping: { version: 1, edges: [0, 1, 2, 3], radius: .5, style: 'round' } };
  const resized = resizeBlock(primitive, 0, 8);
  expect(blockDimensions(resized)[0]).toBeCloseTo(8, 9);
  expect(resized.shaping).toEqual(primitive.shaping);
  expect(resized.vertices?.map(v => v.slice(1))).toEqual(primitive.vertices?.map(v => v.slice(1)));
});
