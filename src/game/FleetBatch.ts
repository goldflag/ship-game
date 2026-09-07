import * as THREE from 'three/webgpu';

/** Water's opaque capture and the main draw often use the same camera in
 * succession. Reuse that draw list within the completed fleet pose. A shadow
 * camera always replaces the cached list, so its culling remains independent. */
export class FleetBatch extends THREE.BatchedMesh {
  private drawCamera?: THREE.Camera;
  private drawGeometry?: THREE.BufferGeometry;
  private readonly projection = new THREE.Matrix4();
  private readonly view = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private wireframe = false;

  invalidateDrawList(): void { this.drawCamera = undefined; }

  override onBeforeRender(...args: Parameters<THREE.BatchedMesh['onBeforeRender']>): void {
    const [, , camera, geometry, material] = args;
    const wireframe = 'wireframe' in material && !!material.wireframe;
    const reusable = !this.sortObjects && !(camera as THREE.ArrayCamera).isArrayCamera;
    if (reusable && this.drawCamera === camera && this.drawGeometry === geometry && this.wireframe === wireframe &&
      this.projection.equals(camera.projectionMatrix) && this.view.equals(camera.matrixWorldInverse) && this.world.equals(this.matrixWorld)) return;
    super.onBeforeRender(...args);
    this.drawCamera = reusable ? camera : undefined; this.drawGeometry = geometry; this.wireframe = wireframe;
    this.projection.copy(camera.projectionMatrix); this.view.copy(camera.matrixWorldInverse); this.world.copy(this.matrixWorld);
  }
}
