import * as THREE from 'three/webgpu';
import type { ShipView } from './ShipView';
import { shipDetailLevels } from './ShipDetail';
import { ShipRenderProxy } from './ShipRenderProxy';
import { FleetBatch } from './FleetBatch';
import { ShipRenderAssemblies, type RenderAssembly } from './ShipRenderAssemblies';

type Source = RenderAssembly & { view: ShipView; layers: number; instance?: number; levels?: { id: number; error: number }[]; level: number };
type Batch = { mesh: FleetBatch; sources: Source[] };

/** Group surfaces by material for submission while each ship keeps its CPU pose, joint
 * hierarchy and decal receivers. Inspection switches that hull to its own
 * materials; mask only the source surface so its impact-mark children still draw. */
export class FleetShipDraws {
  readonly root = new THREE.Group();
  private batches: Batch[] = [];
  private proxies = new Map<ShipView, ShipRenderProxy>();
  private readonly assemblies = new ShipRenderAssemblies();
  private visibleInstances = 0;
  private reducedInstances = 0;
  private subpixelInstances = 0;
  private readonly viewCenter = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();
  constructor(views: readonly ShipView[]) {
    this.root.name = 'Fleet ship surfaces';
    const groups = new Map<string, { material: THREE.Material; sources: Source[] }>();
    for (const view of views) for (const assembly of this.assemblies.build(view)) {
      const { mesh, material } = assembly;
      if (material.transparent || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length) continue;
      const layout = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
      const key = `${material.uuid}:${!!mesh.geometry.index}:${layout}:${mesh.layers.mask}:${mesh.renderOrder}:${mesh.castShadow}:${mesh.receiveShadow}`;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { material, sources: [] });
      group.sources.push({ ...assembly, view, layers: mesh.layers.mask, level: 0 });
    }
    for (const { material, sources } of groups.values()) {
      if (sources.length < 2 && !sources[0].owner) continue;
      const first = sources[0].mesh;
      const geometries = [...new Set(sources.flatMap(s => shipDetailLevels(s.mesh.geometry).map(level => level.geometry)))];
      const vertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
      const indices = geometries.reduce((n, g) => n + (g.index?.count ?? 0), 0);
      const mesh = new FleetBatch(sources.length, vertices, indices, material);
      const ids = new Map(geometries.map(g => [g, mesh.addGeometry(g)]));
      for (const source of sources) {
        source.levels = shipDetailLevels(source.mesh.geometry).map(level => ({ id: ids.get(level.geometry)!, error: level.error }));
        source.instance = mesh.addInstance(source.levels[0].id);
        if (!source.mesh.geometry.boundingSphere) source.mesh.geometry.computeBoundingSphere();
      }
      // Retain independent camera/shadow culling for every original surface.
      mesh.frustumCulled = false; mesh.perObjectFrustumCulled = true; mesh.sortObjects = false;
      mesh.name = first.name; mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.layers.mask = first.layers.mask; mesh.renderOrder = first.renderOrder;
      this.root.add(mesh); this.batches.push({ mesh, sources });
    }
    for (const view of views) if (ShipRenderProxy.supports(view)) {
      const proxy = new ShipRenderProxy(view);
      this.proxies.set(view, proxy); this.root.add(proxy.root);
    }
  }
  /** Call after interpolating all hull/joint matrices and choosing view visibility. */
  update(camera?: THREE.Camera, framebufferHeight = 1080): void {
    this.visibleInstances = 0; this.reducedInstances = 0; this.subpixelInstances = 0;
    const projection = camera ? Math.abs(camera.projectionMatrix.elements[5]) * framebufferHeight * .5 : 0;
    for (const { mesh, sources } of this.batches) {
      mesh.invalidateDrawList();
      let count = 0;
      for (const source of sources) {
        const batched = source.view.inspection.mode === 'exterior';
        const proxy = this.proxies.get(source.view);
        const sourceVisible = (surface: THREE.Mesh) => {
          if (proxy) return proxy.sourceVisible(surface);
          for (let ancestor: THREE.Object3D | null = surface; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return false;
          return true;
        };
        const together = batched && source.members.every(member => sourceVisible(member.mesh));
        // A hidden component or inspection falls back to original surfaces.
        for (const member of source.members) member.mesh.layers.mask = together ? 0 : member.layers;
        let visible = together;
        if (source.owner) source.mesh.matrixWorld.copy(source.owner.matrixWorld);
        let level = 0;
        if (visible && camera) {
          this.sphere.copy(source.mesh.geometry.boundingSphere!).applyMatrix4(source.mesh.matrixWorld);
          // Nearest depth on the bounding sphere is conservative, including zoom
          // and viewport resolution. Never reduce geometry crossing the camera.
          const viewDepth = -this.viewCenter.copy(this.sphere.center).applyMatrix4(camera.matrixWorldInverse).z;
          const pixelsPerMetre = projection / ((camera as THREE.PerspectiveCamera).isPerspectiveCamera ? Math.max(.001, viewDepth - this.sphere.radius) : 1);
          if (this.sphere.radius * 2 * pixelsPerMetre < .5) { visible = false; this.subpixelInstances++; }
          else {
            const scale = source.mesh.matrixWorld.getMaxScaleOnAxis();
            for (let i = 1; i < source.levels!.length; i++) {
              // Hysteresis keeps a stationary silhouette stable near a threshold.
              const budget = i <= source.level ? .65 : .45;
              if (source.levels![i].error * scale * pixelsPerMetre <= budget) level = i;
            }
          }
        }
        if (level !== source.level) { mesh.setGeometryIdAt(source.instance!, source.levels![level].id); source.level = level; }
        mesh.setVisibleAt(source.instance!, visible);
        if (visible) { mesh.setMatrixAt(source.instance!, source.mesh.matrixWorld); count++; if (level > 0) this.reducedInstances++; }
      }
      mesh.visible = count > 0; this.visibleInstances += count;
    }
    this.proxies.forEach(proxy => proxy.update());
  }
  diagnostics() { return { batches: this.batches.length, instances: this.visibleInstances, reduced: this.reducedInstances, subpixel: this.subpixelInstances }; }
  dispose(): void {
    this.proxies.forEach(proxy => proxy.dispose()); this.proxies.clear();
    for (const { mesh, sources } of this.batches) {
      sources.forEach(s => s.members.forEach(member => member.mesh.layers.mask = member.layers));
      mesh.dispose(); // Disposes only the combined buffers and transform textures, not template materials.
    }
    this.batches.length = 0; this.root.clear(); this.root.removeFromParent();
    this.assemblies.dispose();
  }
}
