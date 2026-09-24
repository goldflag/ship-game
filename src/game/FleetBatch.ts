import * as THREE from 'three/webgpu';

export type FleetDrawState = {
  _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number;
  _indirectTexture: THREE.DataTexture;
};
type CullState = FleetDrawState & {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number; boundingSphere: THREE.Sphere | null }[];
  _matricesTexture: THREE.DataTexture;
  _visibilityChanged: boolean;
};
type Group = { count: number; ids: number[] };

const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), sphere = new THREE.Sphere();

/** Water's opaque capture and the main draw often use the same camera in
 * succession. Reuse that draw list within the completed fleet pose. A shadow
 * camera always replaces the cached list, so its culling remains independent.
 * Each part's world bounds are kept from its last pose, so the occlusion prepass
 * and the main pass, whose far planes differ, each only test them. */
export class FleetBatch extends THREE.BatchedMesh {
  /** Off: three's own culling, which transforms every part's bounds in every pass, for comparison. */
  static keepBounds = true;
  /** Off: the draw list's instance ids are uploaded after every cull, as three does, even when no id changed. */
  static keepIds = true;
  /** Off: `writePose` goes through three's `setMatrixAt`, one texture version per pose, for comparison. */
  static directPoses = true;
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
  /** Bumped by every change to which instances draw, with which geometry, or to the geometry ranges: the depth caster
   * passes keep their draw order of the parts until it moves. */
  layoutVersion = 0;
  /** Poses written since the last `commitPoses`, and whether the kept bounds followed the matrix texture before the first. */
  private writing = false;
  private writingKnown = false;
  private readonly scratch = new THREE.Matrix4();

  invalidateDrawList(): void { this.drawCamera = undefined; }

  /** Instance `instanceId`'s bounds under its last pose (centre and radius at `4 * instanceId` of the array returned), in the
   * batch's space, exactly as three's culling derives them; kept from `setMatrixAt` and brought up to date here if not. */
  partBoundsAt(instanceId: number): Float64Array {
    const state = this as unknown as CullState, texture = state._matricesTexture;
    if (texture !== this.boundsTexture || texture.version !== this.boundsVersion) {
      this.boundsGeometry.fill(-1); this.boundsTexture = texture; this.boundsVersion = texture.version;
    }
    if (this.boundsGeometry[instanceId] !== state._instanceInfo[instanceId].geometryIndex) this.bound(instanceId);
    return this.bounds;
  }

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

  /** `setMatrixAt(instanceId, matrix)` from the matrix's elements, for a caller that writes many poses in a row and then
   * calls `commitPoses`: the same floats in the matrix texture and the same kept bounds, with the texture marked for upload
   * once for them all (its version moves once rather than once per pose; every reader only asks whether it moved). */
  writePose(instanceId: number, e: ArrayLike<number>): void {
    if (!FleetBatch.directPoses) { this.setMatrixAt(instanceId, this.scratch.fromArray(e)); return; }
    const texture = (this as unknown as CullState)._matricesTexture;
    if (!this.writing) { this.writing = true; this.writingKnown = texture === this.boundsTexture && texture.version === this.boundsVersion; }
    const data = texture.image.data as Float32Array, o = instanceId * 16;
    data[o] = e[0]; data[o + 1] = e[1]; data[o + 2] = e[2]; data[o + 3] = e[3]; data[o + 4] = e[4]; data[o + 5] = e[5]; data[o + 6] = e[6]; data[o + 7] = e[7];
    data[o + 8] = e[8]; data[o + 9] = e[9]; data[o + 10] = e[10]; data[o + 11] = e[11]; data[o + 12] = e[12]; data[o + 13] = e[13]; data[o + 14] = e[14]; data[o + 15] = e[15];
    if (this.writingKnown) this.bound(instanceId);
  }
  /** Mark the poses `writePose` wrote since the last commit for upload. Their bounds stay kept unless the texture took a
   * write since that the batch did not see. */
  commitPoses(): void {
    if (!this.writing) return;
    const texture = (this as unknown as CullState)._matricesTexture, known = this.writingKnown && texture === this.boundsTexture && texture.version === this.boundsVersion;
    this.writing = false; texture.needsUpdate = true;
    if (known) this.boundsVersion = texture.version;
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
    this.reserve(id); this.boundsGeometry[id] = -1; this.layoutVersion++;
    return id;
  }
  override deleteInstance(instanceId: number): this { this.layoutVersion++; return super.deleteInstance(instanceId); }
  override setVisibleAt(instanceId: number, visible: boolean): this {
    if ((this as unknown as CullState)._instanceInfo[instanceId]?.visible !== visible) this.layoutVersion++;
    return super.setVisibleAt(instanceId, visible);
  }
  override setGeometryIdAt(instanceId: number, geometryId: number): this {
    if ((this as unknown as CullState)._instanceInfo[instanceId]?.geometryIndex !== geometryId) this.layoutVersion++;
    return super.setGeometryIdAt(instanceId, geometryId);
  }
  // Ranges, bounds or the matrix texture itself change: every cached bound and group goes.
  override setGeometryAt(geometryId: number, geometry: THREE.BufferGeometry): number { this.forget(); return super.setGeometryAt(geometryId, geometry); }
  override deleteGeometry(geometryId: number): this { this.forget(); return super.deleteGeometry(geometryId); }
  override optimize(): this { this.forget(); return super.optimize(); }
  override setGeometrySize(maxVertexCount: number, maxIndexCount: number): void { this.forget(); super.setGeometrySize(maxVertexCount, maxIndexCount); }
  override setInstanceCount(maxInstanceCount: number): void { this.forget(); super.setInstanceCount(maxInstanceCount); }
  override copy(source: THREE.BatchedMesh): this { this.forget(); return super.copy(source); }

  private forget(): void { this.boundsTexture = undefined; this.groupOf = []; this.layoutVersion++; }

  private reserve(instanceId: number): void {
    if (instanceId < this.boundsGeometry.length) return;
    const size = Math.max(instanceId + 1, this.maxInstanceCount, this.boundsGeometry.length * 2);
    const bounds = new Float64Array(size * 4), geometries = new Int32Array(size).fill(-1);
    bounds.set(this.bounds); geometries.set(this.boundsGeometry);
    this.bounds = bounds; this.boundsGeometry = geometries;
  }

  /** The instance's world bounds exactly as three's per-object culling derives them from the matrix texture:
   * `getMatrixAt`, then `Sphere.applyMatrix4` (`Vector3.applyMatrix4` and `getMaxScaleOnAxis`), operation for operation. */
  private bound(instanceId: number): void {
    const state = this as unknown as CullState, geometryId = state._instanceInfo[instanceId].geometryIndex;
    const local = state._geometryInfo[geometryId].boundingSphere ?? this.getBoundingSphereAt(geometryId, sphere)!;
    const e = state._matricesTexture.image.data as Float32Array, m = instanceId * 16, x = local.center.x, y = local.center.y, z = local.center.z;
    const e0 = e[m], e1 = e[m + 1], e2 = e[m + 2], e3 = e[m + 3], e4 = e[m + 4], e5 = e[m + 5], e6 = e[m + 6], e7 = e[m + 7];
    const e8 = e[m + 8], e9 = e[m + 9], e10 = e[m + 10], e11 = e[m + 11], e12 = e[m + 12], e13 = e[m + 13], e14 = e[m + 14], e15 = e[m + 15];
    const w = 1 / (e3 * x + e7 * y + e11 * z + e15);
    this.reserve(instanceId);
    const bounds = this.bounds, o = instanceId * 4;
    bounds[o] = (e0 * x + e4 * y + e8 * z + e12) * w; bounds[o + 1] = (e1 * x + e5 * y + e9 * z + e13) * w; bounds[o + 2] = (e2 * x + e6 * y + e10 * z + e14) * w;
    bounds[o + 3] = local.radius * Math.sqrt(Math.max(e0 * e0 + e1 * e1 + e2 * e2, e4 * e4 + e5 * e5 + e6 * e6, e8 * e8 + e9 * e9 + e10 * e10));
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
    let drawn = 0, changed = false;
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
      } else { starts[drawn] = info.start * bytes; counts[drawn] = info.count; if (ids[drawn] !== i) { ids[drawn] = i; changed = true; } }
      drawn++;
    }
    if (grouped) {
      let offset = 0;
      for (const [start, group] of this.geometryGroups) for (const id of group.ids) {
        starts[offset] = start; counts[offset] = group.count;
        if (ids[offset] !== id) { ids[offset] = id; changed = true; }
        offset++;
      }
    }
    // Only the ids reach the GPU (ranges and counts are the CPU's draw calls), and the texture's data holds what it last
    // uploaded or is about to: the same ids need no upload. Most frames the fleet moves while the same parts stay in view.
    if (changed || !FleetBatch.keepIds || state._indirectTexture.version === 0) state._indirectTexture.needsUpdate = true;
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
