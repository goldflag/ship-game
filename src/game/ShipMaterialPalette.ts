import * as THREE from 'three/webgpu';
import { attribute, materialMetalness, materialRoughness } from 'three/tsl';

/** Encode constant paint in derived vertex colors so otherwise identical PBR
 * materials can share draws, including across different ship definitions. */
export class ShipMaterialPalette {
  private readonly materials = new Map<string, THREE.MeshStandardNodeMaterial>();

  apply(root: THREE.Object3D): void {
    const derived = new Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
    const retiredGeometry = new Set<THREE.BufferGeometry>(), retiredMaterials = new Set<THREE.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial) || material.type !== 'MeshStandardMaterial' ||
        material.transparent || material.vertexColors || material.clippingPlanes || object.morphTargetInfluences?.length ||
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return;
      // Supplying metadata avoids serializing embedded texture pixels. Texture
      // UUIDs remain in the key: distinct image/sampler resources never collapse.
      const { metadata: _metadata, uuid: _uuid, name: _name, color: _color, roughness: _roughness, metalness: _metalness, userData: _userData, ...data } = material.toJSON({
        textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {},
      });
      const key = JSON.stringify(data);
      let shared = this.materials.get(key);
      if (!shared) {
        shared = new THREE.MeshStandardNodeMaterial().copy(material as unknown as THREE.MeshStandardNodeMaterial);
        shared.color.setRGB(1, 1, 1); shared.vertexColors = true;
        shared.roughness = 1; shared.metalness = 1;
        const surface = attribute<'vec2'>('shipSurface', 'vec2');
        shared.roughnessNode = materialRoughness.mul(surface.x);
        shared.metalnessNode = materialMetalness.mul(surface.y);
        shared.name = 'Shared naval paint'; this.materials.set(key, shared);
      }
      const source = object.geometry, colorKey = [...material.color.toArray(), material.roughness, material.metalness].join(',');
      let colors = derived.get(source);
      if (!colors) derived.set(source, colors = new Map());
      let geometry = colors.get(colorKey);
      if (!geometry) {
        const colored: THREE.BufferGeometry = source.clone();
        const color = new Float32Array(source.getAttribute('position').count * 3);
        const surface = new Float32Array(source.getAttribute('position').count * 2);
        const { r, g, b } = material.color;
        for (let i = 0; i < color.length; i += 3) { color[i] = r; color[i + 1] = g; color[i + 2] = b; }
        for (let i = 0; i < surface.length; i += 2) { surface[i] = material.roughness; surface[i + 1] = material.metalness; }
        colored.setAttribute('color', new THREE.BufferAttribute(color, 3));
        colored.setAttribute('shipSurface', new THREE.BufferAttribute(surface, 2));
        colors.set(colorKey, colored); geometry = colored;
      }
      object.geometry = geometry; object.material = shared;
      retiredGeometry.add(source); retiredMaterials.add(material);
    });
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      retiredGeometry.delete(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) retiredMaterials.delete(material);
    });
    retiredGeometry.forEach(geometry => geometry.dispose());
    retiredMaterials.forEach(material => material.dispose());
  }
}
