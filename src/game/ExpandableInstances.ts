import * as THREE from 'three/webgpu';

/** Grow by small GPU allocations rather than imposing a gameplay count limit.
 * Separate the live draw count from WebGPU's fixed shader matrix capacity. */
export class ExpandableInstances<G extends THREE.BufferGeometry, M extends THREE.Material> extends THREE.InstancedMesh<G, M> {
  private overflow: THREE.InstancedMesh[] = [];
  constructor(geometry: G, material: M, private pageSize = 256) {
    super(geometry, material, pageSize);
    // Preserve the public geometry type and authored attributes, but separate
    // live draw count from Three's fixed shader matrix capacity.
    Object.assign(geometry, { isInstancedBufferGeometry: true, instanceCount: 0 });
    this.frustumCulled = false;
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanceMatrix.array.fill(0);
  }
  private page(index: number): THREE.InstancedMesh {
    const page = Math.floor(index / this.pageSize);
    while (this.overflow.length < page) {
      const geometry = this.geometry.clone();
      for (const [name, attr] of Object.entries(geometry.attributes)) if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute)
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(this.pageSize * attr.itemSize), attr.itemSize));
      const mesh = new THREE.InstancedMesh(geometry, this.material, this.pageSize);
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceMatrix.array.fill(0);
      this.overflow.push(mesh); this.add(mesh);
    }
    return page ? this.overflow[page - 1] : this;
  }
  override setMatrixAt(index: number, matrix: THREE.Matrix4): this {
    // InstancedMesh initializes matrices through this virtual method in super().
    if (!this.overflow) return super.setMatrixAt(index, matrix);
    const mesh = this.page(index);
    if (mesh === this) super.setMatrixAt(index, matrix); else mesh.setMatrixAt(index % this.pageSize, matrix);
    return this;
  }
  setScalarAttributeAt(name: string, index: number, value: number) {
    this.page(index).geometry.getAttribute(name).setX(index % this.pageSize, value);
  }
  publish(count: number) {
    [this, ...this.overflow].forEach((mesh, page) => {
      const live = Math.max(0, Math.min(this.pageSize, count - page * this.pageSize));
      Object.assign(mesh.geometry, { isInstancedBufferGeometry: true, instanceCount: live });
      mesh.visible = live > 0;
      mesh.instanceMatrix.array.fill(0, Math.max(0, count - page * this.pageSize) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      for (const attr of Object.values(mesh.geometry.attributes)) if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) attr.needsUpdate = true;
    });
  }
  override dispose() {
    for (const mesh of this.overflow) { mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose(); }
    this.overflow = []; super.dispose();
  }
}
