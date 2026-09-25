import { expect, test } from 'bun:test';
import type { InstancedBufferAttribute } from 'three/webgpu';
import { GpuUploadModel, sameWords } from '../../testing/gpuUploads';
import { buildBolt } from './bolt';
import { BoltMesh } from './boltMesh';

test('a bolt uploads its channel once per strike, not again on every frame and pass its flash lasts', () => {
  const bolt = new BoltMesh(), model = new GpuUploadModel();
  const attributes = ['boltStart', 'boltEnd'].map(name => bolt.mesh.geometry.getAttribute(name) as InstancedBufferAttribute);
  let seed = 11;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  try {
    model.render(attributes);
    for (let strike = 0; strike < 3; strike++) {
      buildBolt(bolt.channel, random, [400 * strike, 1800, -200], [0, 2, 0]);
      bolt.upload();
      const before = model.bytes;
      // A flash of 20 frames, two passes each.
      for (let frame = 0; frame < 40; frame++) model.render(attributes);
      const count = bolt.mesh.geometry.instanceCount;
      expect(model.bytes - before).toBe(count * 4 * 4 * 2);
      for (const attribute of attributes) expect(sameWords(model.gpu(attribute), attribute.array as Float32Array, count * 4)).toBe(true);
    }
  } finally { bolt.dispose(); }
});
