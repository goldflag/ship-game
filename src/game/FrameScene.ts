import { Group, Scene } from 'three/webgpu';

/** Ocean capture, shadows and the final scene share one completed visual pose.
 * The first render updates matrices after water has moved its buoys/clipmap.
 * Explicit updates outside that render interval retain normal Three behavior. */
export class FrameScene extends Scene {
  private renderingFrame = false;
  private matricesReady = false;
  get isRenderingFrame(): boolean { return this.renderingFrame; }

  beginFrame(): void { this.renderingFrame = true; this.matricesReady = false; }
  endFrame(): void { this.renderingFrame = false; }

  override updateMatrixWorld(force?: boolean): void {
    if (this.renderingFrame && this.matricesReady && !force) return;
    super.updateMatrixWorld(force);
    this.matricesReady = true;
  }
}

/** Ship poses are explicitly completed before aircraft, decals and batch draws
 * consume them. The scene's subsequent capture pass can reuse those matrices. */
export class PreparedPoseGroup extends Group {
  override updateMatrixWorld(force?: boolean): void {
    if (this.parent instanceof FrameScene && this.parent.isRenderingFrame) return;
    super.updateMatrixWorld(force);
  }
}
