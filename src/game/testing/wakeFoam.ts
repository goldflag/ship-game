/**
 * A CPU stand-in for `WakeFoamGpu`, so unit tests and the GPU comparison page can read wake
 * coverage back. The game paints only on the GPU. Each collector is rasterised with
 * `rasterizeStamp` (the per-ship `WakeFoam` reference raster) into its tile of a data texture
 * laid out like the GPU atlas: collector `i` in tile (i % tiles, ⌊i / tiles⌋), tile row 0 first.
 */
import { DataTexture, RedFormat } from 'three/webgpu';
import { rasterizeStamp } from '../WakeFoam';
import type { WakeFoamPainter, WakeFoamPainterFactory, WakeStampCollector } from '../WakeFoamGpu';

export class CpuWakeFoamPainter implements WakeFoamPainter {
  readonly texture: DataTexture;
  private readonly pixels: Uint8Array;
  private readonly tile: Uint8Array;
  private updates = 0;

  constructor(private readonly resolution: number, private readonly tiles: number) {
    const size = resolution * tiles;
    this.pixels = new Uint8Array(size * size);
    this.tile = new Uint8Array(resolution * resolution);
    this.texture = new DataTexture(this.pixels, size, size, RedFormat);
  }

  reserve(): void {}

  update(collectors: readonly WakeStampCollector[]): void {
    const { resolution, tiles, tile } = this;
    this.pixels.fill(0);
    collectors.forEach((collector, slot) => {
      tile.fill(0);
      const v = collector.values;
      for (let i = 0; i < collector.count * 8; i += 8) {
        rasterizeStamp(tile, resolution, collector.centerX, collector.centerZ, v[i], v[i + 1], v[i + 2], v[i + 3], v[i + 4], v[i + 5], v[i + 6], v[i + 7] > .5);
      }
      const tx = slot % tiles, ty = Math.floor(slot / tiles);
      for (let row = 0; row < resolution; row++) {
        this.pixels.set(tile.subarray(row * resolution, (row + 1) * resolution), (ty * resolution + row) * resolution * tiles + tx * resolution);
      }
    });
    this.texture.needsUpdate = true;
    this.updates++;
  }

  diagnostics() { return { updates: this.updates }; }

  dispose(): void { this.texture.dispose(); }
}

export const cpuWakeFoamPainter: WakeFoamPainterFactory = (resolution, tiles) => new CpuWakeFoamPainter(resolution, tiles);
