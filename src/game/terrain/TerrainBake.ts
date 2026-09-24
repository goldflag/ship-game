/** The land's open sky, baked once on the GPU when the terrain first renders.
 *
 * For every sample of the coarse attribute grid the bake walks 16 directions out to 2.8 km in 20 steps growing by a
 * quarter each, and finds how far the land rises above the sample's own tangent plane in each: the horizon the local
 * slope does not already hide. Each direction's slice of the sky is open down to that horizon, so its share of the
 * cosine-weighted sky is cos² of the horizon's angle; their mean is the sample's view factor of the sky. Valleys,
 * gullies, coves and the feet of cliffs receive less of the sky's light; ridges and open slopes all of it. A 1201²
 * grid takes 460 million height reads, a few milliseconds of GPU time, once per battle. */
import * as THREE from 'three/webgpu';
import { Fn, Loop, clamp, cos, float, int, ivec2, max, round, screenCoordinate, sin, textureLoad, vec2, vec4 } from 'three/tsl';

type Node<T extends string = string> = THREE.Node<T>;

export const SKY_DIRECTIONS = 16, SKY_STEPS = 20, SKY_FIRST_STEP_M = 40, SKY_STEP_GROWTH = 1.25;

export interface BakeGrid {
  readonly columns: number; readonly rows: number; readonly cell: number;
  /** Samples of the field per sample of the baked grid along each axis. */
  readonly stride: number;
  readonly coarse: { readonly columns: number; readonly rows: number };
}

let rendererState: ReturnType<typeof THREE.RendererUtils.resetRendererState> | undefined;

export class SkyBake {
  /** Open sky, 0–1, in the red channel, one texel per coarse sample. */
  readonly target: THREE.RenderTarget;
  private readonly quad: THREE.QuadMesh;
  private readonly material = new THREE.NodeMaterial();
  private baked = false;

  constructor(heights: THREE.DataTexture, gradients: THREE.DataTexture, grid: BakeGrid) {
    const { columns, rows, cell, stride, coarse } = grid;
    this.target = new THREE.RenderTarget(coarse.columns, coarse.rows, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false });
    Object.assign(this.target.texture, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, name: 'Terrain open sky' });
    const material = this.material;
    material.name = 'Terrain sky bake';
    material.fragmentNode = Fn(() => {
      // This texel's field sample, its height and the slope of its tangent plane.
      const texel = ivec2(screenCoordinate.xy), sample = texel.mul(stride);
      const base = textureLoad(heights, sample).r.toVar(), slope = textureLoad(gradients, sample).xy.toVar();
      const open = float(0).toVar();
      Loop(SKY_DIRECTIONS, ({ i }: { i: Node<'int'> }) => {
        const angle = float(i).mul(2 * Math.PI / SKY_DIRECTIONS).add(.2);
        const direction = vec2(cos(angle), sin(angle));
        const rise = slope.dot(direction);
        const horizon = float(0).toVar(), distance = float(SKY_FIRST_STEP_M).toVar();
        Loop(SKY_STEPS, () => {
          const at = vec2(sample).add(direction.mul(distance.div(cell)));
          const index = ivec2(int(clamp(round(at.x), 0, columns - 1)), int(clamp(round(at.y), 0, rows - 1)));
          const height = textureLoad(heights, index).r;
          horizon.assign(max(horizon, height.sub(base).div(distance).sub(rise)));
          distance.mulAssign(SKY_STEP_GROWTH);
        });
        open.addAssign(float(1).div(horizon.mul(horizon).add(1)));
      });
      return vec4(open.div(SKY_DIRECTIONS), 0, 0, 1);
    })();
    this.quad = new THREE.QuadMesh(material);
    this.quad.name = 'Terrain sky bake';
  }

  /** Bake once, before the first frame that samples the result. */
  run(renderer: THREE.WebGPURenderer): void {
    if (this.baked) return;
    this.baked = true;
    rendererState = THREE.RendererUtils.resetRendererState(renderer, rendererState!);
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    THREE.RendererUtils.restoreRendererState(renderer, rendererState);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
