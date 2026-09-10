import * as THREE from 'three/webgpu';

export type FleetDrawState = {
  _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number;
  _indirectTexture: THREE.DataTexture;
};

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
  private readonly geometryGroups = new Map<number, { count: number; ids: number[] }>();

  invalidateDrawList(): void { this.drawCamera = undefined; }

  override onBeforeRender(...args: Parameters<THREE.BatchedMesh['onBeforeRender']>): void {
    const [, , camera, geometry, material] = args;
    const wireframe = 'wireframe' in material && !!material.wireframe;
    const reusable = !this.sortObjects && !(camera as THREE.ArrayCamera).isArrayCamera;
    if (reusable && this.drawCamera === camera && this.drawGeometry === geometry && this.wireframe === wireframe &&
      this.projection.equals(camera.projectionMatrix) && this.view.equals(camera.matrixWorldInverse) && this.world.equals(this.matrixWorld)) return;
    super.onBeforeRender(...args);
    if (!this.sortObjects && !material.transparent) this.groupGeometry();
    this.drawCamera = reusable ? camera : undefined; this.drawGeometry = geometry; this.wireframe = wireframe;
    this.projection.copy(camera.projectionMatrix); this.view.copy(camera.matrixWorldInverse); this.world.copy(this.matrixWorld);
  }

  /** Keep the culled instance-to-pose lookup, but put equal geometry ranges
   * together so WebGPU can submit them with one instanced draw. */
  private groupGeometry(): void {
    const state = this as unknown as FleetDrawState;
    const ids = state._indirectTexture.image.data! as Uint32Array;
    for (const group of this.geometryGroups.values()) group.ids.length = 0;
    for (let i = 0; i < state._multiDrawCount; i++) {
      const start = state._multiDrawStarts[i], count = state._multiDrawCounts[i];
      let group = this.geometryGroups.get(start);
      if (!group) this.geometryGroups.set(start, group = { count, ids: [] });
      group.count = count; group.ids.push(ids[i]);
    }
    let offset = 0;
    for (const [start, group] of this.geometryGroups) for (const id of group.ids) {
      state._multiDrawStarts[offset] = start; state._multiDrawCounts[offset] = group.count;
      ids[offset++] = id;
    }
  }
}
