/** Real-world battle terrain: one baked heightfield per map, shared with the simulation.
 *
 * `scripts/maps/bake-terrain.py` writes `public/maps/terrain/<map>.ntf`; the Rust battle
 * decodes the same bytes in `crates/naval-sim/src/terrain.rs`. Heights, the coast and
 * deployment clearance use the same expressions in the same order on both sides, so the
 * drawn land is the land ships ground on and shells strike. The file layout is documented
 * there and in assets/maps/terrain-notes.md. */
import { assetUrl } from '../assetUrl';

/** Height of the open sea floor beyond a chart, and of a chart's falloff band. */
export const OPEN_SEA_M = -60;
const HEADER_BYTES = 36;
const MAX_SAMPLES = 4097;

export class Heightfield {
  constructor(
    readonly columns: number, readonly rows: number, readonly cell: number,
    readonly originX: number, readonly originZ: number, readonly step: number,
    readonly quanta: Int16Array,
  ) {
    if (quanta.length !== columns * rows) throw new Error('Invalid terrain: one quantum per sample.');
  }
  /** The stored height of sample (i, j), metres. */
  sample(i: number, j: number): number { return this.quanta[j * this.columns + i] * this.step; }
  sampleIsLand(i: number, j: number): boolean { return this.quanta[j * this.columns + i] > 0; }
  /** Chart extent, metres: [min x, min z, max x, max z]. */
  bounds(): [number, number, number, number] {
    return [this.originX, this.originZ, this.originX + (this.columns - 1) * this.cell, this.originZ + (this.rows - 1) * this.cell];
  }
  /** Bilinear height at chart metres; `OPEN_SEA_M` beyond the grid. Mirrors `Heightfield::height`. */
  height(x: number, z: number): number {
    const gx = (x - this.originX) / this.cell, gz = (z - this.originZ) / this.cell;
    if (!(gx >= 0 && gz >= 0) || gx > this.columns - 1 || gz > this.rows - 1) return OPEN_SEA_M;
    const i = Math.min(Math.floor(gx), this.columns - 2), j = Math.min(Math.floor(gz), this.rows - 2);
    const u = gx - i, v = gz - j, at = j * this.columns + i, q = this.quanta;
    const top = q[at] * (1 - u) + q[at + 1] * u;
    const bottom = q[at + this.columns] * (1 - u) + q[at + this.columns + 1] * u;
    return (top * (1 - v) + bottom * v) * this.step;
  }
  /** Whether any land sample lies within `radius` metres of chart point (x, z). Mirrors `Heightfield::land_within`. */
  landWithin(x: number, z: number, radius: number): boolean {
    if (![x, z, radius].every(Number.isFinite)) return false;
    const span = (centre: number, origin: number, count: number): [number, number] => {
      const low = Math.max(Math.floor((centre - radius - origin) / this.cell), 0);
      const high = Math.min(Math.ceil((centre + radius - origin) / this.cell), count - 1);
      return high < low ? [0, -1] : [low, high];
    };
    const [i0, i1] = span(x, this.originX, this.columns), [j0, j1] = span(z, this.originZ, this.rows);
    for (let j = j0; j <= j1; j++) {
      const dz = this.originZ + j * this.cell - z;
      for (let i = i0; i <= i1; i++) {
        const dx = this.originX + i * this.cell - x;
        if (dx * dx + dz * dz <= radius * radius && this.sampleIsLand(i, j)) return true;
      }
    }
    return false;
  }
}

/** Decode an NTF1 file: header, then planar-predicted i16 residuals in a zlib stream. */
export async function decodeHeightfield(bytes: Uint8Array): Promise<Heightfield> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < HEADER_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== 'NTF1') throw new Error('Invalid terrain: not an NTF1 heightfield.');
  const columns = view.getUint32(4, true), rows = view.getUint32(8, true);
  const [cell, originX, originZ, step] = [12, 16, 20, 24].map(at => view.getFloat32(at, true));
  const flags = view.getUint32(28, true), payload = view.getUint32(32, true);
  if (columns < 2 || rows < 2 || columns > MAX_SAMPLES || rows > MAX_SAMPLES) throw new Error('Invalid terrain: grid size outside 2..4097 samples.');
  if (![cell, originX, originZ, step].every(Number.isFinite) || cell <= 0 || step <= 0 || flags !== 0) throw new Error('Invalid terrain: bad cell size, origin, height step or flags.');
  if (bytes.byteLength !== HEADER_BYTES + payload) throw new Error('Invalid terrain: payload length does not match the file.');
  const stream = new Blob([bytes.slice(HEADER_BYTES)]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (raw.byteLength !== columns * rows * 2) throw new Error('Invalid terrain: payload does not hold one residual per sample.');
  const residuals = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), quanta = new Int16Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const at = j * columns + i;
    const left = i > 0 ? quanta[at - 1] : 0, up = j > 0 ? quanta[at - columns] : 0, upLeft = i > 0 && j > 0 ? quanta[at - columns - 1] : 0;
    const value = residuals.getInt16(at * 2, true) + left + up - upLeft;
    if (value < -32768 || value > 32767) throw new Error('Invalid terrain: height outside 16 bits.');
    quanta[at] = value;
  }
  return new Heightfield(columns, rows, cell, originX, originZ, step, quanta);
}

/** A map's heightfield placed in one battle's world frame: world = chart + offset. Custom and
 * online battles centre the chart between the default spawn lines, `[0, -spawnDistance / 2]`;
 * missions centre it on the mission area, `[0, 0]`. No field means open sea. */
export interface PlacedTerrain { readonly field?: Heightfield; readonly offset: readonly [number, number]; }
export const OPEN_SEA: PlacedTerrain = { offset: [0, 0] };
export const terrainHeight = (terrain: PlacedTerrain | undefined, x: number, z: number) =>
  terrain?.field ? terrain.field.height(x - terrain.offset[0], z - terrain.offset[1]) : OPEN_SEA_M;
export const terrainLandWithin = (terrain: PlacedTerrain | undefined, x: number, z: number, radius: number) =>
  !!terrain?.field && terrain.field.landWithin(x - terrain.offset[0], z - terrain.offset[1], radius);

export const terrainUrl = (terrainId: string) => assetUrl(`maps/terrain/${terrainId}.ntf`);
const pending = new Map<string, Promise<Heightfield>>();
const settled = new Map<string, Heightfield>();
/** Fetch and decode a baked terrain once per page. */
export function loadHeightfield(terrainId: string): Promise<Heightfield> {
  let field = pending.get(terrainId);
  if (!field) {
    field = fetch(terrainUrl(terrainId)).then(async response => {
      if (!response.ok) throw new Error(`Unable to load the ${terrainId} terrain.`);
      const decoded = await decodeHeightfield(new Uint8Array(await response.arrayBuffer()));
      settled.set(terrainId, decoded);
      return decoded;
    });
    field.catch(() => pending.delete(terrainId));
    pending.set(terrainId, field);
  }
  return field;
}
/** The decoded field once `loadHeightfield` has settled; charts and validation read it synchronously. */
export const cachedHeightfield = (terrainId: string): Heightfield | undefined => settled.get(terrainId);
/** Test and tool seam: install a decoded field without fetching it. */
export function setHeightfield(terrainId: string, field: Heightfield): void {
  settled.set(terrainId, field);
  pending.set(terrainId, Promise.resolve(field));
}
