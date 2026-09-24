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
