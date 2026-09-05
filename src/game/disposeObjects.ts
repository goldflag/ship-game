import { BufferGeometry, Material, Mesh, LineSegments, Texture, type Object3D } from 'three/webgpu';

/** Dispose shared GLTF/inspection resources once, including those in cloned views. */
export function disposeObjects(...roots: (Object3D | undefined)[]): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const root of roots) root?.traverse(object => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  });
  textures.forEach(texture => texture.dispose());
}
