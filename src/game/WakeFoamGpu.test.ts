import { expect, test } from 'bun:test';
import type { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, WebGPURenderer } from 'three/webgpu';
import { WakeFoamGpu, WakeStampCollector } from './WakeFoamGpu';

/** Enough of a renderer for the painter's CPU side: its draw is not what these tests read. */
const renderer = { getRenderTarget: () => null, autoClear: true, getClearAlpha: () => 1, getClearColor: <T>(color: T) => color, setClearColor() {}, setRenderTarget() {}, render() {} } as unknown as WebGPURenderer;
const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const NAMES = ['wakeBox', 'wakeAxes', 'wakeShape'];
const quads = (painter: WakeFoamGpu) => (painter as unknown as { mesh: Mesh<InstancedBufferGeometry> }).mesh.geometry;

test('a painter that keeps unchanged tiles lays and uploads the quads a fresh painter would', () => {
  const random = seeded(9), kept = new WakeFoamGpu(renderer, 128, 8, 2);
  const tiles = Array.from({ length: 24 }, () => new WakeStampCollector());
  const paint = (tile: WakeStampCollector) => {
    tile.begin((random() - .5) * 6000, (random() - .5) * 6000, (random() - .5) * 6000, (random() - .5) * 6000);
    for (let i = Math.floor(random() * (random() < .1 ? 700 : 120)); i > 0; i--)
      tile.stamp(tile.centerX + (random() - .5) * 1700, tile.centerZ + (random() - .5) * 1700, random() - .5, random() - .5, 1 + random() * 30, 1 + random() * 30, random(), random() < .2, random() < .3 ? 1 : 0);
  };
  // What the GPU holds: the first upload sends every buffer whole, later ones their flagged ranges.
  const gpu = new Map<InstancedBufferAttribute, { data: Float32Array; version: number }>();
  for (let round = 0; round < 150; round++) {
    for (const tile of tiles) if (round === 0 || random() < .15) paint(tile);
    let list = tiles.slice(0, 16 + Math.floor(random() * 8));
    if (round % 37 === 36) list = [...list].reverse();
    if (round % 23 === 22) list = list.filter((_, i) => i % 4);
    kept.update(list);
    const fresh = new WakeFoamGpu(renderer, 128, 8, 2);
    fresh.update(list);
    const a = quads(kept), b = quads(fresh), count = b.instanceCount;
    expect(a.instanceCount).toBe(count);
    for (const name of NAMES) {
      const attribute = a.getAttribute(name) as InstancedBufferAttribute, array = attribute.array as Float32Array;
      expect(Array.from(array.subarray(0, count * 4))).toEqual(Array.from((b.getAttribute(name).array as Float32Array).subarray(0, count * 4)));
      let copy = gpu.get(attribute);
      if (!copy) gpu.set(attribute, copy = { data: array.slice(), version: attribute.version });
      else if (copy.version !== attribute.version) {
        for (const range of attribute.updateRanges) copy.data.set(array.subarray(range.start, range.start + range.count), range.start);
        copy.version = attribute.version; attribute.clearUpdateRanges();
      }
      expect(Array.from(copy.data.subarray(0, count * 4))).toEqual(Array.from(array.subarray(0, count * 4)));
    }
    fresh.dispose();
  }
  kept.dispose();
});

test('shifted quads move on the GPU and only repainted tiles upload, leaving what dynamic uploads left at every draw', async () => {
  const { GpuUploadModel, sameWords } = await import('./testing/gpuUploads');
  const { effectUploads } = await import('./InstanceUploads');
  const random = seeded(31), models = { versioned: new GpuUploadModel(), dynamic: new GpuUploadModel(), refused: new GpuUploadModel() };
  // A renderer whose draw is the modelled upload of the painter's quads.
  const drawing = (model: InstanceType<typeof GpuUploadModel>) => ({ ...renderer, render(scene: { children: Mesh<InstancedBufferGeometry>[] }) {
    model.render(NAMES.map(name => scene.children[0].geometry.getAttribute(name) as InstancedBufferAttribute));
  } }) as unknown as WebGPURenderer;
  const painters = {
    versioned: new WakeFoamGpu(drawing(models.versioned), 128, 8, 2, models.versioned.moveInstances),
    dynamic: new WakeFoamGpu(drawing(models.dynamic), 128, 8, 2, models.dynamic.moveInstances),
    refused: new WakeFoamGpu(drawing(models.refused), 128, 8, 2, () => false),
  };
  const tiles = Array.from({ length: 30 }, () => new WakeStampCollector());
  const paint = (tile: WakeStampCollector) => {
    tile.begin((random() - .5) * 6000, (random() - .5) * 6000, (random() - .5) * 6000, (random() - .5) * 6000);
    for (let i = 40 + Math.floor(random() * 300); i > 0; i--)
      tile.stamp(tile.centerX + (random() - .5) * 1700, tile.centerZ + (random() - .5) * 1700, random() - .5, random() - .5, 1 + random() * 30, 1 + random() * 30, random(), random() < .2, random() < .3 ? 1 : 0);
  };
  try {
    for (let round = 0; round < 200; round++) {
      // Most rounds repaint a few tiles, as trails refresh at 5 to 20 Hz; now and then the fleet changes.
      for (const tile of tiles) if (round === 0 || random() < .08) paint(tile);
      const list = round % 50 === 49 ? tiles.filter((_, i) => i % 7) : tiles;
      for (const [key, painter] of Object.entries(painters)) {
        effectUploads.versioned = key !== 'dynamic';
        painter.update(list);
      }
      effectUploads.versioned = true;
      const count = quads(painters.dynamic).instanceCount;
      for (const [key, painter] of Object.entries(painters)) {
        const geometry = quads(painter), model = models[key as keyof typeof models];
        expect(geometry.instanceCount).toBe(count);
        for (const name of NAMES) {
          const attribute = geometry.getAttribute(name) as InstancedBufferAttribute;
          expect(sameWords(model.gpu(attribute), attribute.array as Float32Array, count * 4)).toBe(true);
          expect(sameWords(attribute.array as Float32Array, quads(painters.dynamic).getAttribute(name).array as Float32Array, count * 4)).toBe(true);
        }
      }
    }
    // Moving shifted quads on the GPU leaves a fraction of the uploads; refusing moves sends them as before.
    expect(models.versioned.moved).toBeGreaterThan(0);
    expect(models.versioned.bytes).toBeLessThan(models.dynamic.bytes * .4);
    expect(models.refused.bytes).toBeLessThanOrEqual(models.dynamic.bytes);
    expect(models.refused.moved).toBe(0);
  } finally { effectUploads.versioned = true; Object.values(painters).forEach(painter => painter.dispose()); }
});

test('a draw that did not upload leaves the painter sending everything it draws once more', async () => {
  const { GpuUploadModel, sameWords } = await import('./testing/gpuUploads');
  const random = seeded(7), model = new GpuUploadModel();
  let draws = true;
  const skipping = { ...renderer, render(scene: { children: Mesh<InstancedBufferGeometry>[] }) {
    if (draws) model.render(NAMES.map(name => scene.children[0].geometry.getAttribute(name) as InstancedBufferAttribute));
  } } as unknown as WebGPURenderer;
  const painter = new WakeFoamGpu(skipping, 128, 8, 2, model.moveInstances), tiles = Array.from({ length: 12 }, () => new WakeStampCollector());
  try {
    for (let round = 0; round < 120; round++) {
      for (const tile of tiles) if (round === 0 || random() < .2) {
        tile.begin(random() * 100, random() * 100);
        for (let i = 10 + Math.floor(random() * 80); i > 0; i--) tile.stamp(random() * 100, random() * 100, 1, 0, 5, 5, random(), false);
      }
      draws = round % 9 !== 4;
      painter.update(tiles);
      if (!draws) continue;
      const geometry = quads(painter);
      for (const name of NAMES) { const attribute = geometry.getAttribute(name) as InstancedBufferAttribute;
        expect(sameWords(model.gpu(attribute), attribute.array as Float32Array, geometry.instanceCount * 4)).toBe(true); }
    }
  } finally { painter.dispose(); }
});
