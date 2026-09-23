import * as THREE from 'three/webgpu';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface } from '../ships/blueprint';
import { followsComponentPaint } from '../ships/componentMaterials';
import { constructionWearAmount } from '../ships/constructionPaints';

/** Weathering measured once while a construction ship is assembled, for the ship paint shader
 * (ShipSurfaceDetail) to draw. The `shipWear` vertex attribute holds, in metres of the ship frame:
 * - x the design's wear amount on painted steel; 0 on glass, timber, metals and fixed component finishes;
 * - y how far below the top edge of its vertical surface a vertex sits, where runoff streaks start: the deck
 *   edge (sheer) on a built hull's sides, a block face's own top, else the top of a fitting's connected wall;
 * - z how far below the top of its funnel;
 * - w height above the rest waterline, on hull plating.
 * `WEAR_NONE` marks a quantity that does not apply: decks and roofs carry no runoff, only funnels soot, only
 * the hull stains. Each is linear across a triangle, so interpolation stays exact on hull triangles over a
 * hundred metres long; the shader applies all non-linear shaping. Premade ships get zeros from the palette. */
export const WEAR_NONE = 64;
/** Faces steeper than this (|normal y| below it) carry runoff. */
const VERTICAL = .6;
/** Neighbouring vertical faces that bend by less than 60° stay one wall. */
const CREASE = .5;
/** Welding tolerance for finding a fitting's neighbouring faces: a millimetre. */
const WELD = 1000;

const TIMBER = /teak|timber|wood/i;
/** Whether a surface is paint that weathers: not glass, timber, canvas, rope, metal or a fixed detail finish. */
export function wearsPaint(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return false;
  if (material.transparent || material.opacity < 1 || material.metalness > .1 || material.userData.deckSubstrate === 'timber') return false;
  // Hull plating and design-local fittings name their sandbox paint; catalog parts declare component roles.
  if (/^(construction|custom-fitting)\b/.test(material.name) && !('componentMaterialRole' in material.userData)) return !TIMBER.test(material.name);
  return followsComponentPaint(material.name, material.userData);
}

/** A hull's deck edge height along its length: straight between knots, which fall on its stations. */
type Sheer = { z: Float64Array; y: Float64Array };
function sheerAt(sheer: Sheer, z: number): number {
  const { z: zs, y: ys } = sheer, last = zs.length - 1;
  if (z <= zs[0]) return ys[0];
  if (z >= zs[last]) return ys[last];
  let low = 0, high = last;
  while (high - low > 1) { const mid = (low + high) >> 1; if (zs[mid] <= z) low = mid; else high = mid; }
  return ys[low] + (ys[high] - ys[low]) * (z - zs[low]) / (zs[high] - zs[low]);
}

/** Top edges of the hull plating. A built hull's sides hang from its deck edge, so streaks run the full
 * side instead of restarting at every panel row; any other face hangs from the top of its own face group. */
function hullEdges(surfaces: readonly ConstructionSurface[], primitives: readonly ConstructionPrimitive[]) {
  const built = new Set(primitives.filter(p => p.kind === 'custom-hull').map(p => p.id));
  const knots = new Map<string, Map<number, number>>(), tops = new Map<string, number>();
  const group = (s: ConstructionSurface) => `${s.primitiveId}\u0000${s.face}\u0000${s.panelId ?? ''}`;
  for (const surface of surfaces) {
    if (built.has(surface.primitiveId) && surface.face === 'top') {
      // The deck is level across the beam, so every deck vertex lies on the sheer at its station.
      let deck = knots.get(surface.primitiveId);
      if (!deck) knots.set(surface.primitiveId, deck = new Map());
      for (const [, y, z] of surface.vertices) { const key = Math.round(z * WELD); deck.set(key, Math.max(deck.get(key) ?? -Infinity, y)); }
    }
    const key = group(surface);
    tops.set(key, Math.max(tops.get(key) ?? -Infinity, ...surface.vertices.map(v => v[1])));
  }
  const sheers = new Map<string, Sheer>();
  for (const [id, deck] of knots) {
    const keys = [...deck.keys()].sort((a, b) => a - b);
    sheers.set(id, { z: Float64Array.from(keys, key => key / WELD), y: Float64Array.from(keys, key => deck.get(key)!) });
  }
  return (surface: ConstructionSurface, y: number, z: number): number => {
    const sheer = built.has(surface.primitiveId) ? sheers.get(surface.primitiveId) : undefined;
    return (sheer ? sheerAt(sheer, z) : tops.get(group(surface)) ?? y) - y;
  };
}

/** Ship-frame positions of a geometry's vertices. */
function shipPositions(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Float64Array {
  const position = geometry.getAttribute('position'), e = matrix.elements, out = new Float64Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    out[3 * i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[3 * i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[3 * i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

const pow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));
/** One representative vertex per position, to the millimetre: split normals and texture seams still join faces. */
function weld(p: Float64Array): Int32Array {
  const count = p.length / 3, mask = pow2(2 * count) - 1, table = new Int32Array(mask + 1).fill(-1);
  const keys = new Int32Array(count * 3), canon = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const x = Math.round(p[3 * i] * WELD), y = Math.round(p[3 * i + 1] * WELD), z = Math.round(p[3 * i + 2] * WELD);
    keys[3 * i] = x; keys[3 * i + 1] = y; keys[3 * i + 2] = z; canon[i] = i;
    for (let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask; ; h = (h + 1) & mask) {
      const j = table[h];
      if (j < 0) { table[h] = i; break; }
      if (keys[3 * j] === x && keys[3 * j + 1] === y && keys[3 * j + 2] === z) { canon[i] = j; break; }
    }
  }
  return canon;
}

type Measured = { index?: Uint32Array; extra: Int32Array; drop: Float32Array };
/** Drop below the top of each connected vertical wall, per vertex. A vertex shared by different walls, or by a
 * wall and a roof, is split so each keeps its own value; `extra` names the source of each appended vertex. */
function wallDrops(geometry: THREE.BufferGeometry, p: Float64Array): Measured {
  const count = p.length / 3, index = geometry.index, triangles = Math.floor((index ? index.count : count) / 3);
  const corner = index ? (k: number) => index.getX(k) : (k: number) => k;
  const canon = weld(p), parent = new Int32Array(triangles), vertical = new Uint8Array(triangles), normals = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    parent[t] = t;
    const a = 3 * corner(3 * t), b = 3 * corner(3 * t + 1), c = 3 * corner(3 * t + 2);
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz);
    if (!(length > 1e-12)) continue;
    normals[3 * t] = nx / length; normals[3 * t + 1] = ny / length; normals[3 * t + 2] = nz / length;
    vertical[t] = Math.abs(ny / length) < VERTICAL ? 1 : 0;
  }
  const find = (t: number) => { while (parent[t] !== t) t = parent[t] = parent[parent[t]]; return t; };
  // Join vertical faces across shared edges unless they meet at a crease.
  const mask = pow2(6 * triangles) - 1, edgeA = new Int32Array(mask + 1).fill(-1), edgeB = new Int32Array(mask + 1), edgeT = new Int32Array(mask + 1);
  for (let t = 0; t < triangles; t++) {
    if (!vertical[t]) continue;
    for (let k = 0; k < 3; k++) {
      let a = canon[corner(3 * t + k)], b = canon[corner(3 * t + (k + 1) % 3)];
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
      for (let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask; ; h = (h + 1) & mask) {
        if (edgeA[h] < 0) { edgeA[h] = a; edgeB[h] = b; edgeT[h] = t; break; }
        if (edgeA[h] !== a || edgeB[h] !== b) continue;
        const o = edgeT[h];
        if (normals[3 * t] * normals[3 * o] + normals[3 * t + 1] * normals[3 * o + 1] + normals[3 * t + 2] * normals[3 * o + 2] > CREASE) parent[find(t)] = find(o);
        break;
      }
    }
  }
  const top = new Float64Array(triangles).fill(-Infinity);
  for (let t = 0; t < triangles; t++) if (vertical[t]) {
    const r = find(t);
    for (let k = 0; k < 3; k++) top[r] = Math.max(top[r], p[3 * corner(3 * t + k) + 1]);
  }
  // Assign each corner its wall (`triangles` stands for no wall), splitting vertices claimed by two.
  const owner = new Int32Array(count).fill(-1), corners = new Uint32Array(triangles * 3), extra: number[] = [], extraOwner: number[] = [];
  const copies = new Map<number, number>();
  for (let t = 0; t < triangles; t++) {
    const wall = vertical[t] ? find(t) : triangles;
    for (let k = 0; k < 3; k++) {
      const v = corner(3 * t + k);
      if (owner[v] < 0) owner[v] = wall;
      if (owner[v] === wall) { corners[3 * t + k] = v; continue; }
      const key = v * (triangles + 1) + wall;
      let copy = copies.get(key);
      if (copy === undefined) { copies.set(key, copy = count + extra.length); extra.push(v); extraOwner.push(wall); }
      corners[3 * t + k] = copy;
    }
  }
  const drop = new Float32Array(count + extra.length);
  const dropOf = (v: number, wall: number) => wall < 0 || wall === triangles ? WEAR_NONE : top[wall] - p[3 * v + 1];
  for (let v = 0; v < count; v++) drop[v] = dropOf(v, owner[v]);
  for (let i = 0; i < extra.length; i++) drop[count + i] = dropOf(extra[i], extraOwner[i]);
  return { index: index && extra.length ? corners : undefined, extra: Int32Array.from(extra), drop };
}

/** Append copies of `extra` source vertices to an attribute, stored values unchanged (normalized ones too). */
function extended(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, extra: Int32Array): THREE.BufferAttribute {
  const size = attribute.itemSize, count = attribute.count, interleaved = (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
  const data = interleaved ? (attribute as THREE.InterleavedBufferAttribute).data.array : attribute.array as ArrayLike<number>;
  const stride = interleaved ? (attribute as THREE.InterleavedBufferAttribute).data.stride : size, offset = interleaved ? (attribute as THREE.InterleavedBufferAttribute).offset : 0;
  const array = new ((data as Float32Array).constructor as Float32ArrayConstructor)((count + extra.length) * size);
  const copy = (to: number, from: number) => { for (let c = 0; c < size; c++) array[to * size + c] = data[from * stride + offset + c]; };
  for (let v = 0; v < count; v++) copy(v, v);
  for (let i = 0; i < extra.length; i++) copy(count + i, extra[i]);
  return new THREE.BufferAttribute(array, size, attribute.normalized);
}

/** Linear part of a mesh's ship transform with its heading removed, which leaves every wear quantity unchanged. */
const yaw = new THREE.Matrix4();
function headingFree(matrix: THREE.Matrix4): string {
  const e = matrix.elements, heading = Math.hypot(e[0], e[2]) > 1e-6 ? Math.atan2(e[2], e[0]) : Math.atan2(-e[8], e[10]);
  yaw.makeRotationY(heading).multiply(matrix);
  const f = yaw.elements;
  return [f[0], f[1], f[2], f[4], f[5], f[6], f[8], f[9], f[10]].map(n => Math.round(n * 1e4) || 0).join(',');
}

/** Write `shipWear` on every mesh of an assembled construction model (see the module header). Meshes that
 * share a geometry get their own copy only where their wear differs, as a scaled or funnel-mounted instance. */
export function applyConstructionWear(group: THREE.Object3D, source: ConstructionSource, result: ConstructionResult): void {
  const amount = constructionWearAmount(source), waterline = result.loading?.waterlineY ?? 0;
  const toShip = new THREE.Matrix4().copy(group.matrixWorld).invert(), matrix = new THREE.Matrix4();
  const meshes: THREE.Mesh[] = [];
  group.traverse(node => { if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')) meshes.push(node); });
  const shipMatrix = (mesh: THREE.Mesh) => matrix.multiplyMatrices(toShip, mesh.matrixWorld);
  // Funnel tops, per installation.
  const funnels = new Map<string, number>();
  for (const mesh of meshes) if (mesh.userData.constructionEquipmentKind === 'funnel') {
    const p = shipPositions(mesh.geometry, shipMatrix(mesh)), id = String(mesh.userData.sourceId);
    let top = funnels.get(id) ?? -Infinity;
    for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
    funnels.set(id, top);
  }
  const hullSurfaces = meshes.flatMap(mesh => mesh.userData.assemblyId === 'hull' && Array.isArray(mesh.userData.constructionSurfaces) ? mesh.userData.constructionSurfaces as ConstructionSurface[] : []);
  const edgeDrop = hullEdges([...new Set(hullSurfaces)], source.construction.primitives);
  const derived = new Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
  for (const mesh of meshes) {
    const shared = mesh.geometry, count = shared.getAttribute('position').count, paint = wearsPaint(mesh.material) ? amount : 0, m = shipMatrix(mesh);
    const surfaces = mesh.userData.assemblyId === 'hull' ? mesh.userData.constructionSurfaces as ConstructionSurface[] | undefined : undefined;
    if (paint && surfaces && !shared.index && surfaces.length * 3 === count) {
      // Hull plating: its own unindexed triangles, each attributed to its compiled surface.
      const p = shipPositions(shared, m), wear = new Float32Array(count * 4);
      for (let t = 0; t < surfaces.length; t++) {
        const a = 9 * t, ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2], vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, wall = Math.abs(ny) < VERTICAL * Math.hypot(nx, ny, nz);
        for (let k = 0; k < 3; k++) {
          const v = 3 * t + k, y = p[3 * v + 1];
          wear[4 * v] = paint; wear[4 * v + 1] = wall ? edgeDrop(surfaces[t], y, p[3 * v + 2]) : WEAR_NONE; wear[4 * v + 2] = WEAR_NONE; wear[4 * v + 3] = y - waterline;
        }
      }
      shared.setAttribute('shipWear', new THREE.BufferAttribute(wear, 4));
      continue;
    }
    // Unpainted, or one geometry drawn at many poses: at most the paint mottles.
    const plain = !paint || (mesh as THREE.InstancedMesh).isInstancedMesh;
    const funnelTop = plain || mesh.userData.constructionEquipmentKind !== 'funnel' ? undefined : funnels.get(String(mesh.userData.sourceId));
    const key = plain ? `${paint}` : `${paint}|${headingFree(m)}|${funnelTop === undefined ? '' : (funnelTop - m.elements[13]).toFixed(3)}`;
    let variants = derived.get(shared);
    if (!variants) derived.set(shared, variants = new Map());
    const done = variants.get(key);
    if (done) { mesh.geometry = done; continue; }
    // The first variant keeps the shared geometry; any other is a copy of it.
    const geometry = variants.size ? shared.clone() : shared;
    const p = plain ? undefined : shipPositions(geometry, m), measured = p && wallDrops(geometry, p), total = measured ? measured.drop.length : count;
    if (measured?.extra.length) {
      for (const [name, attribute] of Object.entries(geometry.attributes)) geometry.setAttribute(name, extended(attribute, measured.extra));
    }
    if (measured?.index) geometry.setIndex(new THREE.BufferAttribute(total > 65535 ? measured.index : Uint16Array.from(measured.index), 1));
    const wear = new Float32Array(total * 4);
    for (let v = 0; v < total; v++) {
      wear[4 * v] = paint; wear[4 * v + 1] = measured ? measured.drop[v] : WEAR_NONE; wear[4 * v + 3] = WEAR_NONE;
      wear[4 * v + 2] = funnelTop === undefined ? WEAR_NONE : funnelTop - p![3 * (v < count ? v : measured!.extra[v - count]) + 1];
    }
    geometry.setAttribute('shipWear', new THREE.BufferAttribute(wear, 4));
    variants.set(key, geometry); mesh.geometry = geometry;
  }
}
