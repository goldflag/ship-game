import { Frustum, Matrix4, Sphere, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { ShipView } from './ShipView';

/** Spend the existing water/light budget on the hull being examined through
 * the lens. Selection uses the rendered camera, not combat targeting. */
export class WaterViewFocus {
  private readonly frustum = new Frustum();
  private readonly projection = new Matrix4();
  private readonly bounds = new Sphere();
  private readonly center = new Vector3();
  private readonly baseDistance: number;

  constructor(private readonly ssr: { maxDistance: number }) {
    this.baseDistance = ssr.maxDistance;
  }

  update(views: readonly ShipView[], camera: PerspectiveCamera, enabled: boolean): Vector3 | undefined {
    this.ssr.maxDistance = this.baseDistance;
    if (!enabled) return;
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    let focus: ShipView | undefined, best = Infinity;
    for (const view of views) {
      if (!view.root.visible || view.inspection.mode !== 'exterior') continue;
      this.bounds.set(view.root.position, view.definition.hull.length * .6);
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      this.center.copy(view.root.position).applyMatrix4(camera.matrixWorldInverse);
      if (this.center.z >= -camera.near) continue;
      this.center.copy(view.root.position).project(camera);
      const score = this.center.x ** 2 + this.center.y ** 2;
      if (score < best) { best = score; focus = view; }
    }
    if (!focus) return;
    // A grazing mirror ray can travel a substantial fraction of target range.
    // Keep confidence through that span without increasing the DDA step cap.
    this.ssr.maxDistance = Math.max(this.baseDistance, Math.min(camera.far, camera.position.distanceTo(focus.root.position) * 2));
    return focus.root.position;
  }
}
