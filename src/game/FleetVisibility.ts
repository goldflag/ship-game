import * as THREE from 'three/webgpu';
import type { FocusShadowNode } from './FocusShadowNode';
import type { ShipView } from './ShipView';

/** Rotation-independent reach of every retained surface. Summing each path's
 * translations is deliberately conservative through traverse, recoil and roll. */
export function articulatedRadius(root: THREE.Object3D, recoil: number): number {
  let radius = 0;
  const visit = (object: THREE.Object3D, distance: number, scale: number): void => {
    const travel = String(object.userData.nodeId ?? '').endsWith('.recoil') ? recoil : 0;
    distance += (object.position.length() + travel) * scale;
    scale *= Math.max(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z));
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      if (geometry.boundingSphere) radius = Math.max(radius, distance + scale *
        (geometry.boundingSphere.center.length() + geometry.boundingSphere.radius));
    }
    for (const child of object.children) visit(child, distance, scale);
  };
  visit(root, 0, 1);
  return radius;
}

/** Skip visual preparation only outside both the view and every sun shadow map's
 * volume. Hull motion and the complete CPU simulation continue normally. Also fits the
 * sun's view shadow maps around the ships in view, which only this pass knows. */
export class FleetVisibility {
  private readonly bounds = new WeakMap<ShipView, { radius: number; sphere: THREE.Sphere }>();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly casters: THREE.Sphere[] = [];
  private readonly inView = new Set<ShipView>();

  /** `lens` is the optical magnification, which stretches how far view shadows reach. */
  update(views: readonly ShipView[], camera: THREE.PerspectiveCamera, sun: FocusShadowNode, force = false, lens = 1): void {
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    this.casters.length = 0; this.inView.clear();
    for (const view of views) {
      let bounds = this.bounds.get(view);
      if (!bounds) {
        bounds = { radius: Math.max(articulatedRadius(view.model, Math.max(0, ...view.definition.mounts.map(m => m.weapon.recoilM))), articulatedRadius(view.rig.root, 0)), sphere: new THREE.Sphere() };
        this.bounds.set(view, bounds);
      }
      const sphere = bounds.sphere;
      sphere.set(view.root.position, bounds.radius * Math.max(Math.abs(view.root.scale.x), Math.abs(view.root.scale.y), Math.abs(view.root.scale.z)));
      if (!this.frustum.intersectsSphere(sphere)) continue;
      this.inView.add(view);
      if (view.root.visible && view.inspection.mode === 'exterior') this.casters.push(sphere);
    }
    // Forced passes (port, warm-up) keep every hull prepared and fit no view maps: in port
    // the wide map is fitted to the berthed hull, whose bounding sphere still overhangs it.
    sun.fitView(camera, force ? [] : this.casters, lens);
    const lights = sun.sun.castShadow ? [sun.sun, ...sun.activeViews] : [];
    const shadows = lights.map(light => {
      light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
      light.shadow.updateMatrices(light as THREE.DirectionalLight);
      return light.shadow.getFrustum();
    });
    for (const view of views) {
      const sphere = this.bounds.get(view)!.sphere;
      view.renderActive = force || view.inspection.mode !== 'exterior' || this.inView.has(view) || shadows.some(shadow => shadow.intersectsSphere(sphere));
      view.rig.root.visible = view.renderActive && view.inspection.mode === 'exterior';
    }
  }
}
