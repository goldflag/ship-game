import * as THREE from 'three/webgpu';
import { Break, If, Loop, abs, dot, exp, float, max, mix, smoothstep, storage, uint, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Rust weeps below portholes, drawn by the ship paint (ShipSurfaceDetail) from the portholes each hull template finds when it
 * loads (`findPortholes`). Portholes sit on walls of any ship-frame plan position, and the plating below them is often one
 * triangle a hundred metres long, so a porthole cannot be carried per vertex. Each template instead gets a sparse table of the
 * 25 cm plan cells near its weeping portholes, in storage buffers every ship shares (the paint has no sampler to spare), and
 * each draw finds its ship's table and ship frame through per-object uniforms. Lengths in metres. */
export const WEEP = {
  /** Plan cell of the lookup table, and how far beyond a porthole's rim across its wall, and off its wall's plane either way,
   * its cells reach: a flared or tumblehome side leaves the wall below a porthole off the porthole's own plane. */
  cell: .25, across: .12, off: .45,
  /** Share of portholes that weep, the range of their weep's length and of its strength. */
  share: .7, length: [.7, 2.6], strength: [.55, 1],
  /** Portholes closer than this are one porthole (a pane in its rim, say). */
  merge: .12,
  /** The weep leaves the rim as wide as half the porthole, narrows to its trace over its first 35 cm and fades over the
   * last 55 % of its length. */
  start: .5, trace: .035, narrow: .35, fade: .45,
  /** Linear probes a lookup takes at most; a table grows until every entry lies within them. */
  probes: 16,
  /** Capacity of the shared buffers: table slots, portholes and tables (one a hull template). A Bismarck takes 16 384 slots and
   * 290 portholes. */
  slots: 1 << 18, portholes: 1 << 14, tables: 256,
} as const;

/** Plan cells in the table's key: 1024 across (±128 m) by 4096 along (±512 m); key 0 is an empty slot. */
const CELLS_X = 1024, CELLS_Z = 4096;
const cellKey = (x: number, z: number): number => {
  const ix = Math.floor(x / WEEP.cell) + CELLS_X / 2, iz = Math.floor(z / WEEP.cell) + CELLS_Z / 2;
  return ix < 0 || ix >= CELLS_X || iz < 0 || iz >= CELLS_Z ? 0 : iz * CELLS_X + ix + 1;
};
/** A 32-bit integer mix (lowbias32), the same here and in the shader. */
export function hashKey(key: number): number {
  let k = key >>> 0;
  k ^= k >>> 16; k = Math.imul(k, 0x7feb352d); k ^= k >>> 15; k = Math.imul(k, 0x846ca68b); k ^= k >>> 16;
  return k >>> 0;
}
const unit = (a: number, b: number, c: number, salt: number) => hashKey(hashKey(hashKey(Math.round(a * 1000) ^ salt) ^ Math.round(b * 1000)) ^ Math.round(c * 1000)) / 4294967296;

/** One template's table: `keys` and `entries` (a porthole index from 1) over `keys.length` slots, a power of two, and its
 * weeping portholes as two vec4 each: centre and radius, then level normal x and z, weep length and strength. */
export interface PortholeTable { keys: Uint32Array; entries: Uint32Array; portholes: Float32Array }

/** The table for `findPortholes` output ([x, y, z, radius, normal x, normal z] each), or none where no porthole weeps. Which
 * portholes weep, and how, follows from their positions, so a model draws the same weeps every time it loads. */
export function portholeTable(list: readonly number[]): PortholeTable | undefined {
  const kept: number[][] = [];
  for (let i = 0; i + 5 < list.length; i += 6) {
    const [x, y, z] = list.slice(i, i + 3);
    if (!kept.some(k => Math.hypot(k[0] - x, k[1] - y, k[2] - z) < WEEP.merge)) kept.push(list.slice(i, i + 6));
  }
  const weeping = kept.filter(([x, y, z]) => unit(x, y, z, 1) < WEEP.share);
  if (!weeping.length) return undefined;
  const portholes = new Float32Array(weeping.length * 8), cells: number[] = [];
  weeping.forEach(([x, y, z, r, nx, nz], i) => {
    const length = WEEP.length[0] + (WEEP.length[1] - WEEP.length[0]) * unit(x, y, z, 2);
    const strength = WEEP.strength[0] + (WEEP.strength[1] - WEEP.strength[0]) * unit(x, y, z, 3);
    portholes.set([x, y, z, r, nx, nz, length, strength], i * 8);
    const keys = new Set<number>(), reach = r + WEEP.across, step = WEEP.cell / 2;
    for (let s = -reach; s <= reach + 1e-6; s += step) for (let m = -WEEP.off; m <= WEEP.off + 1e-6; m += step) {
      const key = cellKey(x - nz * s + nx * m, z + nx * s + nz * m);
      if (key) keys.add(key);
    }
    for (const key of keys) cells.push(key, i + 1);
  });
  for (let size = Math.max(64, 1 << Math.ceil(Math.log2(cells.length))); ; size *= 2) {
    const keys = new Uint32Array(size), entries = new Uint32Array(size), mask = size - 1;
    let fits = true;
    for (let c = 0; c < cells.length && fits; c += 2) {
      let slot = hashKey(cells[c]) & mask, probe = 0;
      while (keys[slot] && probe < WEEP.probes) { slot = (slot + 1) & mask; probe++; }
      if (probe === WEEP.probes) fits = false;
      else { keys[slot] = cells[c]; entries[slot] = cells[c + 1]; }
    }
    if (fits) return { keys, entries, portholes };
  }
}

/** The shared buffers: table slots (key, porthole index from 1), portholes, and per table its first slot and slot mask. */
const slotBuffer = new THREE.StorageBufferAttribute(new Uint32Array(WEEP.slots * 2), 2);
const portholeBuffer = new THREE.StorageBufferAttribute(new Float32Array(WEEP.portholes * 8), 4);
const tableBuffer = new THREE.StorageBufferAttribute(new Uint32Array(WEEP.tables * 2), 2);
const slotNode = storage(slotBuffer, 'uvec2', WEEP.slots).toReadOnly();
const portholeNode = storage(portholeBuffer, 'vec4', WEEP.portholes * 2).toReadOnly();
const tableNode = storage(tableBuffer, 'uvec2', WEEP.tables).toReadOnly();

type Span = { start: number; size: number };
/** First-fit ranges of a buffer, merged as they are freed. */
class Ranges {
  private free: Span[];
  constructor(start: number, size: number) { this.free = [{ start, size }]; }
  take(size: number): number | undefined {
    const i = this.free.findIndex(span => span.size >= size);
    if (i < 0) return undefined;
    const span = this.free[i], start = span.start;
    if (span.size === size) this.free.splice(i, 1); else { span.start += size; span.size -= size; }
    return start;
  }
  give(start: number, size: number): void {
    this.free.push({ start, size });
    this.free.sort((a, b) => a.start - b.start);
    this.free = this.free.reduce<Span[]>((out, span) => {
      const last = out.at(-1);
      if (last && last.start + last.size === span.start) last.size += span.size; else out.push({ ...span });
      return out;
    }, []);
  }
}
// Table 0 stands for none.
const slotRanges = new Ranges(0, WEEP.slots), portholeRanges = new Ranges(0, WEEP.portholes), tableIds = new Ranges(1, WEEP.tables - 1);
type Registered = { table: number; slots: number; size: number; first: number; count: number };
const registered = new WeakMap<THREE.Object3D, Registered>();

/** A joint's node: a surface under one moves with it, out of the ship frame its geometry was measured in. */
const JOINT = /\.(yaw|elevation|recoil|muzzle|spin|cloth)$/;
/** The paint that weeps: the wear amount (0 … 1, `shipWear.x`) of every surface of `model` that does not move, with its table
 * number added twice over (`wornAmount` and `weepTable` read them back). */
function markTable(model: THREE.Object3D, table: number): void {
  const marked = new Set<THREE.BufferGeometry>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh) || marked.has(node.geometry) || (node as THREE.InstancedMesh).isInstancedMesh) return;
    for (let o: THREE.Object3D | null = node; o && o !== model; o = o.parent) if (typeof o.userData.nodeId === 'string' && JOINT.test(o.userData.nodeId)) return;
    const wear = node.geometry.getAttribute('shipWear');
    if (!wear) return;
    marked.add(node.geometry);
    for (let v = 0; v < wear.count; v++) { const x = wear.getX(v); if (x > 0) wear.setX(v, x - 2 * Math.floor(x / 2) + 2 * table); }
    wear.needsUpdate = true;
  });
}

/** Give a hull template's weeping portholes a table in the shared buffers, and mark its paint with the table's number; its ships
 * at sea are clones that share its geometry. Call it after the wear is measured and before the palette repaints the model. A
 * fleet too large for the buffers draws the rest of its ships without weeps. */
export function registerPortholes(model: THREE.Object3D, list: readonly number[]): void {
  releasePortholes(model);
  const table = portholeTable(list);
  if (!table) return;
  const size = table.keys.length, count = table.portholes.length / 8;
  const id = tableIds.take(1), slots = slotRanges.take(size), first = portholeRanges.take(count);
  if (id === undefined || slots === undefined || first === undefined) {
    if (id !== undefined) tableIds.give(id, 1);
    if (slots !== undefined) slotRanges.give(slots, size);
    if (first !== undefined) portholeRanges.give(first, count);
    console.warn(`Porthole weeps: no room for ${model.name || 'a ship'}'s ${count} portholes.`);
    return;
  }
  const keys = slotBuffer.array as Uint32Array, holes = portholeBuffer.array as Float32Array, tables = tableBuffer.array as Uint32Array;
  for (let i = 0; i < size; i++) { keys[2 * (slots + i)] = table.keys[i]; keys[2 * (slots + i) + 1] = table.entries[i] && table.entries[i] + first; }
  holes.set(table.portholes, first * 8);
  tables[2 * id] = slots; tables[2 * id + 1] = size - 1;
  slotBuffer.needsUpdate = true; portholeBuffer.needsUpdate = true; tableBuffer.needsUpdate = true;
  registered.set(model, { table: id, slots, size, first, count });
  model.userData.portholeWeeps = id;
  markTable(model, id);
}

/** Free a template's table once its ships are gone. */
export function releasePortholes(model: THREE.Object3D): void {
  const entry = registered.get(model);
  if (!entry) return;
  (slotBuffer.array as Uint32Array).fill(0, 2 * entry.slots, 2 * (entry.slots + entry.size));
  (tableBuffer.array as Uint32Array).fill(0, 2 * entry.table, 2 * entry.table + 2);
  slotBuffer.needsUpdate = true; tableBuffer.needsUpdate = true;
  slotRanges.give(entry.slots, entry.size); portholeRanges.give(entry.first, entry.count); tableIds.give(entry.table, 1);
  registered.delete(model); delete model.userData.portholeWeeps;
}

/** The wear amount and the porthole table number packed in `shipWear.x`. */
export const wornAmount = (x: Node<'float'>): Node<'float'> => x.sub(x.div(2).floor().mul(2));
const weepTable = (x: Node<'float'>): Node<'float'> => x.div(2).floor();

/** The ship a drawn object belongs to: its nearest ancestor with a porthole table, if any. */
const ships = new WeakMap<THREE.Object3D, THREE.Object3D | null>();
function shipOf(object: THREE.Object3D): THREE.Object3D | null {
  let ship = ships.get(object);
  if (ship === undefined) {
    ship = null;
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o.userData.portholeWeeps) { ship = o; break; }
    ships.set(object, ship);
  }
  return ship;
}
const inverse = new THREE.Matrix4();
/** Per draw: a surface drawn on its own (under its ship) from its geometry frame to its ship's frame. A fleet draw (FleetShipDraws)
 * holds its ships' still surfaces in each ship's own frame already, so it takes none. */
const shipFrame = uniform(new THREE.Matrix4()).onObjectUpdate(frame => {
  const matrix = shipFrame.value as THREE.Matrix4, object = frame.object, ship = object && shipOf(object);
  return ship ? matrix.copy(inverse.copy(ship.matrixWorld).invert()).multiply(object.matrixWorld) : matrix.identity();
});

const mixKey = (key: Node<'uint'>): Node<'uint'> => {
  const a = key.bitXor(key.shiftRight(uint(16))).mul(uint(0x7feb352d));
  const b = a.bitXor(a.shiftRight(uint(15))).mul(uint(0x846ca68b));
  return b.bitXor(b.shiftRight(uint(16)));
};

/** Raise `weep`, a shader variable, to how strongly a point of a wall lies in a porthole's weep (0 … 1): at `position` in its
 * mesh's geometry frame, of paint whose `shipWear.x` is `worn`. Call it only for walls: it walks the ship's table. */
export function portholeWeep(position: Node<'vec3'>, worn: Node<'float'>, weep: Node<'float'>): void {
  const id = weepTable(worn);
  If(id.greaterThan(.5), () => {
    const table = tableNode.element(id.toUint()).toVar();
    const p = shipFrame.mul(vec4(position, 1)).xyz.toVar();
    const ix = p.x.div(WEEP.cell).floor().add(CELLS_X / 2), iz = p.z.div(WEEP.cell).floor().add(CELLS_Z / 2);
    If(ix.greaterThanEqual(0).and(ix.lessThan(CELLS_X)).and(iz.greaterThanEqual(0)).and(iz.lessThan(CELLS_Z)), () => {
      const key = iz.mul(CELLS_X).add(ix).add(1).toUint().toVar(), mask = table.y, first = table.x;
      const slot = mixKey(key).bitAnd(mask).toVar();
      Loop(WEEP.probes, () => {
        const entry = slotNode.element(first.add(slot)).toVar();
        If(entry.x.equal(uint(0)), () => { Break(); });
        If(entry.x.equal(key), () => {
          const index = entry.y.sub(uint(1)).mul(uint(2));
          const a = portholeNode.element(index).toVar(), b = portholeNode.element(index.add(uint(1))).toVar();
          const offset = p.sub(a.xyz), below = a.y.sub(a.w.mul(.8)).sub(p.y).toVar();
          If(abs(dot(offset, vec3(b.x, 0, b.y))).lessThan(WEEP.off + .05).and(below.greaterThan(0)).and(below.lessThan(b.z)), () => {
            // Across the wall, wandering a few millimetres as it runs.
            const across = dot(offset, vec3(b.y.negate(), 0, b.x)).add(below.mul(7).add(b.w.mul(40)).sin().mul(.006));
            const width = mix(a.w.mul(WEEP.start), float(WEEP.trace), smoothstep(0, WEEP.narrow, below)), c = across.div(width), halo = c.div(2.5);
            const trace = exp(c.mul(c).negate()).add(exp(halo.mul(halo).negate()).mul(.3)).min(1);
            weep.assign(max(weep, trace.mul(float(1).sub(smoothstep(b.z.mul(WEEP.fade), b.z, below))).mul(b.w)));
          });
        });
        slot.assign(slot.add(uint(1)).bitAnd(mask));
      });
    });
  });
}
