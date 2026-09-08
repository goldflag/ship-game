import * as THREE from 'three/webgpu';
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

/** Skip visual preparation only outside both the view and the sun's shadow
 * volume. Hull motion and the complete CPU simulation continue normally. */
export class FleetVisibility {
  private readonly bounds = new WeakMap<ShipView, number>();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  update(views: readonly ShipView[], camera: THREE.Camera, light: THREE.DirectionalLight, force = false): void {
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
    light.shadow.updateMatrices(light);
    const shadows = light.shadow.getFrustum();
    for (const view of views) {
      let radius = this.bounds.get(view);
      if (radius === undefined) {
        radius = Math.max(articulatedRadius(view.model, Math.max(0, ...view.definition.mounts.map(m => m.weapon.recoilM))), articulatedRadius(view.rig.root, 0));
        this.bounds.set(view, radius);
      }
      this.sphere.set(view.root.position, radius * Math.max(Math.abs(view.root.scale.x), Math.abs(view.root.scale.y), Math.abs(view.root.scale.z)));
      view.renderActive = force || view.inspection.mode !== 'exterior' || this.frustum.intersectsSphere(this.sphere) ||
        (light.castShadow && shadows.intersectsSphere(this.sphere));
      view.rig.root.visible = view.renderActive && view.inspection.mode === 'exterior';
    }
  }
}
