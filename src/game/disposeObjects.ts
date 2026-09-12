import { BufferGeometry, Material, Mesh, LineSegments, Texture, type Object3D } from 'three/webgpu';

interface Resources { geometries: Set<BufferGeometry>; materials: Set<Material> }
function collect(roots: readonly (Object3D | undefined)[], into: Resources = { geometries: new Set(), materials: new Set() }): Resources {
  for (const root of roots) root?.traverse(object => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    into.geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) into.materials.add(material);
  });
  return into;
}

function release({ geometries, materials }: Resources, spared?: ReadonlySet<Texture>): void {
  const textures = new Set<Texture>();
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => {
    for (const value of Object.values(material)) if (value instanceof Texture && !spared?.has(value)) textures.add(value);
    material.dispose();
  });
  textures.forEach(texture => texture.dispose());
}

/** Dispose shared GLTF/inspection resources once, including those in cloned views. */
export function disposeObjects(...roots: (Object3D | undefined)[]): void {
  release(collect(roots));
}

/** Dispose everything reachable from `roots` that nothing in `keep` still needs. Cloned
 * views share their template's geometry, so retiring a fleet whose hulls are kept for the
 * next one has to spare those buffers — and the palette's shared paint outlives every hull
 * that used it. */
export function disposeObjectsExcept(keep: { roots?: readonly (Object3D | undefined)[]; materials?: Iterable<Material> }, ...roots: (Object3D | undefined)[]): void {
  const kept = collect(keep.roots ?? []);
  for (const material of keep.materials ?? []) kept.materials.add(material);
  const doomed = collect(roots);
  for (const geometry of kept.geometries) doomed.geometries.delete(geometry);
  for (const material of kept.materials) doomed.materials.delete(material);
  const spared = new Set<Texture>();
  for (const material of kept.materials) for (const value of Object.values(material)) if (value instanceof Texture) spared.add(value);
  release(doomed, spared);
}
