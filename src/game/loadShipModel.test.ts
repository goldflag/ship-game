import { afterEach, expect, spyOn, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { loadShipModel } from './loadShipModel';

// An actual GLB hierarchy exercises decompression through GLTFLoader's parser.
const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'hull', children: [1] }, { name: 'turret-pivot', translation: [2, 3, 4] }] });
const body = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
const model = Buffer.alloc(20 + body.length);
model.writeUInt32LE(0x46546c67, 0); model.writeUInt32LE(2, 4); model.writeUInt32LE(model.length, 8);
model.writeUInt32LE(body.length, 12); model.writeUInt32LE(0x4e4f534a, 16); body.copy(model, 20);
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined;
afterEach(() => fetchSpy?.mockRestore());

test('compressed ship transfers preserve the model hierarchy and poses under a deployment subpath', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(gzipSync(model)));
  const result = await loadShipModel('/naval/models/ship.glb', true);
  expect(fetchSpy).toHaveBeenCalledWith('/naval/models/ship.glb.gz');
  const turret = result.scene.getObjectByName('turret-pivot')!;
  expect(turret.parent?.name).toBe('hull');
  expect(turret.position.toArray()).toEqual([2, 3, 4]);
});

test('a host that already decoded gzip does not cause double decompression', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(model));
  expect((await loadShipModel('/models/ship.glb', true)).scene.getObjectByName('hull')).toBeDefined();
});

test('failed and corrupt transfers reject so the existing loading screen can offer a retry', async () => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(gzipSync(model).subarray(0, 12)));
  await expect(loadShipModel('/models/ship.glb', true)).rejects.toThrow('404');
  await expect(loadShipModel('/models/ship.glb', true)).rejects.toThrow();
});
