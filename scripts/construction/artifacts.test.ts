import { expect, test } from 'bun:test';
import { publishedDefinition, sealModel, modelPayloadHash, encodeGlb } from './artifacts';
import type { ShipDefinition } from '../../src/ships/blueprint';

const definition = { id: 'local-test-old-build', modelUrl: '', contentHash: 'compiler-build-a', name: 'Test', handling: { forwardSpeed: 10 } } as ShipDefinition;
const model = (identity: string, position = 1) => encodeGlb({ asset: { version: '2.0' }, scene: 0,
  scenes: [{ extras: { definitionHash: identity }, nodes: [0] }], nodes: [{ extras: { definitionHash: identity }, translation: [position, 0, 0] }], buffers: [{ byteLength: 4 }] }, [{ type: 0x004e4942, bytes: Buffer.from([1, 2, 3, 4]) }]);

test('unrelated native build identities leave published definition and model bytes unchanged', () => {
  const before = publishedDefinition(definition, 'test', model('compiler-build-a'));
  const after = publishedDefinition({ ...definition, id: 'local-test-new-build', contentHash: 'compiler-build-b' }, 'test', model('compiler-build-b'));
  expect(after).toEqual(before);
  expect(sealModel(model('compiler-build-a'), before.contentHash!)).toEqual(sealModel(model('compiler-build-b'), after.contentHash!));
});
test('real gameplay and visual edits change the published identity', () => {
  const original = publishedDefinition(definition, 'test', model('a'));
  expect(publishedDefinition({ ...definition, name: 'New name' }, 'test', model('a')).contentHash).not.toBe(original.contentHash);
  expect(publishedDefinition(definition, 'test', model('a', 2)).contentHash).not.toBe(original.contentHash);
  const changedBytes = model('a'); changedBytes[changedBytes.length - 1] ^= 1;
  expect(publishedDefinition(definition, 'test', changedBytes).contentHash).not.toBe(original.contentHash);
});
test('sealing an exported candidate preserves its visual payload and is idempotent', () => {
  const original = model('a'), sealed = sealModel(original, 'b');
  expect(modelPayloadHash(sealed)).toBe(modelPayloadHash(original));
  expect(sealModel(sealed, 'b')).toEqual(sealed);
  expect(original).toEqual(model('a'));
});
test('malformed GLBs fail closed', () => {
  expect(() => modelPayloadHash(Buffer.from('broken'))).toThrow();
  const truncated = model('a').subarray(0, -1);
  expect(() => sealModel(truncated, 'b')).toThrow();
});
