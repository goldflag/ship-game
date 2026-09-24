/** Continuous distance-dependent level of detail (CDLOD, Strugar 2010) over a baked heightfield.
 *
 * The land is a quadtree of square nodes. A node at level l is `nodeSize(0) · 2^l` metres across and is drawn as
 * four patches of `PATCH_QUADS`² quads, so its vertices lie `spacing · 2^l` apart; level 0's vertices are the
 * finest the land gets. Each level owns a band of camera distance, twice as far out as the level below, set so a
 * triangle edge spans about `targetPixels` on screen at the current lens; binoculars shrink every band's pixels
 * and pull full detail out to the ships they look at. The selection walks the tree from the root: a node beyond
 * its level's range is left to its parent; one wholly outside the next finer range draws whole at its level; any
 * other splits, and each child the finer level cannot take draws at this level. Across the outer part of its band
 * (from `MORPH_START` to `MORPH_END` of the range) the vertex shader slides a level's odd vertices onto its even
 * ones, so at the band's edge it matches the coarser level beside it exactly: no seams, no skirts, no pops.
 *
 * Renderer-free: the view hands in the camera and frustum in chart metres and uploads what comes back. */

/** Quads along a patch's side: a node is drawn as 2 × 2 patches. */
export const PATCH_QUADS = 16;
/** Share of a level's range where its vertices start and finish sliding onto the next coarser grid. */
export const MORPH_START = .78, MORPH_END = .97;
/** Heights below this never show through the water above them (the sea's absorption takes the rest). */
export const DEEP_WATER_M = -30;
/** Floats per selected patch in the instance buffer: chart x and z of its corner, its level, and 1 where land rises
 * above the sea in it (0 for sea floor only). */
export const PATCH_FLOATS = 4;

export interface TerrainChart {
  readonly originX: number; readonly originZ: number;
  /** Chart extent along x and z, metres. */
  readonly width: number; readonly depth: number;
  /** Lowest and highest height over blocks of `bounds.base` field cells, per level (see `heightBounds`). */
  readonly bounds: { readonly base: number; readonly levels: readonly { readonly size: number; readonly min: Float32Array; readonly max: Float32Array }[] };
  /** Field cell size, metres. */
  readonly cell: number;
}

export interface LodSettings {
  /** Metres between level-0 vertices; a multiple of the field's cell over 2^k, so they fall on its samples. */
  readonly spacing: number;
  /** On-screen length of a triangle edge the ranges aim for, pixels. */
  readonly targetPixels: number;
}

/** What the selection reads from the camera, in chart metres. */
export interface LodView {
  readonly position: readonly [number, number, number];
  /** Frustum planes as [nx, ny, nz, constant] with the inside where n · p + constant ≥ 0. */
  readonly planes: readonly (readonly [number, number, number, number])[];
  /** Vertical field of view, radians, and viewport height in pixels. */
  readonly fovY: number;
  readonly heightPx: number;
  /** Set when the camera is under the sea: then the deep sea floor near it is drawn too. */
  readonly submerged?: boolean;
}

/** Range of level 0 in metres: where one of its triangle edges shrinks to `targetPixels`. Never so short that a
 * level's band is narrower than two of its nodes, which keeps neighbouring patches within one level. */
export function baseRange(settings: LodSettings, view: Pick<LodView, 'fovY' | 'heightPx'>): number {
  const pixelsPerRadian = view.heightPx / (2 * Math.tan(view.fovY / 2));
  // Level l is used from range(l - 1) out, where its spacing · 2^l spans targetPixels: range(0) = 2 · spacing · k.
  const range = 2 * settings.spacing * pixelsPerRadian / settings.targetPixels;
  return Math.max(range, 8 * nodeSize(settings, 0));
}
export const nodeSize = (settings: Pick<LodSettings, 'spacing'>, level: number) => settings.spacing * PATCH_QUADS * 2 * 2 ** level;

export class TerrainLod {
  /** The root's level: its node covers the whole chart. */
  readonly rootLevel: number;
  /** Ranges of each level for the last selection, metres. */
  readonly ranges: number[] = [];
  private readonly blocksPerPatch: number;
  private out!: Float32Array;
  private count = 0;
  private view!: LodView;
  private capacity = 0;

  constructor(readonly chart: TerrainChart, readonly settings: LodSettings) {
    const extent = Math.max(chart.width, chart.depth);
    this.rootLevel = Math.max(0, Math.ceil(Math.log2(extent / nodeSize(settings, 0))));
    // A patch at level 0 spans this many bound blocks; the bound pyramid's base must divide a patch.
    const patchCells = settings.spacing * PATCH_QUADS / chart.cell;
    this.blocksPerPatch = patchCells / chart.bounds.base;
    if (!Number.isInteger(this.blocksPerPatch) || this.blocksPerPatch < 1) throw new Error('Terrain bounds must tile a level-0 patch.');
  }

  /** Fill `out` with the patches to draw for `view` (`PATCH_FLOATS` each) and return how many there are, up to
   * the buffer's capacity. The level-0 patches with land come first; `nearLand` says how many there are. */
  select(view: LodView, out: Float32Array): number {
    this.view = view; this.out = out; this.count = 0; this.capacity = Math.floor(out.length / PATCH_FLOATS);
    const range0 = baseRange(this.settings, view);
    this.ranges.length = 0;
    for (let level = 0; level <= this.rootLevel; level++) this.ranges.push(range0 * 2 ** level);
    this.node(this.rootLevel, 0, 0);
    // Move the level-0 patches with land to the front, keeping their order.
    let front = 0;
    for (let k = 0; k < this.count; k++) {
      const at = k * PATCH_FLOATS;
      if (out[at + 2] !== 0 || out[at + 3] === 0) continue;
      if (k !== front) for (let f = 0; f < PATCH_FLOATS; f++) { const a = front * PATCH_FLOATS + f, b = at + f; [out[a], out[b]] = [out[b], out[a]]; }
      front++;
    }
    this.nearLand = front;
    this.treeReach = Infinity;
    if (front > this.treePatches) this.nearestFirst(front);
    return this.count;
  }
  /** Level-0 patches with land in the last selection that carry trees: the first entries of its buffer, nearest first
   * when there are more than `treePatches`. */
  nearLand = 0;
  /** Distance in metres from the camera to the nearest level-0 patch with land left without trees; Infinity when every
   * one has them. Trees dissolve before it. */
  treeReach = Infinity;
  /** Most level-0 patches with land that carry trees: about 65,000 cards at 256 a patch. Binoculars stretch level 0 over
   * tens of kilometres, where a tree on every slot would cost more than all the rest of the frame. */
  treePatches = 256;

  /** Order the first `front` patches of the buffer nearest first and keep trees on the nearest `treePatches`. */
  private nearestFirst(front: number): void {
    const out = this.out, [px, py, pz] = this.view.position, half = nodeSize(this.settings, 0) / 4;
    const order = Array.from({ length: front }, (_, k) => k), distance = new Float64Array(front);
    for (let k = 0; k < front; k++) {
      const at = k * PATCH_FLOATS, dx = out[at] + half - px, dz = out[at + 1] + half - pz;
      distance[k] = Math.hypot(dx, dz, py);
    }
    order.sort((a, b) => distance[a] - distance[b]);
    const copy = out.slice(0, front * PATCH_FLOATS);
    order.forEach((from, to) => out.set(copy.subarray(from * PATCH_FLOATS, (from + 1) * PATCH_FLOATS), to * PATCH_FLOATS));
    this.nearLand = this.treePatches;
    this.treeReach = distance[order[this.treePatches]] - half * Math.SQRT2;
  }

  /** Bounds of the square of `size` metres whose corner is (x, z) chart metres from the chart origin, from the
   * bound pyramid level whose blocks are that size. Undefined when it lies wholly off the chart. */
  private box(level: number, ix: number, iz: number, patch: boolean): [number, number] | undefined {
    const { chart } = this;
    // Patch indices count level-0 patches of this level's size; the pyramid level of a patch at `level`.
    const pyramid = Math.log2(this.blocksPerPatch) + level + (patch ? 0 : 1);
    const bounds = chart.bounds.levels[Math.min(pyramid, chart.bounds.levels.length - 1)];
    if (!bounds) return undefined;
    const scale = pyramid >= chart.bounds.levels.length ? 2 ** (pyramid - chart.bounds.levels.length + 1) : 1;
    const bx = ix * scale, bz = iz * scale;
    if (bx >= bounds.size || bz >= bounds.size) return undefined;
    let low = Infinity, high = -Infinity;
    for (let j = bz; j < Math.min(bz + scale, bounds.size); j++) for (let i = bx; i < Math.min(bx + scale, bounds.size); i++) {
      low = Math.min(low, bounds.min[j * bounds.size + i]); high = Math.max(high, bounds.max[j * bounds.size + i]);
    }
    return [low, high];
  }

  /** Squared distance from the camera to the box, and whether any of it is inside the frustum. */
  private distance2(x0: number, z0: number, size: number, low: number, high: number): number {
    const [px, py, pz] = this.view.position;
    const dx = px < x0 ? x0 - px : px > x0 + size ? px - x0 - size : 0;
    const dy = py < low ? low - py : py > high ? py - high : 0;
    const dz = pz < z0 ? z0 - pz : pz > z0 + size ? pz - z0 - size : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  private visible(x0: number, z0: number, size: number, low: number, high: number): boolean {
    for (const [nx, ny, nz, constant] of this.view.planes) {
      // The box corner furthest along the plane normal.
      const x = nx > 0 ? x0 + size : x0, y = ny > 0 ? high : low, z = nz > 0 ? z0 + size : z0;
      if (nx * x + ny * y + nz * z + constant < 0) return false;
    }
    return true;
  }

  /** Select the node at `level` whose index along x and z is (ix, iz). False when it lies beyond its level's range
   * (the parent then draws its area). */
  private node(level: number, ix: number, iz: number): boolean {
    const size = nodeSize(this.settings, level), x0 = this.chart.originX + ix * size, z0 = this.chart.originZ + iz * size;
    if (x0 >= this.chart.originX + this.chart.width || z0 >= this.chart.originZ + this.chart.depth) return true;
    const bounds = this.box(level, ix, iz, false);
    if (!bounds) return true;
    const [low, high] = bounds, range = this.ranges[level];
    if (this.distance2(x0, z0, size, low, high) > range * range) return false;
    if (!this.visible(x0, z0, size, low, high)) return true;
    if (level === 0 || this.distance2(x0, z0, size, low, high) > this.ranges[level - 1] ** 2) {
      for (let q = 0; q < 4; q++) this.patch(level, ix * 2 + (q & 1), iz * 2 + (q >> 1));
      return true;
    }
    for (let q = 0; q < 4; q++) {
      const cx = ix * 2 + (q & 1), cz = iz * 2 + (q >> 1);
      if (!this.node(level - 1, cx, cz)) this.patch(level, cx, cz);
    }
    return true;
  }

  /** Emit the patch (a quarter of a node at `level`) with index (px, pz) at that level's patch size, unless it is
   * off the chart, outside the frustum or wholly under water too deep to see. */
  private patch(level: number, px: number, pz: number): void {
    const size = nodeSize(this.settings, level) / 2, x0 = this.chart.originX + px * size, z0 = this.chart.originZ + pz * size;
    if (x0 >= this.chart.originX + this.chart.width || z0 >= this.chart.originZ + this.chart.depth) return;
    const bounds = this.box(level, px, pz, true);
    if (!bounds) return;
    const [low, high] = bounds;
    if (high < DEEP_WATER_M && !(this.view.submerged && this.distance2(x0, z0, size, low, high) < 4000 ** 2)) return;
    if (!this.visible(x0, z0, size, low, high) || this.count >= this.capacity) return;
    const at = this.count++ * PATCH_FLOATS;
    this.out[at] = x0; this.out[at + 1] = z0; this.out[at + 2] = level; this.out[at + 3] = high > 0 ? 1 : 0;
  }
}
