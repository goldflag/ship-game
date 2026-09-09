import * as THREE from 'three/webgpu';
import { FleetBatch } from './FleetBatch';

/** Opaque aircraft parts share submission while retaining one pose per part.
 * Geometry stays in its authored local coordinates, including moving joints. */
export class AircraftPartsBatch {
  readonly mesh: FleetBatch;
  private readonly geometryIds: number[];
  private readonly instances: number[][] = [];
  private readonly matrix = new THREE.Matrix4();
  private capacity = 64;
  private previousCount = 0;

  constructor(readonly sources: readonly THREE.Mesh[], name: string) {
    const vertices = sources.reduce((n, s) => n + s.geometry.attributes.position.count, 0);
    const indices = sources.reduce((n, s) => n + (s.geometry.index?.count ?? 0), 0);
    this.mesh = new FleetBatch(this.capacity * sources.length, vertices, indices, sources[0].material as THREE.Material);
    this.mesh.name = name; this.mesh.visible = false;
    // Aircraft visibility is already selected using the complete airframe.
    this.mesh.frustumCulled = false; this.mesh.perObjectFrustumCulled = false; this.mesh.sortObjects = false;
    this.geometryIds = sources.map(s => this.mesh.addGeometry(s.geometry));
    // Three's WebGPU backend promotes uint16 indices on first upload, after
    // BatchedMesh has calculated byte offsets. Choose uint32 before that first
    // draw list so every part starts at the correct index from frame one.
    const index = this.mesh.geometry.index;
    if (index && index.array instanceof Uint16Array) this.mesh.geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(index.array), 1));
  }

  setPose(plane: number, world: THREE.Matrix4): void {
    if (plane >= this.capacity) {
      while (plane >= this.capacity) this.capacity *= 2;
      this.mesh.setInstanceCount(this.capacity * this.sources.length);
    }
    while (this.instances.length <= plane) this.instances.push(this.geometryIds.map(id => this.mesh.addInstance(id)));
    const instances = this.instances[plane];
    for (let i = 0; i < this.sources.length; i++) {
      this.mesh.setVisibleAt(instances[i], true);
      this.mesh.setMatrixAt(instances[i], this.matrix.multiplyMatrices(world, this.sources[i].matrixWorld));
    }
  }

  publish(count: number): void {
    for (let plane = count; plane < this.previousCount; plane++)
      for (const instance of this.instances[plane]) this.mesh.setVisibleAt(instance, false);
    this.previousCount = count;
    this.mesh.visible = count > 0; this.mesh.invalidateDrawList();
  }

  /** Compile dormant parts in the actual capture and final render targets. */
  warmup(): (() => void) | undefined {
    if (this.previousCount) return;
    this.setPose(0, new THREE.Matrix4().makeScale(0, 0, 0));
    this.publish(1);
    return () => this.publish(0);
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.dispose(); }
}

export function aircraftPartGroups(sources: readonly THREE.Mesh[]): THREE.Mesh[][] {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const source of sources) {
    const { geometry, material } = source;
    if (Array.isArray(material) || material.transparent || source.morphTargetInfluences?.length
      || (source as THREE.SkinnedMesh).isSkinnedMesh || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity
      || source.matrixWorld.determinant() <= 0) continue;
    const layout = Object.entries(geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
    const key = `${material.uuid}:${!!geometry.index}:${layout}`;
    const group = groups.get(key); if (group) group.push(source); else groups.set(key, [source]);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
