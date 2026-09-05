import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';

/** Armor has its own depth buffer: plates occlude one another, while sea and hull stay behind them. */
export class ArmorOverlay {
  private target = new THREE.RenderTarget(1, 1, { depthBuffer: true, samples: 4 });
  private size = new THREE.Vector2();
  private clearColor = new THREE.Color();
  readonly color = texture(this.target.texture);
  readonly enabled = uniform(0);

  render(renderer: THREE.WebGPURenderer, camera: THREE.Camera, root: THREE.Group): void {
    renderer.getDrawingBufferSize(this.size);
    this.target.setSize(this.size.x, this.size.y);
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear, alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0, 0);
      renderer.autoClear = true;
      root.updateWorldMatrix(true, true);
      renderer.render(root, camera);
      this.enabled.value = 1;
    } finally {
      renderer.setRenderTarget(target);
      renderer.setClearColor(this.clearColor, alpha);
      renderer.autoClear = autoClear;
    }
  }
  dispose(): void { this.target.dispose(); }
}
