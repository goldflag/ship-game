/** Blueprint structures whose top faces share a plane where both are exposed: the renderer z-fights there, and
 * the CPU charges two coincident plates. A structure standing on (or passing through) that plane hides it, so the
 * Iowa bridge house under its bridge is not a finding. Footprints are sampled, so concave outlines need no clipping. */
export interface StructureLike {
  id: string;
  footprint: [number, number][];
  baseY: number;
  height: number;
}
export interface StructureOverlap {
  structures: [string, string];
  /** Height of the shared top, metres. */
  top: number;
  /** Exposed coplanar area, square metres, to the sampling cell. */
  areaM2: number;
  /** One exposed sample, [x, z] in ship metres, to find it in a view. */
  at: [number, number];
}

const inside = (ring: [number, number][], x: number, z: number): boolean => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if (ring[i][1] > z !== ring[j][1] > z && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  return hit;
};
const box = (ring: [number, number][]) => ({
  minX: Math.min(...ring.map((p) => p[0])), maxX: Math.max(...ring.map((p) => p[0])),
  minZ: Math.min(...ring.map((p) => p[1])), maxZ: Math.max(...ring.map((p) => p[1])),
});

export function coplanarStructureOverlaps(structures: StructureLike[], options: { tolerance?: number; cell?: number; minArea?: number } = {}): StructureOverlap[] {
  const tolerance = options.tolerance ?? 0.03;
  const cell = options.cell ?? 0.1;
  const minArea = options.minArea ?? 0.25;
  const found: StructureOverlap[] = [];
  const boxes = structures.map((s) => box(s.footprint));
  for (let a = 0; a < structures.length; a++)
    for (let b = a + 1; b < structures.length; b++) {
      const [A, B] = [structures[a], structures[b]];
      const top = A.baseY + A.height;
      if (Math.abs(top - (B.baseY + B.height)) > tolerance) continue;
      const [p, q] = [boxes[a], boxes[b]];
      const minX = Math.max(p.minX, q.minX), maxX = Math.min(p.maxX, q.maxX), minZ = Math.max(p.minZ, q.minZ), maxZ = Math.min(p.maxZ, q.maxZ);
      if (minX >= maxX || minZ >= maxZ) continue;
      // Anything occupying the space just above the shared plane covers it.
      const covers = structures.filter((C, c) => c !== a && c !== b && C.baseY <= top + tolerance && C.baseY + C.height > top + tolerance);
      let count = 0;
      let at: [number, number] | undefined;
      for (let x = minX + cell / 2; x < maxX; x += cell)
        for (let z = minZ + cell / 2; z < maxZ; z += cell) {
          if (!inside(A.footprint, x, z) || !inside(B.footprint, x, z)) continue;
          if (covers.some((C) => inside(C.footprint, x, z))) continue;
          count++;
          at ??= [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
        }
      const areaM2 = Math.round(count * cell * cell * 100) / 100;
      if (areaM2 >= minArea && at) found.push({ structures: [A.id, B.id], top: Math.round(top * 1000) / 1000, areaM2, at });
    }
  return found.sort((x, y) => y.areaM2 - x.areaM2);
}
