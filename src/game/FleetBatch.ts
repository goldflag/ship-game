import * as THREE from 'three/webgpu';

export type FleetDrawState = {
  _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number;
  _indirectTexture: THREE.DataTexture;
};
type CullState = FleetDrawState & {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number }[];
  _matricesTexture: THREE.DataTexture;
  _visibilityChanged: boolean;
};
type Group = { count: number; ids: number[] };

const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), pose = new THREE.Matrix4(), sphere = new THREE.Sphere();

/** Water's opaque capture and the main draw often use the same camera in
 * succession. Reuse that draw list within the completed fleet pose. A shadow
 * camera always replaces the cached list, so its culling remains independent.
 * Each part's world bounds are kept from its last pose, so the occlusion prepass
 * and the main pass, whose far planes differ, each only test them. */
export class FleetBatch extends THREE.BatchedMesh {
  /** Off: three's own culling, which transforms every part's bounds in every pass, for comparison. */
  static keepBounds = true;
  private drawCamera?: THREE.Camera;
  private drawGeometry?: THREE.BufferGeometry;
  private readonly projection = new THREE.Matrix4();
  private readonly view = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private wireframe = false;
  private readonly geometryGroups = new Map<number, Group>();
  /** Per instance: world bounds as three's culling computes them (centre, radius), and the geometry they are for (-1: none). */
  private bounds = new Float64Array(0);
  private boundsGeometry = new Int32Array(0);
  /** The matrix texture and version the bounds follow; any other write to it discards them all. */
  private boundsTexture?: THREE.DataTexture;
  private boundsVersion = -1;
  /** Per geometry: its group of consecutive draws, for the index width they were keyed with. */
  private groupOf: (Group | undefined)[] = [];
  private groupBytes = 0;

  invalidateDrawList(): void { this.drawCamera = undefined; }

  override onBeforeRender(...args: Parameters<THREE.BatchedMesh['onBeforeRender']>): void {
    const [, , camera, geometry, material] = args;
    const wireframe = 'wireframe' in material && !!material.wireframe;
    const reusable = !this.sortObjects && !(camera as THREE.ArrayCamera).isArrayCamera;
    if (reusable && this.drawCamera === camera && this.drawGeometry === geometry && this.wireframe === wireframe &&
      this.projection.equals(camera.projectionMatrix) && this.view.equals(camera.matrixWorldInverse) && this.world.equals(this.matrixWorld)) return;
    if (FleetBatch.keepBounds && reusable && this.perObjectFrustumCulled && !wireframe) this.cull(camera, geometry, material);
    else {
      super.onBeforeRender(...args);
      if (!this.sortObjects && !material.transparent) this.groupGeometry();
    }
    this.drawCamera = reusable ? camera : undefined; this.drawGeometry = geometry; this.wireframe = wireframe;
    this.projection.copy(camera.projectionMatrix); this.view.copy(camera.matrixWorldInverse); this.world.copy(this.matrixWorld);
  }

  override setMatrixAt(instanceId: number, matrix: THREE.Matrix4): this {
    const texture = (this as unknown as CullState)._matricesTexture, known = texture === this.boundsTexture && texture.version === this.boundsVersion;
    super.setMatrixAt(instanceId, matrix);
    // The part's bounds follow while its pose is at hand; after an unknown write the next cull redoes them all.
    if (known) { this.boundsVersion = texture.version; this.bound(instanceId); }
    return this;
  }
  override addInstance(geometryId: number): number {
    const texture = (this as unknown as CullState)._matricesTexture, known = texture === this.boundsTexture && texture.version === this.boundsVersion;
    const id = super.addInstance(geometryId);
    if (known) this.boundsVersion = texture.version;
    this.reserve(id); this.boundsGeometry[id] = -1;
    return id;
  }
  // Ranges, bounds or the matrix texture itself change: every cached bound and group goes.
  override setGeometryAt(geometryId: number, geometry: THREE.BufferGeometry): number { this.forget(); return super.setGeometryAt(geometryId, geometry); }
  override deleteGeometry(geometryId: number): this { this.forget(); return super.deleteGeometry(geometryId); }
  override optimize(): this { this.forget(); return super.optimize(); }
  override setGeometrySize(maxVertexCount: number, maxIndexCount: number): void { this.forget(); super.setGeometrySize(maxVertexCount, maxIndexCount); }
  override setInstanceCount(maxInstanceCount: number): void { this.forget(); super.setInstanceCount(maxInstanceCount); }
  override copy(source: THREE.BatchedMesh): this { this.forget(); return super.copy(source); }

  private forget(): void { this.boundsTexture = undefined; this.groupOf = []; }

  private reserve(instanceId: number): void {
    if (instanceId < this.boundsGeometry.length) return;
    const size = Math.max(instanceId + 1, this.maxInstanceCount, this.boundsGeometry.length * 2);
    const bounds = new Float64Array(size * 4), geometries = new Int32Array(size).fill(-1);
    bounds.set(this.bounds); geometries.set(this.boundsGeometry);
    this.bounds = bounds; this.boundsGeometry = geometries;
  }

  /** The instance's world bounds exactly as three's per-object culling derives them from the matrix texture. */
  private bound(instanceId: number): void {
    const geometryId = (this as unknown as CullState)._instanceInfo[instanceId].geometryIndex;
    this.getMatrixAt(instanceId, pose);
    this.getBoundingSphereAt(geometryId, sphere)!.applyMatrix4(pose);
    this.reserve(instanceId);
    const bounds = this.bounds, o = instanceId * 4;
    bounds[o] = sphere.center.x; bounds[o + 1] = sphere.center.y; bounds[o + 2] = sphere.center.z; bounds[o + 3] = sphere.radius;
    this.boundsGeometry[instanceId] = geometryId;
  }

  /** Three's unsorted per-object culling (BatchedMesh.onBeforeRender), followed by the same grouping as
   * `groupGeometry`, with each part's bounds transformed once per pose instead of once per pass. */
  private cull(camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const state = this as unknown as CullState, texture = state._matricesTexture;
    if (texture !== this.boundsTexture || texture.version !== this.boundsVersion) {
      this.boundsGeometry.fill(-1); this.boundsTexture = texture; this.boundsVersion = texture.version;
    }
    const index = geometry.getIndex(), bytes = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const [a, b, c, d, e, f] = frustum.planes;
    const ax = a.normal.x, ay = a.normal.y, az = a.normal.z, aw = a.constant, bx = b.normal.x, by = b.normal.y, bz = b.normal.z, bw = b.constant;
    const cx = c.normal.x, cy = c.normal.y, cz = c.normal.z, cw = c.constant, dx = d.normal.x, dy = d.normal.y, dz = d.normal.z, dw = d.constant;
    const ex = e.normal.x, ey = e.normal.y, ez = e.normal.z, ew = e.constant, fx = f.normal.x, fy = f.normal.y, fz = f.normal.z, fw = f.constant;
    const instances = state._instanceInfo, infos = state._geometryInfo, starts = state._multiDrawStarts, counts = state._multiDrawCounts;
    const ids = state._indirectTexture.image.data as Uint32Array, grouped = !material.transparent;
    if (grouped) {
      if (this.groupBytes !== bytes) { this.groupOf = []; this.groupBytes = bytes; }
      for (const group of this.geometryGroups.values()) group.ids.length = 0;
    }
    let drawn = 0;
    for (let i = 0, l = instances.length; i < l; i++) {
      const instance = instances[i];
      if (!instance.visible || !instance.active) continue;
      const geometryId = instance.geometryIndex;
      if (this.boundsGeometry[i] !== geometryId) this.bound(i);
      // Frustum.intersectsSphere, plane by plane: normal · centre + constant against the negated radius.
      const s = this.bounds, o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], r = -s[o + 3];
      if (ax * x + ay * y + az * z + aw < r || bx * x + by * y + bz * z + bw < r || cx * x + cy * y + cz * z + cw < r ||
        dx * x + dy * y + dz * z + dw < r || ex * x + ey * y + ez * z + ew < r || fx * x + fy * y + fz * z + fw < r) continue;
      const info = infos[geometryId];
      // Keyed by the range start as three stores it in its Int32Array.
      if (grouped) {
        const group = this.groupOf[geometryId] ??= this.group(info.start * bytes | 0);
        group.count = info.count; group.ids.push(i);
      } else { starts[drawn] = info.start * bytes; counts[drawn] = info.count; ids[drawn] = i; }
      drawn++;
    }
    if (grouped) {
      let offset = 0;
      for (const [start, group] of this.geometryGroups) for (const id of group.ids) {
        starts[offset] = start; counts[offset] = group.count; ids[offset++] = id;
      }
    }
    state._indirectTexture.needsUpdate = true;
    state._multiDrawCount = drawn;
    state._visibilityChanged = false;
  }

  private group(start: number): Group {
    let group = this.geometryGroups.get(start);
    if (!group) this.geometryGroups.set(start, group = { count: 0, ids: [] });
    return group;
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
