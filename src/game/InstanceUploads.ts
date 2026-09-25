import * as THREE from 'three/webgpu';

/** How effects publish what they rewrite each frame. Three r185 re-sends an attribute marked `DynamicDrawUsage` whole, or its live
 * ranges, on every render call that draws it, changed or not; static usage sends it once per `needsUpdate`, only the ranges flagged.
 * With `versioned` off the effects that moved to static usage return to dynamic, and the uploads trimmed to what changed (water sheet
 * colours, shifted wake quads, aircraft part rows) send what they sent before, so the two can be compared in one live battle. */
export const effectUploads = { versioned: true };
/** The usage an effect's per-frame attributes take under `effectUploads`. */
export const effectUsage = (): THREE.Usage => effectUploads.versioned ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage;

/** Prepare CPU-authored effect instances before their first native WebGPU draw.
 * Callers publish changes through needsUpdate and live attribute ranges. Storage
 * matrices and versioned attributes share one upload across all render passes.
 * Effect colors use component setters (setXYZ), not packed RGB array offsets. */
export function prepareInstanceUploads(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    if (!(object.instanceMatrix instanceof THREE.StorageInstancedBufferAttribute)) {
      const source = object.instanceMatrix;
      object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(source.array, 16);
      for (const range of source.updateRanges) object.instanceMatrix.addUpdateRange(range.start, range.count);
      object.instanceMatrix.name = source.name || `Effect poses: ${object.name || object.id}`;
      object.instanceMatrix.needsUpdate = true;
    }
    // Dynamic usage bypasses the version check, including on a second pass after
    // the first upload consumed the live range. Static usage remains writable.
    object.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    if (object.instanceColor && !(object.instanceColor instanceof THREE.StorageInstancedBufferAttribute)) {
      const source = object.instanceColor;
      // WGSL vec3 storage has a vec4 stride. Prepare that layout once and avoid
      // Three's copied color attribute, whose version sync follows vertex uploads.
      const colors = new THREE.StorageInstancedBufferAttribute(source.count, 4);
      for (let i = 0; i < source.count; i++) colors.setXYZ(i, source.getX(i), source.getY(i), source.getZ(i));
      colors.name = `Effect colors: ${object.name || object.id}`;
      colors.needsUpdate = true; object.instanceColor = colors;
    }
    object.instanceColor?.setUsage(THREE.StaticDrawUsage);
    for (const attr of Object.values(object.geometry.attributes)) {
      if (attr instanceof THREE.InstancedBufferAttribute) attr.setUsage(THREE.StaticDrawUsage);
    }
  });
}
