import { Vector3, type Vector2 } from 'three/webgpu';
import type { IWaveSampler } from '../../vendor/threejs-water-pro/build/simulation/waves/IWaveSampler';

/** Presentation-only sampling: reuse the latest completed GPU result while one
 * readback is pending. A busy GPU must not stall ship rendering for buoy heights.
 * No simulation code consumes this adapter. The vendor sampler still owns the
 * actual wave query and cached results on both WebGPU and WebGL. */
export class VisualWaveSampler implements IWaveSampler {
  private positions: Vector3[] = [];
  private pending?: Promise<void>;
  private failure?: unknown;
  private stopped = false;
  constructor(private sampler: IWaveSampler) {}
  setPositions(positions: Vector2[] | Vector3[]): void {
    this.positions.length = positions.length;
    positions.forEach((p, i) => {
      this.positions[i] ??= new Vector3();
      this.positions[i].set(p.x, 'z' in p ? p.y : 0, 'z' in p ? p.z : p.y);
    });
  }
  private start(): void {
    if (this.pending || this.stopped) return;
    this.sampler.setPositions(this.positions);
    this.pending = this.sampler.update().catch(error => { this.failure = error; }).finally(() => { this.pending = undefined; });
  }
  async updateLowLatency(): Promise<void> {
    if (this.failure) throw this.failure;
    this.start();
  }
  /** Explicit fresh-data callers retain the blocking contract. */
  async update(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
    this.start(); await this.pending;
    if (this.failure) throw this.failure;
  }
  getSample(index: number) { return this.sampler.getSample(index); }
  getSamples() { return this.sampler.getSamples(); }
  getSampleCount() { return this.sampler.getSampleCount(); }
  updateCascadeUniforms() { this.sampler.updateCascadeUniforms(); }
  /** Drain before disposing the renderer or its GPU resources. */
  async drain(): Promise<void> { this.stopped = true; await this.pending; }
  dispose(): void {
    this.stopped = true;
    if (this.pending) void this.pending.then(() => this.sampler.dispose());
    else this.sampler.dispose();
  }
}
