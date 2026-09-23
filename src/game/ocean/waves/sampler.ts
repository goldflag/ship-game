/** Presentation-only height readback: one small GPU pass evaluates the wave field's `heightAt`
 * (and a normal from central differences) at up to 128 world points, read back asynchronously.
 * Combat never reads it. */
import { DataTexture, FloatType, NearestFilter, NoBlending, NodeMaterial, QuadMesh, RGBAFormat, RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { int, ivec2, normalize, screenCoordinate, texture, vec2, vec3, vec4 } from 'three/tsl';
import type { WaveField, WaveHeightSampler } from '../contracts';

export const MAX_SAMPLES = 128;
/** Half the central-difference step (m): the normal of the surface smoothed over a metre. */
const NORMAL_STEP = .5;

export class GpuWaveHeightSampler implements WaveHeightSampler {
  readonly heights = new Float32Array(MAX_SAMPLES).fill(NaN);
  readonly normals = new Float32Array(MAX_SAMPLES * 3).fill(NaN);
  private readonly points = new DataTexture(new Float32Array(MAX_SAMPLES * 4), MAX_SAMPLES, 1, RGBAFormat, FloatType);
  private readonly target = new RenderTarget(MAX_SAMPLES, 1, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, generateMipmaps: false });
  private readonly quad: QuadMesh;
  private count = 0;
  private pending: Promise<void> | null = null;

  constructor(private readonly renderer: WebGPURenderer, field: WaveField) {
    this.points.minFilter = this.points.magFilter = NearestFilter;
    const read = texture(this.points).load(ivec2(int(screenCoordinate.x), 0));
    read.updateMatrix = false; // no per-read uv matrix uniform (see field.ts)
    const point = read.xy;
    const height = (dx: number, dz: number) => field.heightAt(point.add(vec2(dx, dz)));
    const normal = normalize(vec3(height(-NORMAL_STEP, 0).sub(height(NORMAL_STEP, 0)), 2 * NORMAL_STEP, height(0, -NORMAL_STEP).sub(height(0, NORMAL_STEP))));
    const material = new NodeMaterial();
    material.fragmentNode = vec4(height(0, 0), normal);
    material.depthTest = material.depthWrite = false;
    material.blending = NoBlending; material.toneMapped = false; material.fog = false;
    this.quad = new QuadMesh(material);
  }

  setPositions(points: readonly { x: number; z: number }[]): void {
    if (points.length > MAX_SAMPLES) throw new Error(`At most ${MAX_SAMPLES} wave height samples`);
    const data = this.points.image.data as Float32Array;
    points.forEach((p, i) => { data[i * 4] = p.x; data[i * 4 + 1] = p.z; });
    this.count = points.length;
    this.points.needsUpdate = true;
  }

  request(): void {
    if (this.pending || !this.count) return;
    const renderer = this.renderer, target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel(), mrt = renderer.getMRT();
    try {
      renderer.setMRT(null); renderer.setRenderTarget(this.target);
      this.quad.render(renderer);
    } finally { renderer.setRenderTarget(target, face, level); renderer.setMRT(mrt); }
    const count = this.count;
    this.pending = renderer.readRenderTargetPixelsAsync(this.target, 0, 0, MAX_SAMPLES, 1).then(pixels => {
      const values = pixels as Float32Array;
      for (let i = 0; i < count; i++) {
        this.heights[i] = values[i * 4];
        this.normals.set(values.subarray(i * 4 + 1, i * 4 + 4), i * 3);
      }
    }).finally(() => { this.pending = null; });
  }

  async refresh(): Promise<void> {
    await this.pending;
    this.request();
    await this.pending;
  }

  dispose(): void {
    this.points.dispose(); this.target.dispose(); (this.quad.material as NodeMaterial).dispose();
  }
}
