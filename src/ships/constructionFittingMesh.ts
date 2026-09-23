import { unzlibSync, zlibSync } from 'fflate';
import type { ConstructionFittingMesh, ConstructionFittingMeshGroup, Vec3 } from './blueprint';

/** Visual meshes of design-local fittings: the `deflate-q16-u16-v1` codec, the conservative boxes and
 * the budgets. Mirrors `crates/naval-sim/src/construction_fitting_mesh.rs` exactly; the native
 * compiler stays the authority. A mesh is visual plus mass only: never hull, armor, buoyancy,
 * flooding, modules or hit geometry. */
export const FITTING_MESH_ENCODING = 'deflate-q16-u16-v1';
/** Mirrors the constants in `construction_fitting_mesh.rs`. Online designs use the same budgets. */
export const FITTING_MESH_LIMITS = {
  /** Meshes per definition. */
  meshes: 16,
  /** Vertices per mesh: indices are u16. */
  vertices: 65_535,
  meshTriangles: 20_000,
  /** Painted triangle runs per mesh. */
  groups: 64,
  /** Mesh triangles over a design's definitions, each definition once. */
  designMeshTriangles: 100_000,
  /** Base64 `data` bytes over a design's meshes. */
  designMeshBytes: 1 << 20,
  /** Instances × definition triangles (meshes, solid faces, tubes) over a design's custom fittings. */
  renderedTriangles: 1_000_000,
} as const;
/** Flat meshes still get boxes with some thickness. */
export const MIN_FITTING_BOX_M = 0.02;
const SPLIT_DEPTH = 3;

export interface DecodedFittingMesh {
  /** x, y, z per vertex, fitting-local metres. */
  points: Float64Array;
  /** Three vertex indices per triangle. */
  triangles: Uint16Array;
}

const count = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;
const textOk = (text: unknown) => text === undefined || (typeof text === 'string' && text.length > 0 && text.length <= 64);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function base64Bytes(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !BASE64.test(text)) throw new Error('invalid base64');
  const binary = atob(text),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function bytesBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const decoded = new Map<string, { meta: string; result: DecodedFittingMesh | Error }>();
/** One mesh, validated and dequantized, or the fault naming it, worded as the native one. Memoized by content. */
export function decodeFittingMesh(mesh: ConstructionFittingMesh, localM = 100): DecodedFittingMesh {
  const meta = JSON.stringify([mesh.id, mesh.encoding, mesh.vertices, mesh.triangles, mesh.bounds, mesh.groups, localM]);
  const hit = typeof mesh.data === 'string' ? decoded.get(mesh.data) : undefined;
  let result = hit?.meta === meta ? hit.result : undefined;
  if (!result) {
    try {
      result = decodeUncached(mesh, localM);
    } catch (error) {
      result = error instanceof Error ? error : new Error(String(error));
    }
    if (typeof mesh.data === 'string') {
      if (decoded.size >= 64) decoded.clear();
      decoded.set(mesh.data, { meta, result });
    }
  }
  if (result instanceof Error) throw result;
  return result;
}

function decodeUncached(mesh: ConstructionFittingMesh, localM: number): DecodedFittingMesh {
  const { id } = mesh,
    L = FITTING_MESH_LIMITS;
  if (mesh.encoding !== FITTING_MESH_ENCODING)
    throw new Error(`mesh ${id} uses the encoding ${JSON.stringify(mesh.encoding)}; this build reads "${FITTING_MESH_ENCODING}"`);
  if (!count(mesh.vertices, L.vertices)) throw new Error(`mesh ${id} needs 1–${L.vertices} vertices; it declares ${mesh.vertices}`);
  if (!count(mesh.triangles, L.meshTriangles))
    throw new Error(`mesh ${id} has ${mesh.triangles} triangles; a mesh holds 1–${L.meshTriangles}`);
  if (typeof mesh.data !== 'string')
    throw new Error(`mesh ${id} has data that does not decode to ${mesh.vertices} vertices and ${mesh.triangles} triangles`);
  if (mesh.data.length > L.designMeshBytes)
    throw new Error(`mesh ${id} carries ${mesh.data.length} encoded bytes; a design holds at most ${L.designMeshBytes}`);
  const lo = mesh.bounds?.min,
    hi = mesh.bounds?.max;
  const bound = (v: unknown): v is Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= localM);
  if (!bound(lo) || !bound(hi) || lo.some((n, k) => n > hi[k]))
    throw new Error(`mesh ${id} needs finite bounds with min ≤ max, within ${localM} m of the datum`);
  const groups = mesh.groups ?? [];
  if (groups.length > L.groups) throw new Error(`mesh ${id} has ${groups.length} groups; the limit is ${L.groups}`);
  let next = 0;
  for (const g of groups)
    if (
      !Number.isInteger(g.start) ||
      !Number.isInteger(g.count) ||
      g.start < next ||
      g.count < 1 ||
      g.start + g.count > mesh.triangles ||
      !textOk(g.name) ||
      !textOk(g.paint)
    )
      throw new Error(
        `mesh ${id} needs groups of whole, ascending, non-overlapping triangle runs within its ${mesh.triangles} triangles, with names and paints of 1–64 bytes`,
      );
    else next = g.start + g.count;
  const invalid = () => new Error(`mesh ${id} has data that does not decode to ${mesh.vertices} vertices and ${mesh.triangles} triangles`);
  const expected = 6 * (mesh.vertices + mesh.triangles);
  let bytes: Uint8Array;
  try {
    // One byte of headroom, as the native decoder reads: a longer payload cannot hide past it.
    bytes = unzlibSync(base64Bytes(mesh.data), { out: new Uint8Array(expected + 1) });
  } catch {
    throw invalid();
  }
  if (bytes.length !== expected) throw invalid();
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    word = (i: number) => words.getUint16(2 * i, true);
  const points = new Float64Array(3 * mesh.vertices);
  for (let v = 0; v < mesh.vertices; v++)
    for (let k = 0; k < 3; k++) points[3 * v + k] = lo[k] + ((hi[k] - lo[k]) * word(3 * v + k)) / 65535;
  const triangles = new Uint16Array(3 * mesh.triangles);
  for (let t = 0; t < mesh.triangles; t++)
    for (let k = 0; k < 3; k++) {
      const index = word(3 * mesh.vertices + 3 * t + k);
      if (index >= mesh.vertices) throw new Error(`mesh ${id} triangle ${t} names a vertex beyond its ${mesh.vertices} vertices`);
      triangles[3 * t + k] = index;
    }
  return { points, triangles };
}

/** Summed area and the area-weighted centroid numerator, in triangle order. */
export function fittingMeshAreaMoments({ points: p, triangles: t }: DecodedFittingMesh): { area: number; first: Vec3 } {
  let area = 0;
  const first: Vec3 = [0, 0, 0];
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i],
      b = 3 * t[i + 1],
      c = 3 * t[i + 2];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]],
      v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const piece = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) / 2;
    area += piece;
    for (let k = 0; k < 3; k++) first[k] += (piece * (p[a + k] + p[b + k] + p[c + k])) / 3;
  }
  return { area, first };
}

function extent({ points: p, triangles: t }: DecodedFittingMesh, group: number[]) {
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const tri of group)
    for (let c = 0; c < 3; c++) {
      const i = 3 * t[3 * tri + c];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    }
  return { lo, hi };
}
/** Up to eight conservative boxes: the triangles split three times at the middle of their current extent's
 * longest axis, by centroid; each box is the full extent of its triangles, at least `MIN_FITTING_BOX_M` thick. */
export function fittingMeshBoxes(mesh: DecodedFittingMesh): { center: Vec3; size: Vec3 }[] {
  const { points: p, triangles: t } = mesh;
  let groups = [Array.from({ length: t.length / 3 }, (_, i) => i)];
  for (let depth = 0; depth < SPLIT_DEPTH; depth++) {
    const next: number[][] = [];
    for (const group of groups) {
      const { lo, hi } = extent(mesh, group);
      const axis = [1, 2].reduce((best, k) => (hi[k] - lo[k] > hi[best] - lo[best] ? k : best), 0);
      const middle = (lo[axis] + hi[axis]) / 2,
        below: number[] = [],
        above: number[] = [];
      for (const tri of group) {
        const a = p[3 * t[3 * tri] + axis],
          b = p[3 * t[3 * tri + 1] + axis],
          c = p[3 * t[3 * tri + 2] + axis];
        ((a + b + c) / 3 < middle ? below : above).push(tri);
      }
      if (!below.length || !above.length) next.push(group);
      else next.push(below, above);
    }
    groups = next;
  }
  return groups.map((group) => {
    const { lo, hi } = extent(mesh, group);
    return { center: lo.map((n, k) => (n + hi[k]) / 2) as Vec3, size: lo.map((n, k) => Math.max(hi[k] - n, MIN_FITTING_BOX_M)) as Vec3 };
  });
}

/** One triangle of an imported mesh, with the material or group name it came from. */
export interface FittingMeshTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  group?: string;
}
/** Quantize, weld and encode a triangle soup as one mesh record. Triangles are ordered by group (first appearance;
 * ungrouped last), vertices by first use, and triangles that collapse when quantized are dropped. `paints` names a
 * coating per group. Throws when the result exceeds the per-mesh limits. */
export function encodeFittingMesh(
  id: string,
  soup: readonly FittingMeshTriangle[],
  paints: Readonly<Record<string, string>> = {},
): ConstructionFittingMesh {
  if (!soup.length) throw new Error(`mesh ${id} has no triangles`);
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of soup)
    for (const p of [t.a, t.b, t.c])
      for (let k = 0; k < 3; k++) {
        if (!Number.isFinite(p[k])) throw new Error(`mesh ${id} has a non-finite coordinate`);
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
  const order = [...new Set(soup.map((t) => t.group).filter((g): g is string => g !== undefined))];
  const rank = (g?: string) => (g === undefined ? order.length : order.indexOf(g));
  const sorted = soup.map((t, i) => [t, i] as const).sort(([a, i], [b, j]) => rank(a.group) - rank(b.group) || i - j);
  const quantize = (p: Vec3) =>
    p.map((n, k) => (hi[k] > lo[k] ? Math.min(65535, Math.max(0, Math.round(((n - lo[k]) / (hi[k] - lo[k])) * 65535))) : 0));
  const weld = new Map<number, number>(),
    positions: number[] = [],
    indices: number[] = [],
    groups: ConstructionFittingMeshGroup[] = [];
  for (const [t] of sorted) {
    const corner = [t.a, t.b, t.c].map((p) => {
      const q = quantize(p),
        key = (q[0] * 65536 + q[1]) * 65536 + q[2];
      let index = weld.get(key);
      if (index === undefined) {
        weld.set(key, (index = positions.length / 3));
        positions.push(...q);
      }
      return index;
    });
    if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) continue;
    const at = indices.length / 3;
    indices.push(...corner);
    if (t.group === undefined) continue;
    const last = groups.at(-1);
    if (last?.name === t.group) last.count++;
    else
      groups.push({ start: at, count: 1, name: t.group.slice(0, 64) || undefined, ...(paints[t.group] ? { paint: paints[t.group] } : {}) });
  }
  const vertices = positions.length / 3,
    triangles = indices.length / 3;
  if (!triangles) throw new Error(`mesh ${id} has no triangles left after quantization`);
  if (vertices > FITTING_MESH_LIMITS.vertices)
    throw new Error(
      `mesh ${id} has ${vertices} distinct vertices; a mesh holds at most ${FITTING_MESH_LIMITS.vertices}. Split it into several meshes`,
    );
  if (triangles > FITTING_MESH_LIMITS.meshTriangles)
    throw new Error(
      `mesh ${id} has ${triangles} triangles; a mesh holds 1–${FITTING_MESH_LIMITS.meshTriangles}. Simplify it or split it into several meshes`,
    );
  if (groups.length > FITTING_MESH_LIMITS.groups)
    throw new Error(`mesh ${id} has ${groups.length} groups; the limit is ${FITTING_MESH_LIMITS.groups}`);
  const raw = new Uint8Array(6 * (vertices + triangles)),
    view = new DataView(raw.buffer);
  [...positions, ...indices].forEach((n, i) => view.setUint16(2 * i, n, true));
  return {
    id,
    encoding: FITTING_MESH_ENCODING,
    data: bytesBase64(zlibSync(raw, { level: 9 })),
    vertices,
    triangles,
    bounds: { min: lo, max: hi },
    ...(groups.length
      ? {
          groups: groups.map((g) =>
            g.name === undefined ? { start: g.start, count: g.count, ...(g.paint ? { paint: g.paint } : {}) } : g,
          ),
        }
      : {}),
  };
}
