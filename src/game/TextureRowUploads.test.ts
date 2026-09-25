import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { AircraftPartsBatch } from './AircraftPartsBatch';
import { effectUploads } from './InstanceUploads';
import { flagTextureRows, installTextureRowUploads } from './TextureRowUploads';

/** Three r185's texture path for data textures, on the CPU: `Textures.updateTexture` makes the GPU texture on first use and
 * calls `backend.updateTexture` whenever the version moved; the backend's own update writes the whole image. */
function textureBackend() {
  const gpu = new Map<object, { width: number; height: number; depthOrArrayLayers: number; data: Float32Array }>();
  const versions = new Map<object, number>();
  const stats = { whole: 0, rows: 0, bytes: 0 };
  const backend = {
    device: { queue: { writeTexture(destination: { texture: { data: Float32Array }; origin: { y: number } }, data: Float32Array, layout: { offset: number; bytesPerRow: number }, size: { width: number; height: number }) {
      const words = layout.bytesPerRow / 4, from = layout.offset / 4;
      destination.texture.data.set(data.subarray(from, from + size.height * words), destination.origin.y * words);
      stats.rows++; stats.bytes += size.height * layout.bytesPerRow;
    } } },
    get(texture: object) { return { texture: gpu.get(texture) }; },
    updateTexture(texture: THREE.DataTexture) {
      const image = texture.image as { data: Float32Array };
      gpu.get(texture)!.data.set(image.data); stats.whole++; stats.bytes += image.data.byteLength;
    },
  };
  installTextureRowUploads(backend);
  /** One draw sampling `texture`, as three prepares it. */
  const draw = (texture: THREE.DataTexture) => {
    const image = texture.image as { data: Float32Array; width: number; height: number };
    if (!gpu.has(texture)) gpu.set(texture, { width: image.width, height: image.height, depthOrArrayLayers: 1, data: new Float32Array(image.data.length) });
    if (versions.get(texture) === texture.version) return;
    backend.updateTexture(texture); versions.set(texture, texture.version);
  };
  return { draw, stats, gpu: (texture: object) => gpu.get(texture)!.data };
}

const poses = (batch: AircraftPartsBatch) => (batch.mesh as unknown as { _matricesTexture: THREE.DataTexture })._matricesTexture;

test('aircraft poses upload only the rows their aircraft rewrote, and the GPU texture always matches the CPU one', () => {
  const material = new THREE.MeshBasicMaterial();
  const parts = [new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material)];
  parts.forEach((part, i) => { part.position.set(i, i * 2, -i); part.updateMatrixWorld(true); });
  const batch = new AircraftPartsBatch(parts, 'test'), backend = textureBackend(), matrix = new THREE.Matrix4();
  let seed = 3;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let wholeBytes = 0;
  try {
    for (let frame = 0; frame < 300; frame++) {
      // A few aircraft aloft, sometimes a squadron more (the batch grows its texture past 64), sometimes none; a frame now and then
      // is not drawn, so its rows wait for the next.
      const count = frame > 200 && frame < 210 ? 90 : frame % 40 < 3 ? 0 : 3 + Math.floor(random() * 6);
      for (let plane = 0; plane < count; plane++) batch.setPose(plane, matrix.makeTranslation(random() * 1e4, random() * 500, random() * 1e4));
      batch.publish(count);
      const texture = poses(batch), image = texture.image as { data: Float32Array };
      if (frame % 17 === 9) continue;
      backend.draw(texture);
      wholeBytes += image.data.byteLength;
      expect(Array.from(backend.gpu(texture))).toEqual(Array.from(image.data));
    }
    expect(backend.stats.rows).toBeGreaterThan(200);
    expect(backend.stats.bytes).toBeLessThan(wholeBytes * .2);
  } finally { batch.dispose(); parts.forEach(part => part.geometry.dispose()); material.dispose(); }
});

test('rows fall back to a whole upload for a new GPU texture, a write after the rows were flagged, or with versioned uploads off', () => {
  const backend = textureBackend(), data = new Float32Array(16 * 16 * 4), texture = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  backend.draw(texture);
  expect(backend.stats).toMatchObject({ whole: 1, rows: 0 });
  data[4 * 16 * 3] = 1; flagTextureRows(texture, 3, 4); backend.draw(texture);
  expect(backend.stats).toMatchObject({ whole: 1, rows: 1 });
  // Written after its rows were flagged: the version moved past them.
  data[4 * 16 * 5] = 2; flagTextureRows(texture, 5, 6); data[4 * 16 * 9] = 3; texture.needsUpdate = true; backend.draw(texture);
  expect(backend.stats).toMatchObject({ whole: 2, rows: 1 });
  effectUploads.versioned = false;
  try { data[0] = 4; flagTextureRows(texture, 0, 1); backend.draw(texture); } finally { effectUploads.versioned = true; }
  expect(backend.stats).toMatchObject({ whole: 3, rows: 1 });
  expect(Array.from(backend.gpu(texture))).toEqual(Array.from(data));
  texture.dispose();
});
