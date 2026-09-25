import * as THREE from 'three/webgpu';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface } from '../ships/blueprint';
import { followsComponentPaint } from '../ships/componentMaterials';
import { constructionWearAmount } from '../ships/constructionPaints';

/** Weathering measured once per ship model, for the ship paint shader (ShipSurfaceDetail) to draw: while a player-built
 * ship is assembled (`applyConstructionWear`) and when a premade ship's published model loads (`applyPremadeWear`). The
 * `shipWear` vertex attribute holds, in metres of the ship frame:
 * - x the ship's wear amount on painted steel; 0 on glass, timber, metals and fixed component finishes. Once a game hull
 *   template has a porthole table (portholeWeeps), its still paint adds twice the table's number (`wornAmount` reads the amount);
 * - y how far below the top edge of its vertical surface a vertex sits, where runoff streaks start: the deck
 *   edge (sheer) on a hull's sides, a block face's own top, else the top of a fitting's connected wall;
 * - z how far below the top of its funnel; on any other wall, `FOOT` plus its height above the wall's foot, where grime
 *   gathers (not on a turret's gunhouse or barbette, whose lower edges overhang or stand in the mount, nor on a wall lower than
 *   `FOOT_WALL`, such as a lip or a coaming);
 * - w height above the rest waterline: on a player-built ship's hull plating, on every painted surface of a premade one.
 * `WEAR_NONE` marks a quantity that does not apply: decks and roofs carry no runoff, only funnels soot, only
 * the hull stains. Each is linear across a triangle, so interpolation stays exact on hull triangles over a
 * hundred metres long; the shader applies all non-linear shaping. A ship with no wear gets zeros from the palette. */
export const WEAR_NONE = 64;
/** Faces steeper than this (|normal y| below it) carry runoff. */
const VERTICAL = .6;
/** Neighbouring vertical faces that bend by less than 60° stay one wall. */
const CREASE = .5;
/** Welding tolerance for finding a fitting's neighbouring faces: a millimetre. */
const WELD = 1000;

/** A player-built ship's own sandbox paint, as its model names it: `construction.<paint>…` on the hull, blocks and propeller
 * supports (kept by the published GLBs of construction presets) and `custom-fitting.<paint>…` on painted design-local
 * fittings; not timber or bare shaft steel. The one test for both its wear here and its plating (ShipSurfaceDetail). */
export const isConstructionPaint = (material: THREE.MeshStandardMaterial): boolean => material.metalness <= .1 &&
  /^(construction|custom-fitting)\./.test(material.name) && !('componentMaterialRole' in material.userData) && !/teak|timber|wood/i.test(material.name);

/** Appearance finishes and component roles of welded steel plate. Canvas, glass, rope, timber, dark recesses and metals are not. */
const PLATED_FINISHES = new Set(['painted-steel', 'painted-deck', 'underwater-coating']);
const PLATED_ROLES = new Set(['naval', 'hullgray', 'roof', 'underwater']);
/** Fitting paints share painted-steel with the hull but cover castings, canvas and small welded parts. */
const FITTING_PAINT = /-(edge|fittings|raft|light|canvas)$/;

/** Whether a source material's paint is welded steel plate: a premade ship's plated appearance finish that is not a fitting
 * paint, a plated component role, or a player-built ship's own paint. ShipSurfaceDetail plates it, where broad enough. */
export function isPlatedPaint(material: THREE.MeshStandardMaterial): boolean {
  if (material.metalness > .1 || material.userData.deckSubstrate === 'timber') return false;
  const { surfaceFinish, componentMaterialRole } = material.userData;
  if (typeof surfaceFinish === 'string') return PLATED_FINISHES.has(surfaceFinish) && !FITTING_PAINT.test(String(material.userData.paintId ?? ''));
  if (typeof componentMaterialRole === 'string') return PLATED_ROLES.has(componentMaterialRole);
  return isConstructionPaint(material);
}

/** Whether a surface is paint that weathers: not glass, timber, canvas, rope, metal or a fixed detail finish. A premade ship's
 * appearance names its paints' finishes, and its plated paints weather; component parts follow their role's paint. */
export function wearsPaint(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return false;
  if (material.transparent || material.opacity < 1 || material.metalness > .1 || material.userData.deckSubstrate === 'timber') return false;
  if (typeof material.userData.surfaceFinish === 'string') return isPlatedPaint(material);
  // Catalog parts and unpainted design-local fittings declare component roles.
  return isConstructionPaint(material) || followsComponentPaint(material.name, material.userData);
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

type Measured = { index?: Uint32Array; extra: Int32Array; drop: Float32Array; rise: Float32Array };
/** Offset of a wall's height above its foot in `shipWear.z`, clear of a funnel's drop (under `WEAR_NONE`). */
export const FOOT = 100;
/** Walls lower than this carry no foot grime. */
const FOOT_WALL = .6;
/** Drop below the top of each connected vertical wall, and rise above its foot (−1 where it has none), per vertex. A vertex
 * shared by different walls, or by a wall and a roof, is split so each keeps its own values; `extra` names the source of each
 * appended vertex. */
function wallDrops(geometry: THREE.BufferGeometry, p: Float64Array): Measured {
  const count = p.length / 3, index = geometry.index, triangles = Math.floor((index ? index.count : count) / 3);
  // Corner k's vertex, read once: attribute accessors and closures cost more than the measurement on large models.
  const corners = new Uint32Array(triangles * 3);
  for (let k = 0; k < corners.length; k++) corners[k] = index ? index.getX(k) : k;
  const canon = weld(p), parent = new Int32Array(triangles), vertical = new Uint8Array(triangles), normals = new Float32Array(triangles * 3);
  let walls = 0;
  for (let t = 0; t < triangles; t++) {
    parent[t] = t;
    const a = 3 * corners[3 * t], b = 3 * corners[3 * t + 1], c = 3 * corners[3 * t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(length > 1e-12)) continue;
    normals[3 * t] = nx / length; normals[3 * t + 1] = ny / length; normals[3 * t + 2] = nz / length;
    if (Math.abs(ny / length) < VERTICAL) { vertical[t] = 1; walls++; }
  }
  const find = (t: number) => { while (parent[t] !== t) t = parent[t] = parent[parent[t]]; return t; };
  // Join vertical faces across shared edges unless they meet at a crease.
  const mask = pow2(6 * walls) - 1, edgeA = new Int32Array(mask + 1).fill(-1), edgeB = new Int32Array(mask + 1), edgeT = new Int32Array(mask + 1);
  for (let t = 0; t < triangles; t++) {
    if (!vertical[t]) continue;
    for (let k = 0; k < 3; k++) {
      const u = canon[corners[3 * t + k]], w = canon[corners[3 * t + (k === 2 ? 0 : k + 1)]];
      if (u === w) continue;
      const a = u < w ? u : w, b = u < w ? w : u;
      for (let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask; ; h = (h + 1) & mask) {
        const stored = edgeA[h];
        if (stored < 0) { edgeA[h] = a; edgeB[h] = b; edgeT[h] = t; break; }
        if (stored !== a || edgeB[h] !== b) continue;
        const o = edgeT[h];
        if (normals[3 * t] * normals[3 * o] + normals[3 * t + 1] * normals[3 * o + 1] + normals[3 * t + 2] * normals[3 * o + 2] > CREASE) parent[find(t)] = find(o);
        break;
      }
    }
  }
  const top = new Float64Array(triangles).fill(-Infinity), bottom = new Float64Array(triangles).fill(Infinity), wallOf = new Int32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    if (!vertical[t]) { wallOf[t] = triangles; continue; }
    const r = wallOf[t] = find(t);
    for (let k = 0; k < 3; k++) { const y = p[3 * corners[3 * t + k] + 1]; if (y > top[r]) top[r] = y; if (y < bottom[r]) bottom[r] = y; }
  }
  // Assign each corner its wall (`triangles` stands for no wall), splitting vertices claimed by two.
  const owner = new Int32Array(count).fill(-1), extra: number[] = [], extraOwner: number[] = [];
  let copies: Map<number, number> | undefined;
  for (let t = 0; t < triangles; t++) {
    const wall = wallOf[t];
    for (let k = 3 * t; k < 3 * t + 3; k++) {
      const v = corners[k];
      if (owner[v] < 0) owner[v] = wall;
      if (owner[v] === wall) continue;
      const key = v * (triangles + 1) + wall;
      copies ??= new Map();
      let copy = copies.get(key);
      if (copy === undefined) { copies.set(key, copy = count + extra.length); extra.push(v); extraOwner.push(wall); }
      corners[k] = copy;
    }
  }
  const drop = new Float32Array(count + extra.length);
  const dropOf = (v: number, wall: number) => wall < 0 || wall === triangles ? WEAR_NONE : top[wall] - p[3 * v + 1];
  for (let v = 0; v < count; v++) drop[v] = dropOf(v, owner[v]);
  for (let i = 0; i < extra.length; i++) drop[count + i] = dropOf(extra[i], extraOwner[i]);
  const rise = new Float32Array(count + extra.length);
  const riseOf = (v: number, wall: number) => wall < 0 || wall === triangles || top[wall] - bottom[wall] < FOOT_WALL ? -1 : p[3 * v + 1] - bottom[wall];
  for (let v = 0; v < count; v++) rise[v] = riseOf(v, owner[v]);
  for (let i = 0; i < extra.length; i++) rise[count + i] = riseOf(extra[i], extraOwner[i]);
  return { index: index && extra.length ? corners : undefined, extra: Int32Array.from(extra), drop, rise };
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

type Variants = Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>;
/** Wear one mesh that is not measured hull plating: runoff from the tops of its connected walls, soot below `funnel`, grime at
 * its walls' feet unless `foot` is false, and, given a `waterline`, every vertex's height above it. A geometry shared by several
 * meshes gets its own copy only where their wear differs, as a scaled, raised or funnel-mounted instance. */
function wearWalls(mesh: THREE.Mesh, m: THREE.Matrix4, paint: number, funnel: number | undefined, derived: Variants, foot: boolean, waterline?: number): void {
  const shared = mesh.geometry, count = shared.getAttribute('position').count;
  // Unpainted, or one geometry drawn at many poses: at most the paint mottles.
  const plain = !paint || (mesh as THREE.InstancedMesh).isInstancedMesh;
  const top = plain ? undefined : funnel, tide = plain ? undefined : waterline, height = m.elements[13];
  const key = plain ? `${paint}` : `${paint}|${headingFree(m)}|${top === undefined ? '' : (top - height).toFixed(3)}|${tide === undefined ? '' : (height - tide).toFixed(3)}|${foot}`;
  let variants = derived.get(shared);
  if (!variants) derived.set(shared, variants = new Map());
  const done = variants.get(key);
  if (done) { mesh.geometry = done; return; }
  // The first variant keeps the shared geometry; any other is a copy of it.
  const geometry = variants.size ? shared.clone() : shared;
  const p = plain ? undefined : shipPositions(geometry, m), measured = p && wallDrops(geometry, p), total = measured ? measured.drop.length : count;
  if (measured?.extra.length) {
    for (const [name, attribute] of Object.entries(geometry.attributes)) geometry.setAttribute(name, extended(attribute, measured.extra));
  }
  if (measured?.index) geometry.setIndex(new THREE.BufferAttribute(total > 65535 ? measured.index : Uint16Array.from(measured.index), 1));
  const wear = new Float32Array(total * 4);
  for (let v = 0; v < total; v++) {
    const y = p ? p[3 * (v < count ? v : measured!.extra[v - count]) + 1] : 0;
    wear[4 * v] = paint; wear[4 * v + 1] = measured ? measured.drop[v] : WEAR_NONE;
    wear[4 * v + 2] = top !== undefined ? top - y : foot && measured && measured.rise[v] >= 0 ? FOOT + measured.rise[v] : WEAR_NONE;
    wear[4 * v + 3] = tide === undefined ? WEAR_NONE : y - tide;
  }
  geometry.setAttribute('shipWear', new THREE.BufferAttribute(wear, 4));
  variants.set(key, geometry); mesh.geometry = geometry;
}

/** Every mesh under `root`, and a matrix from a mesh's geometry to the ship frame (`root`'s own), reused between calls. */
function shipMeshes(root: THREE.Object3D) {
  const toShip = new THREE.Matrix4().copy(root.matrixWorld).invert(), matrix = new THREE.Matrix4();
  const meshes: THREE.Mesh[] = [];
  root.traverse(node => { if (node instanceof THREE.Mesh && node.geometry.getAttribute('position')) meshes.push(node); });
  return { meshes, shipMatrix: (mesh: THREE.Mesh) => matrix.multiplyMatrices(toShip, mesh.matrixWorld) };
}

/** Write `shipWear` on every mesh of an assembled construction model (see the module header). */
export function applyConstructionWear(group: THREE.Object3D, source: ConstructionSource, result: ConstructionResult): void {
  const amount = constructionWearAmount(source), waterline = result.loading?.waterlineY ?? 0;
  const { meshes, shipMatrix } = shipMeshes(group), armour = mountArmour(group);
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
  const derived: Variants = new Map();
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
    wearWalls(mesh, m, paint, mesh.userData.constructionEquipmentKind === 'funnel' ? funnels.get(String(mesh.userData.sourceId)) : undefined, derived, !armour(mesh));
  }
}

/** A premade model's node data, as the mesh or its nearest ancestor declares it: a glTF mesh of several primitives loads as a
 * group of meshes, and the group carries its node's extras. */
function inherited(node: THREE.Object3D | null, key: string): unknown {
  for (; node; node = node.parent) if (node.userData[key] !== undefined) return node.userData[key];
  return undefined;
}

/** A premade ship's lofted hull: a Blender recipe's `hull.surface` node, or a construction preset's `hull.<paint>` plating. */
const isPremadeHull = (mesh: THREE.Mesh) => inherited(mesh, 'assemblyId') === 'hull' && String(inherited(mesh, 'nodeId') ?? '').startsWith('hull.');

/** Assemblies of a Blender recipe that make up a funnel (`funnel`, `forward-funnel`, `funnel-jacket`, `funnel-cap`, `after-uptake`…),
 * not the galleries, searchlight platforms, arms and guns named after the funnel they surround. */
const FUNNEL = /(^|-)(funnel|uptake)(-|$)/, NOT_FUNNEL = /gallery|searchlight|bofors|platform|landmark|(^|-)arm(-|$)/;
/** Each funnel mesh's top, in a premade model: a construction preset's funnel installations, else a Blender recipe's funnel
 * assemblies, where those whose plans overlap (a jacket, its base and its cap) stand as one funnel. */
function premadeFunnels(meshes: readonly THREE.Mesh[], shipMatrix: (mesh: THREE.Mesh) => THREE.Matrix4): Map<THREE.Mesh, number> {
  type Stack = { box: THREE.Box3; meshes: THREE.Mesh[] };
  const stacks: Stack[] = [], byKey = new Map<string, Stack>(), point = new THREE.Vector3();
  for (const mesh of meshes) {
    const assembly = String(inherited(mesh, 'assemblyId') ?? ''), installed = inherited(mesh, 'constructionEquipmentKind') === 'funnel';
    if (!installed && !(FUNNEL.test(assembly) && !NOT_FUNNEL.test(assembly))) continue;
    const key = installed ? `installation:${String(inherited(mesh, 'sourceId'))}` : assembly;
    let stack = byKey.get(key);
    if (!stack) { byKey.set(key, stack = { box: new THREE.Box3(), meshes: [] }); stacks.push(stack); }
    const p = shipPositions(mesh.geometry, shipMatrix(mesh));
    for (let i = 0; i < p.length; i += 3) stack.box.expandByPoint(point.set(p[i], p[i + 1], p[i + 2]));
    stack.meshes.push(mesh);
  }
  const overlap = (a: THREE.Box3, b: THREE.Box3) => a.min.x <= b.max.x && b.min.x <= a.max.x && a.min.z <= b.max.z && b.min.z <= a.max.z;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < stacks.length && !merged; i++) for (let j = i + 1; j < stacks.length && !merged; j++) if (overlap(stacks[i].box, stacks[j].box)) {
      stacks[i].box.union(stacks[j].box); stacks[i].meshes.push(...stacks[j].meshes); stacks.splice(j, 1); merged = true;
    }
  }
  return new Map(stacks.flatMap(stack => stack.meshes.map(mesh => [mesh, stack.box.max.y] as const)));
}

/** A premade hull's deck edge along its length: the highest point of its walls in each half metre, taken along their triangles'
 * edges, so the stem, a forecastle break and bulwarks count and the deck's camber does not. */
const SHEER_BIN = .5;
function premadeSheer(hulls: readonly { p: Float64Array; index: THREE.BufferAttribute | null }[]): Sheer | undefined {
  const tops = new Map<number, number>();
  const raise = (bin: number, y: number) => { if (!(y <= (tops.get(bin) ?? -Infinity))) tops.set(bin, y); };
  for (const { p, index } of hulls) {
    const triangles = Math.floor((index ? index.count : p.length / 3) / 3), corner = index ? (k: number) => index.getX(k) : (k: number) => k;
    for (let t = 0; t < triangles; t++) {
      const a = 3 * corner(3 * t), b = 3 * corner(3 * t + 1), c = 3 * corner(3 * t + 2);
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (!(Math.abs(ny) < VERTICAL * Math.hypot(nx, ny, nz))) continue;
      for (const [s, e] of [[a, b], [b, c], [c, a]]) {
        const z0 = p[s + 2], z1 = p[e + 2], y0 = p[s + 1], y1 = p[e + 1];
        raise(Math.floor(z0 / SHEER_BIN), y0); raise(Math.floor(z1 / SHEER_BIN), y1);
        // Where the edge crosses into the next half metre, it tops both.
        for (let k = Math.floor(Math.min(z0, z1) / SHEER_BIN) + 1; k * SHEER_BIN <= Math.max(z0, z1); k++) {
          const y = y0 + (y1 - y0) * (k * SHEER_BIN - z0) / (z1 - z0);
          raise(k - 1, y); raise(k, y);
        }
      }
    }
  }
  if (!tops.size) return undefined;
  const bins = [...tops.keys()].sort((x, y) => x - y);
  return { z: Float64Array.from(bins, bin => (bin + .5) * SHEER_BIN), y: Float64Array.from(bins, bin => tops.get(bin)!) };
}

/** Write `shipWear` on a premade ship's published model (see the module header); `amount` is the wear preset its appearance
 * names. Its hull's sides hang from the deck edge at their station and every other wall from its own top; funnels soot from
 * their top; every painted surface knows its height above the rest waterline, the model's y = 0. No wear writes nothing,
 * so the palette gives the model zeros and it draws as before. */
export function applyPremadeWear(root: THREE.Object3D, amount: number, waterline = 0): void {
  if (!(amount > 0)) return;
  root.updateMatrixWorld(true);
  const { meshes, shipMatrix } = shipMeshes(root), funnels = premadeFunnels(meshes, shipMatrix);
  const armour = mountArmour(root);
  const hulls = new Map(meshes.filter(isPremadeHull).map(mesh => [mesh, shipPositions(mesh.geometry, shipMatrix(mesh))]));
  const sheer = premadeSheer([...hulls].map(([mesh, p]) => ({ p, index: mesh.geometry.index })));
  const derived: Variants = new Map();
  for (const mesh of meshes) {
    const paint = wearsPaint(mesh.material) ? amount : 0, p = hulls.get(mesh);
    if (paint && p && sheer && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
      const wear = new Float32Array(p.length / 3 * 4);
      for (let v = 0; v < p.length / 3; v++) {
        const y = p[3 * v + 1];
        wear[4 * v] = paint; wear[4 * v + 1] = Math.max(0, sheerAt(sheer, p[3 * v + 2]) - y); wear[4 * v + 2] = WEAR_NONE; wear[4 * v + 3] = y - waterline;
      }
      mesh.geometry.setAttribute('shipWear', new THREE.BufferAttribute(wear, 4));
      continue;
    }
    wearWalls(mesh, shipMatrix(mesh), paint, funnels.get(mesh), derived, !armour(mesh), waterline);
  }
}

/** A model's portholes and small windows, for their weeps (portholeWeeps), before the palette repaints it: [x, y, z, radius,
 * normal x, normal z] each, in the ship frame of `root`. A porthole is a pane (glass, a dark tint, or the catalog's glass role)
 * set in a wall: a welded cluster of pane faces 12 cm to 1.2 m tall, about as wide as it is tall and thin along its largest
 * face's normal, which is near level. */
export function modelPortholes(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const { meshes, shipMatrix } = shipMeshes(root), out: number[] = [];
  for (const mesh of meshes) {
    const material = mesh.material;
    if (Array.isArray(material) || (mesh as THREE.InstancedMesh).isInstancedMesh) continue;
    if (!/glass|glazing|dark/i.test(material.name) && material.userData.componentMaterialRole !== 'glass') continue;
    const geometry = mesh.geometry, p = shipPositions(geometry, shipMatrix(mesh)), count = p.length / 3, canon = weld(p), index = geometry.index;
    const triangles = Math.floor((index ? index.count : count) / 3), corner = (k: number) => canon[index ? index.getX(k) : k];
    const parent = Int32Array.from({ length: count }, (_, i) => i);
    const find = (v: number) => { while (parent[v] !== v) v = parent[v] = parent[parent[v]]; return v; };
    for (let t = 0; t < triangles; t++) { const a = find(corner(3 * t)); parent[find(corner(3 * t + 1))] = a; parent[find(corner(3 * t + 2))] = a; }
    type Cluster = { min: number[]; max: number[]; area: number; n: number[]; verts: number[] };
    const clusters = new Map<number, Cluster>();
    for (let t = 0; t < triangles; t++) {
      const a = 3 * corner(3 * t), b = 3 * corner(3 * t + 1), c = 3 * corner(3 * t + 2), root = find(a / 3);
      let cluster = clusters.get(root);
      if (!cluster) clusters.set(root, cluster = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], area: 0, n: [0, 1, 0], verts: [] });
      for (const v of [a, b, c]) { for (let d = 0; d < 3; d++) { cluster.min[d] = Math.min(cluster.min[d], p[v + d]); cluster.max[d] = Math.max(cluster.max[d], p[v + d]); } cluster.verts.push(v); }
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area = Math.hypot(nx, ny, nz);
      if (area > cluster.area) { cluster.area = area; cluster.n = [nx / area, ny / area, nz / area]; }
    }
    for (const cluster of clusters.values()) {
      const tall = cluster.max[1] - cluster.min[1], [nx, ny, nz] = cluster.n, level = Math.hypot(nx, nz);
      if (tall < .12 || tall > 1.2 || Math.abs(ny) > .4 || level < 1e-3) continue;
      const hx = nx / level, hz = nz / level;
      let wideMin = Infinity, wideMax = -Infinity, deepMin = Infinity, deepMax = -Infinity;
      for (const v of cluster.verts) {
        const across = -hz * p[v] + hx * p[v + 2], deep = hx * p[v] + hz * p[v + 2];
        wideMin = Math.min(wideMin, across); wideMax = Math.max(wideMax, across); deepMin = Math.min(deepMin, deep); deepMax = Math.max(deepMax, deep);
      }
      const wide = wideMax - wideMin, deep = deepMax - deepMin;
      if (wide < .6 * tall || wide > 1.6 * tall || deep > .5 * tall) continue;
      out.push((cluster.min[0] + cluster.max[0]) / 2, (cluster.min[1] + cluster.max[1]) / 2, (cluster.min[2] + cluster.max[2]) / 2, tall / 2, hx, hz);
    }
  }
  return out;
}

/** Whether a mesh belongs to a trained mount (its gunhouse under the `<mount>.yaw` joint, or its barbette, the rest of the mount's
 * assembly; any part of a player-built gun), or to a conning tower: armour cast or rolled in a few large plates, not welded
 * strakes. The palette leaves it unplated and its walls carry no foot grime. */
export function mountArmour(root: THREE.Object3D): (mesh: THREE.Object3D) => boolean {
  const mounts = new Set<string>();
  root.traverse(node => { const id = node.userData.nodeId; if (typeof id === 'string' && id.endsWith('.yaw')) mounts.add(id.slice(0, -'.yaw'.length)); });
  return mesh => {
    for (let node: THREE.Object3D | null = mesh; node && node !== root; node = node.parent) {
      const id = node.userData.nodeId;
      if (typeof id === 'string' && id.endsWith('.yaw') || node.userData.constructionEquipmentKind === 'gun') return true;
    }
    const assembly = inherited(mesh, 'assemblyId');
    return typeof assembly === 'string' && (mounts.has(assembly) || /(^|-)conning(-|$)/.test(assembly));
  };
}
