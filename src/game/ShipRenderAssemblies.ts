import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerShipDetailLevels, shipDetailLevels, type ShipDetailLevel } from './ShipDetail';
import type { ShipView } from './ShipView';

export type RenderAssembly = {
  mesh: THREE.Mesh; material: THREE.Material;
  members: { mesh: THREE.Mesh; layers: number }[];
  owner?: THREE.Object3D;
};

/** Rendering-only joins across fixed assembly IDs. Every original surface,
 * parent chain, socket and moving joint stays in the ship's authoring model. */
export class ShipRenderAssemblies {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private readonly geometries = new Set<THREE.BufferGeometry>();

  build(view: ShipView): RenderAssembly[] {
    const groups = new Map<THREE.Object3D, Map<string, { mesh: THREE.Mesh; material: THREE.Material; transform: THREE.Matrix4 }[]>>();
    const result: RenderAssembly[] = [];
    for (const { mesh, material } of view.renderMeshes) {
      const transform = new THREE.Matrix4();
      let owner: THREE.Object3D = mesh;
      while (owner !== view.root && !owner.matrixAutoUpdate) {
        transform.premultiply(owner.matrix); owner = owner.parent!;
      }
      if (material.transparent || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length ||
        mesh.geometry.drawRange.start !== 0 || mesh.geometry.drawRange.count !== Infinity || transform.determinant() <= 0) {
        result.push({ mesh, material, members: [{ mesh, layers: mesh.layers.mask }] }); continue;
      }
      const layout = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
      const key = `${material.uuid}:${!!mesh.geometry.index}:${layout}:${mesh.layers.mask}:${mesh.renderOrder}:${mesh.castShadow}:${mesh.receiveShadow}`;
      let byMaterial = groups.get(owner); if (!byMaterial) groups.set(owner, byMaterial = new Map());
      let group = byMaterial.get(key); if (!group) byMaterial.set(key, group = []);
      group.push({ mesh, material, transform });
    }
    for (const [owner, byMaterial] of groups) for (const parts of byMaterial.values()) {
      if (parts.length === 1) {
        const { mesh, material } = parts[0]; result.push({ mesh, material, members: [{ mesh, layers: mesh.layers.mask }] }); continue;
      }
      const key = parts.map(p => `${p.mesh.geometry.uuid}:${p.transform.elements.join(',')}`).join('/');
      let geometry = this.cache.get(key);
      if (!geometry) {
        const details = parts.map(p => shipDetailLevels(p.mesh.geometry)), levels: ShipDetailLevel[] = [];
        const count = Math.max(...details.map(d => d.length));
        for (let level = 0; level < count; level++) {
          const selected = details.map(d => d[Math.min(level, d.length - 1)]);
          const sources = selected.map((d, i) => d.geometry.clone().applyMatrix4(parts[i].transform));
          const merged = mergeGeometries(sources)!;
          sources.forEach(g => g.dispose());
          merged.computeBoundingBox(); merged.computeBoundingSphere();
          const error = Math.max(...selected.map((d, i) => d.error * parts[i].transform.getMaxScaleOnAxis()));
          levels.push({ geometry: merged, error }); this.geometries.add(merged);
        }
        geometry = levels[0].geometry; registerShipDetailLevels(geometry, levels); this.cache.set(key, geometry);
      }
      const first = parts[0], mesh = new THREE.Mesh(geometry, first.material);
      mesh.matrixAutoUpdate = false; mesh.name = `${owner.name} rigid render assembly`;
      mesh.layers.mask = first.mesh.layers.mask; mesh.renderOrder = first.mesh.renderOrder;
      mesh.castShadow = first.mesh.castShadow; mesh.receiveShadow = first.mesh.receiveShadow;
      result.push({ mesh, material: first.material, members: parts.map(p => ({ mesh: p.mesh, layers: p.mesh.layers.mask })), owner });
    }
    return result;
  }

  dispose(): void { this.geometries.forEach(g => g.dispose()); this.geometries.clear(); this.cache.clear(); }
}
