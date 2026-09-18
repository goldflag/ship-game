import type { Hull } from '../ships/blueprint';

/** Custom hull dimensions are symmetric broad bounds around the authoring origin,
 * which need not be amidships. Resolve the actual hull extents once per trail. */
export function wakeHull(hull: Hull) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const cell of hull.volume?.cells ?? []) for (const face of cell.faces) for (const [x, , z] of face.vertices) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if (minX < maxX && minZ < maxZ) return {
    length: maxZ - minZ, beam: maxX - minX,
    centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2,
  };
  return { length: hull.length, beam: hull.beam, centerX: 0, centerZ: 0 };
}
