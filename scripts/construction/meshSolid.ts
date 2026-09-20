/** Turn a closed triangle mesh into the compound solid the compiler accepts: an ordered union of
 * convex parts. The decomposition is a BSP over the mesh's own face planes, so every part is an
 * exact half-space intersection and the parts tile the solid without sharing volume — which is
 * what `crates/naval-sim/src/construction_solid.rs` validates. Approximate decompositions are
 * deliberately avoided: the compiler is the same code in the browser, the worker and the server,
 * so a source that compiles anywhere must compile everywhere. */
import type { ConstructionSolid, ConstructionSolidPart, Vec3 } from '../../src/ships/blueprint';
import type { MeshTriangle } from './meshFile';

export interface MeshSolidOptions {
  label: string;
  /** Grid used to weld near-coincident corners, in file units. */
  weldM?: number;
  maxParts?: number;
  /** Distinct cutting planes. The BSP is exponential in this, so it is the real budget. */
  maxPlanes?: number;
}
export interface MeshSolidReport {
  solid: ConstructionSolid;
  size: Vec3;
  /** Envelope centre in the file's own coordinates; the caller turns it into `position`. */
  center: Vec3;
  triangles: number;
  welded: number;
  planes: number;
  parts: number;
  volumeM3: number;
  notes: string[];
}
type P = readonly [number, number, number];
const sub = (a: P, b: P): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P, b: P): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: P) => Math.sqrt(dot(a, a));
const add = (a: P, b: P): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: P, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** A plane as an outward unit normal and its offset, deduplicated so parallel mesh faces that
 * really are the same plane cut the tree once. */
interface Plane { n: Vec3; d: number }
/** One convex cell: a half-space intersection kept as its boundary polygons. */
interface Cell { faces: { plane: Plane; loop: Vec3[] }[] }

function planeKey(plane: Plane, scale: number) {
  const q = (n: number, step: number) => Math.round(n / step);
  // A plane and its reverse are one cutting plane; canonicalize the sign first.
  const flip = plane.n[0] < -1e-9 || (Math.abs(plane.n[0]) <= 1e-9 && (plane.n[1] < -1e-9 || (Math.abs(plane.n[1]) <= 1e-9 && plane.n[2] < 0)));
  const n = flip ? mul(plane.n, -1) : plane.n, d = flip ? -plane.d : plane.d;
  return [q(n[0], 1e-6), q(n[1], 1e-6), q(n[2], 1e-6), q(d, scale * 1e-6)].join(',');
}
function boxCell(low: Vec3, high: Vec3): Cell {
  const corner = (i: number): Vec3 => [i & 1 ? high[0] : low[0], i & 2 ? high[1] : low[1], i & 4 ? high[2] : low[2]];
  const quads: [number, number, number, number][] = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  return {
    faces: quads.map(q => {
      const loop = q.map(corner);
      const n = unit(cross(sub(loop[1], loop[0]), sub(loop[2], loop[0])));
      return { plane: { n, d: dot(n, loop[0]) }, loop };
    }),
  };
}
function unit(v: Vec3): Vec3 { const l = len(v); return l > 0 ? mul(v, 1 / l) : [0, 0, 0]; }

/** Clip one convex cell to `dot(n, x) <= d`. Returns undefined when nothing is left. The cap is
 * built from the cut segments: a convex cell's cross-section is convex, so an angular sort about
 * its own centroid is enough to order it — no general loop chaining is needed. */
function clip(cell: Cell, plane: Plane, eps: number): Cell | undefined {
  const faces: Cell['faces'] = [], cut: Vec3[] = [];
  for (const face of cell.faces) {
    const loop: Vec3[] = [];
    for (let i = 0; i < face.loop.length; i++) {
      const a = face.loop[i], b = face.loop[(i + 1) % face.loop.length];
      const da = dot(plane.n, a) - plane.d, db = dot(plane.n, b) - plane.d;
      if (da <= eps) loop.push(a);
      if ((da > eps && db < -eps) || (da < -eps && db > eps)) {
        const t = da / (da - db);
        const point = add(a, mul(sub(b, a), t));
        loop.push(point); cut.push(point);
      } else if (Math.abs(da) <= eps) cut.push(a);
    }
    if (loop.length >= 3) faces.push({ plane: face.plane, loop: dedupe(loop, eps) });
  }
  if (!faces.length) return undefined;
  const ring = dedupe(cut, eps);
  if (ring.length >= 3) {
    const centre = mul(ring.reduce<Vec3>((s, v) => add(s, v), [0, 0, 0]), 1 / ring.length);
    const axis = unit(sub(ring[0], centre));
    const other = unit(cross(plane.n, axis));
    const ordered = [...ring].sort((p, q) => Math.atan2(dot(sub(p, centre), other), dot(sub(p, centre), axis)) - Math.atan2(dot(sub(q, centre), other), dot(sub(q, centre), axis)));
    // The cap's outward normal is the clipping plane's own.
    faces.push({ plane, loop: ordered });
  }
  return faces.length >= 4 ? { faces } : undefined;
}
function dedupe(loop: Vec3[], eps: number): Vec3[] {
  const out: Vec3[] = [];
  for (const v of loop) if (!out.some(w => len(sub(w, v)) <= eps)) out.push(v);
  return out;
}
function cellVolume(cell: Cell) {
  let volume = 0;
  const origin = cell.faces[0].loop[0];
  for (const face of cell.faces) for (let i = 1; i < face.loop.length - 1; i++)
    volume += dot(sub(face.loop[0], origin), cross(sub(face.loop[i], origin), sub(face.loop[i + 1], origin))) / 6;
  return volume;
}
function cellCentre(cell: Cell): Vec3 {
  const points = cell.faces.flatMap(f => f.loop);
  return mul(points.reduce<Vec3>((s, v) => add(s, v), [0, 0, 0]), 1 / points.length);
}

/** Ray parity against the source triangles. The direction is irrational on purpose so a ray
 * through a shared edge or a vertex is vanishingly unlikely; a near-parallel or near-edge hit
 * retries with another direction rather than guessing. */
function inside(point: Vec3, tris: Vec3[][], eps: number) {
  for (const dir of [[0.5773502691896258, 0.5227, 0.6265], [0.2673, 0.5345, 0.8018], [0.8018, 0.2673, 0.5345]] as Vec3[]) {
    let hits = 0, shaky = false;
    for (const [a, b, c] of tris) {
      const e1 = sub(b, a), e2 = sub(c, a), h = cross(dir, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(point, a), u = dot(s, h) / det;
      if (u < -eps || u > 1 + eps) continue;
      const q = cross(s, e1), v = dot(dir, q) / det;
      if (v < -eps || u + v > 1 + eps) continue;
      const t = dot(e2, q) / det;
      if (t <= eps) continue;
      if (u < eps || v < eps || u + v > 1 - eps) { shaky = true; break; }
      hits++;
    }
    if (!shaky) return hits % 2 === 1;
  }
  return false;
}

/** Weld corners onto a grid, drop degenerate and duplicated triangles, and report what a closed
 * surface would need. The caller turns the findings into an error the author can act on. */
export function repairMesh(triangles: MeshTriangle[], weld: number) {
  const pool: Vec3[] = [], index = new Map<string, number>();
  const at = (v: readonly number[]) => {
    const key = v.map(n => Math.round(n / weld)).join(',');
    let i = index.get(key);
    // The grid only decides which corners are the same corner; the first one seen keeps its own
    // coordinates, so welding never drifts geometry onto the grid.
    if (i === undefined) { i = pool.length; index.set(key, i); pool.push([...v] as Vec3); }
    return i;
  };
  const faces: { v: [number, number, number]; group?: string }[] = [];
  const seen = new Set<string>();
  let degenerate = 0, duplicate = 0;
  for (const t of triangles) {
    const v: [number, number, number] = [at(t.a), at(t.b), at(t.c)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) { degenerate++; continue; }
    if (len(cross(sub(pool[v[1]], pool[v[0]]), sub(pool[v[2]], pool[v[0]]))) < weld * weld) { degenerate++; continue; }
    const key = [...v].sort((a, b) => a - b).join(',');
    if (seen.has(key)) { duplicate++; continue; }
    seen.add(key);
    faces.push({ v, group: t.group });
  }
  // A closed, consistently oriented surface walks every edge exactly twice, once each way.
  const undirected = new Map<string, number>(), directed = new Map<string, number>();
  for (const f of faces) for (let i = 0; i < 3; i++) {
    const a = f.v[i], b = f.v[(i + 1) % 3];
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    undirected.set(key, (undirected.get(key) ?? 0) + 1);
    directed.set(`${a},${b}`, (directed.get(`${a},${b}`) ?? 0) + 1);
  }
  const open = [...undirected].filter(([, n]) => n !== 2);
  const flipped = [...directed].filter(([, n]) => n > 1);
  let volume = 0;
  for (const f of faces) volume += dot(pool[f.v[0]], cross(pool[f.v[1]], pool[f.v[2]])) / 6;
  return { pool, faces, degenerate, duplicate, open, flipped, volume };
}

/** Triangles that pierce each other. A uniform grid keeps this near-linear for the sizes the
 * importer admits; a hit is reported as the two source triangle indices so the author can find it. */
export function selfIntersections(pool: Vec3[], faces: { v: [number, number, number] }[], eps: number) {
  const box = (f: { v: [number, number, number] }) => {
    const p = f.v.map(i => pool[i]);
    return { lo: [0, 1, 2].map(k => Math.min(...p.map(v => v[k]))) as Vec3, hi: [0, 1, 2].map(k => Math.max(...p.map(v => v[k]))) as Vec3 };
  };
  const boxes = faces.map(box);
  const span = Math.max(...[0, 1, 2].map(k => Math.max(...boxes.map(b => b.hi[k])) - Math.min(...boxes.map(b => b.lo[k]))));
  const cellSize = Math.max(span / Math.ceil(Math.cbrt(faces.length)) || span, eps * 16);
  const grid = new Map<string, number[]>();
  const keys = (b: { lo: Vec3; hi: Vec3 }) => {
    const out: string[] = [];
    for (let x = Math.floor(b.lo[0] / cellSize); x <= Math.floor(b.hi[0] / cellSize); x++)
      for (let y = Math.floor(b.lo[1] / cellSize); y <= Math.floor(b.hi[1] / cellSize); y++)
        for (let z = Math.floor(b.lo[2] / cellSize); z <= Math.floor(b.hi[2] / cellSize); z++) out.push(`${x},${y},${z}`);
    return out;
  };
  faces.forEach((_, i) => { for (const key of keys(boxes[i])) (grid.get(key) ?? grid.set(key, []).get(key)!).push(i); });
  const pairs: [number, number][] = [];
  const shares = (a: [number, number, number], b: [number, number, number]) => a.some(i => b.includes(i));
  const tested = new Set<string>();
  for (const bucket of grid.values()) for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++) {
    const [x, y] = [bucket[i], bucket[j]];
    const key = `${x},${y}`;
    if (tested.has(key)) continue;
    tested.add(key);
    if (shares(faces[x].v, faces[y].v)) continue;
    if ([0, 1, 2].some(k => boxes[x].lo[k] > boxes[y].hi[k] + eps || boxes[y].lo[k] > boxes[x].hi[k] + eps)) continue;
    if (crossesTriangle(faces[x].v.map(n => pool[n]) as Vec3[], faces[y].v.map(n => pool[n]) as Vec3[], eps)) pairs.push([x, y]);
    if (pairs.length >= 8) return pairs;
  }
  return pairs;
}
/** An edge of one triangle strictly through the interior of the other, either way round. */
function crossesTriangle(a: Vec3[], b: Vec3[], eps: number) {
  const pierce = (tri: Vec3[], p: Vec3, q: Vec3) => {
    const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])), d = dot(n, tri[0]);
    const dp = dot(n, p) - d, dq = dot(n, q) - d;
    if ((dp > eps && dq > eps) || (dp < -eps && dq < -eps) || Math.abs(dp - dq) < 1e-18) return false;
    const point = add(p, mul(sub(q, p), dp / (dp - dq)));
    const side = (u: Vec3, v: Vec3) => dot(cross(sub(v, u), sub(point, u)), n);
    const [s0, s1, s2] = [side(tri[0], tri[1]), side(tri[1], tri[2]), side(tri[2], tri[0])];
    const scale = len(n) * eps;
    return (s0 > scale && s1 > scale && s2 > scale) || (s0 < -scale && s1 < -scale && s2 < -scale);
  };
  for (let i = 0; i < 3; i++) if (pierce(b, a[i], a[(i + 1) % 3]) || pierce(a, b[i], b[(i + 1) % 3])) return true;
  return false;
}

/** The whole import: repair, check, decompose, and emit the normalized source record. */
export function meshToSolid(triangles: MeshTriangle[], options: MeshSolidOptions): MeshSolidReport {
  const notes: string[] = [];
  const extent = (points: readonly Vec3[]) => {
    const lo = [0, 1, 2].map(k => Math.min(...points.map(v => v[k]))) as Vec3;
    const hi = [0, 1, 2].map(k => Math.max(...points.map(v => v[k]))) as Vec3;
    return { lo, hi, span: Math.max(...[0, 1, 2].map(k => hi[k] - lo[k])) };
  };
  const raw = triangles.flatMap(t => [t.a, t.b, t.c] as Vec3[]);
  if (raw.length < 12) throw new Error('A closed solid needs at least four triangles.');
  const span = extent(raw).span;
  if (!(span > 0) || !Number.isFinite(span)) throw new Error('The mesh has no extent, or carries values that are not finite.');
  const weld = options.weldM ?? span * 1e-5;
  const maxParts = options.maxParts ?? 256, maxPlanes = options.maxPlanes ?? 48;
  const mesh = repairMesh(triangles, weld);
  if (mesh.degenerate || mesh.duplicate)
    notes.push(`Dropped ${mesh.degenerate} degenerate and ${mesh.duplicate} duplicated triangles while welding at ${weld.toExponential(2)}.`);
  if (!mesh.faces.length) throw new Error('Every triangle was degenerate after welding. Lower --weld, or repair the mesh.');
  if (mesh.open.length) {
    const sample = mesh.open.slice(0, 5).map(([edge, n]) => `${edge} used ${n}x`).join('; ');
    throw new Error(`The mesh is not watertight: ${mesh.open.length} edges are not shared by exactly two triangles (welded vertex pairs ${sample}). Close the holes, or raise --weld if the seams are only near-coincident.`);
  }
  if (mesh.flipped.length)
    throw new Error(`The mesh is not consistently oriented: ${mesh.flipped.length} edges are walked the same way by both their triangles. Recalculate the normals so every triangle faces outward.`);
  const hits = selfIntersections(mesh.pool, mesh.faces, weld);
  if (hits.length) {
    const sample = hits.slice(0, 3).map(([a, b]) => `${a}/${b}`).join(', ');
    throw new Error(`The mesh intersects itself: ${hits.length === 8 ? 'at least 8' : hits.length} triangle pairs pierce each other, for example ${sample} (indices after welding). Boolean-union the overlapping shells before importing.`);
  }
  let faces = mesh.faces;
  if (mesh.volume < 0) {
    notes.push('The mesh was inside-out; every triangle was reversed.');
    faces = faces.map(f => ({ ...f, v: [f.v[0], f.v[2], f.v[1]] as [number, number, number] }));
  }
  const volume = Math.abs(mesh.volume);
  if (volume < weld ** 3) throw new Error('The mesh encloses no volume. A compound solid must be a solid, not a surface.');

  // One cutting plane per distinct triangle plane, weighted so the planes that carry the most
  // area cut first: those are the real walls, and cutting on them keeps the part count down.
  const planes = new Map<string, { plane: Plane; area: number; group?: string; groups: Map<string, number> }>();
  const tris: Vec3[][] = faces.map(f => f.v.map(i => mesh.pool[i]) as Vec3[]);
  faces.forEach((f, i) => {
    const [a, b, c] = tris[i];
    const raw = cross(sub(b, a), sub(c, a)), area = len(raw) / 2;
    if (area <= 0) return;
    const plane = { n: unit(raw), d: 0 };
    plane.d = dot(plane.n, a);
    const key = planeKey(plane, span);
    const row = planes.get(key) ?? { plane, area: 0, groups: new Map<string, number>() };
    row.area += area;
    if (f.group) row.groups.set(f.group, (row.groups.get(f.group) ?? 0) + area);
    planes.set(key, row);
  });
  const ordered = [...planes.values()].sort((a, b) => b.area - a.area);
  if (ordered.length > maxPlanes)
    throw new Error(`The mesh has ${ordered.length} distinct face planes; the importer cuts at most ${maxPlanes}. Simplify or decimate the mesh, or raise --max-planes knowing the decomposition is exponential in it.`);

  // A BSP over the mesh's own planes. A cell is only classified once no remaining plane cuts
  // through it: until then it can straddle the surface, and its centroid says nothing. Skipping
  // the planes that miss a cell is what keeps the tree from being 2^planes wide.
  const { lo, hi } = extent(mesh.pool);
  const pad = span * 1e-3;
  const eps = weld;
  const straddles = (cell: Cell, plane: Plane) => {
    let over = false, under = false;
    for (const face of cell.faces) for (const v of face.loop) {
      const s = dot(plane.n, v) - plane.d;
      if (s > eps) over = true; else if (s < -eps) under = true;
      if (over && under) return true;
    }
    return false;
  };
  const cells: Cell[] = [];
  const queue: { cell: Cell; from: number }[] = [{ cell: boxCell(lo.map(n => n - pad) as Vec3, hi.map(n => n + pad) as Vec3), from: 0 }];
  let visited = 0;
  while (queue.length) {
    const { cell, from } = queue.shift()!;
    if (++visited > maxParts * 64)
      throw new Error(`The decomposition passed ${visited} cells; a compound solid holds at most ${maxParts} parts. Simplify or decimate the mesh.`);
    let k = from;
    while (k < ordered.length && !straddles(cell, ordered[k].plane)) k++;
    if (k >= ordered.length) {
      if (Math.abs(cellVolume(cell)) > eps ** 3 && inside(cellCentre(cell), tris, 1e-6)) cells.push(cell);
      continue;
    }
    const plane = ordered[k].plane;
    for (const piece of [clip(cell, plane, eps), clip(cell, { n: mul(plane.n, -1), d: -plane.d }, eps)])
      if (piece && Math.abs(cellVolume(piece)) > eps ** 3) queue.push({ cell: piece, from: k + 1 });
  }
  if (!cells.length) throw new Error('The decomposition kept nothing. Check that the mesh is closed and its triangles face outward.');
  if (cells.length > maxParts)
    throw new Error(`The mesh decomposes into ${cells.length} convex parts; the limit is ${maxParts}. Simplify the mesh, or split it across several blocks.`);
  const solidVolume = cells.reduce((sum, cell) => sum + Math.abs(cellVolume(cell)), 0);
  if (Math.abs(solidVolume - volume) > Math.max(volume * 5e-3, eps ** 3))
    notes.push(`The parts enclose ${solidVolume.toFixed(4)} against the mesh's ${volume.toFixed(4)}; the difference is ${(100 * Math.abs(solidVolume - volume) / volume).toFixed(2)}% and comes from welding.`);

  // Emit the shared pool in the normalized +/-0.5 frame the format requires, so `size` and
  // `position` are the block's real envelope.
  const used = cells.flatMap(cell => cell.faces.flatMap(f => f.loop));
  const bounds = extent(used);
  const size: Vec3 = [0, 1, 2].map(k => bounds.hi[k] - bounds.lo[k] || 1) as Vec3;
  const center: Vec3 = [0, 1, 2].map(k => (bounds.hi[k] + bounds.lo[k]) / 2) as Vec3;
  const vertices: Vec3[] = [], pool = new Map<string, number>();
  const corner = (v: Vec3) => {
    const local = [0, 1, 2].map(k => Math.min(0.5, Math.max(-0.5, (v[k] - center[k]) / size[k]))) as Vec3;
    const key = local.map(n => Math.round(n / 1e-9)).join(',');
    let i = pool.get(key);
    if (i === undefined) { i = vertices.length; pool.set(key, i); vertices.push(local); }
    return i;
  };
  const groupOf = (plane: Plane) => {
    const row = planes.get(planeKey(plane, span));
    if (!row || !row.groups.size) return undefined;
    return [...row.groups].sort((a, b) => b[1] - a[1])[0][0];
  };
  const parts: ConstructionSolidPart[] = cells.map((cell, i) => ({
    id: `part-${i + 1}`,
    faces: cell.faces.map(face => {
      // The loop is stored counter-clockwise seen from outside, which is the plane's own normal.
      const loop = orient(face.loop, face.plane.n);
      const group = groupOf(face.plane);
      return { corners: loop.map(corner), ...(group ? { group } : {}) };
    }).filter(face => new Set(face.corners).size === face.corners.length && face.corners.length >= 3),
  }));
  const thin = parts.find(part => part.faces.length < 4);
  if (thin) throw new Error(`Part ${thin.id} came out with ${thin.faces.length} polygons after welding; lower --weld or simplify the mesh.`);
  return {
    solid: { version: 1, label: options.label, vertices, parts },
    size, center,
    triangles: triangles.length, welded: mesh.pool.length, planes: ordered.length,
    parts: parts.length, volumeM3: solidVolume, notes,
  };
}
/** Order a convex loop counter-clockwise about its own normal. */
function orient(loop: Vec3[], n: Vec3): Vec3[] {
  const centre = mul(loop.reduce<Vec3>((s, v) => add(s, v), [0, 0, 0]), 1 / loop.length);
  const axis = unit(sub(loop[0], centre)), other = unit(cross(n, axis));
  const angle = (v: Vec3) => Math.atan2(dot(sub(v, centre), other), dot(sub(v, centre), axis));
  return [...loop].sort((a, b) => angle(a) - angle(b));
}
