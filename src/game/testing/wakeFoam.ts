/**
 * A CPU stand-in for `WakeFoamGpu`, so unit tests and the GPU comparison page can read wake
 * coverage back. The game paints only on the GPU. Each collector is rasterised with
 * `rasterizeStamp` (the per-ship `WakeFoam` reference raster) into its tile of a data texture
 * laid out like the GPU atlas: collector `i` in tile (i % tiles, ⌊i / tiles⌋), tile row 0 first.
 * With two channels the texels interleave red (trail foam) and green (slick), as `rg8unorm` does.
 */
import { DataTexture, RedFormat, RGFormat } from 'three/webgpu';
import { rasterizeStamp } from '../WakeFoam';
import { stampFrame, type WakeFoamPainter, type WakeFoamPainterFactory, type WakeStampCollector } from '../WakeFoamGpu';

export class CpuWakeFoamPainter implements WakeFoamPainter {
  readonly texture: DataTexture;
  private readonly pixels: Uint8Array;
  private readonly tile: Uint8Array[];
  private updates = 0;

  constructor(private readonly resolution: number, private readonly tiles: number, readonly channels: 1 | 2 = 1) {
    const size = resolution * tiles;
    this.pixels = new Uint8Array(size * size * channels);
    this.tile = Array.from({ length: channels }, () => new Uint8Array(resolution * resolution));
    this.texture = new DataTexture(this.pixels, size, size, channels === 2 ? RGFormat : RedFormat);
  }

  reserve(): void {}

  update(collectors: readonly WakeStampCollector[]): void {
    const { resolution, tiles, channels } = this;
    this.pixels.fill(0);
    collectors.forEach((collector, slot) => {
      this.tile.forEach(tile => tile.fill(0));
      const v = collector.values;
      for (let i = 0; i < collector.count * 8; i += 8) {
        const channel = v[i + 7] > 1.5 ? 1 : 0, frame = stampFrame(collector, channel);
        if (channel >= channels) continue;
        rasterizeStamp(this.tile[channel], resolution, frame.x, frame.z, v[i], v[i + 1], v[i + 2], v[i + 3], v[i + 4], v[i + 5], v[i + 6],
          v[i + 7] - 2 * channel > .5, frame.extent);
      }
      const tx = slot % tiles, ty = Math.floor(slot / tiles);
      for (let row = 0; row < resolution; row++) {
        const start = ((ty * resolution + row) * resolution * tiles + tx * resolution) * channels;
        if (channels === 1) { this.pixels.set(this.tile[0].subarray(row * resolution, (row + 1) * resolution), start); continue; }
        for (let x = 0; x < resolution; x++) for (let c = 0; c < channels; c++) this.pixels[start + x * channels + c] = this.tile[c][row * resolution + x];
      }
    });
    this.texture.needsUpdate = true;
    this.updates++;
  }

  diagnostics() { return { updates: this.updates }; }

  dispose(): void { this.texture.dispose(); }
}

export const cpuWakeFoamPainter: WakeFoamPainterFactory = (resolution, tiles, channels) => new CpuWakeFoamPainter(resolution, tiles, channels);
