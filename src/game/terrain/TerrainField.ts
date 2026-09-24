/** CPU preparation of a baked heightfield for drawing: the arrays the terrain textures upload, the
 * height bounds the level-of-detail tree culls with, and the sun's visibility over the land.
 *
 * Everything here is renderer-free and deterministic, so it can be tested without a GPU and moved to a
 * worker unchanged. Arrays are row-major over the field's samples (x along a row, z down the rows),
 * matching `Heightfield.quanta`. */
import type { Heightfield } from '../../maps/heightfield';

/** A regular grid of samples: the field's own, or a coarser one taken from it. */
export interface Grid { readonly columns: number; readonly rows: number; readonly cell: number }

/** Reach of the signed coast distance stored in the attributes, metres. It is stored as the signed square root of its
 * share of this reach, so a byte resolves a metre at the shore and 50 m a kilometre inland (`coastDistanceOf`). */
export const COAST_RANGE_M = 8000;
/** The byte value (0–1) that stores a signed coast distance in metres. */
export const coastByte = (metres: number) => .5 + .5 * Math.sign(metres) * Math.sqrt(Math.min(Math.abs(metres), COAST_RANGE_M) / COAST_RANGE_M);
/** Metres of relative height per unit of the stored topographic positions. */
export const RELIEF_RANGE_M = { broad: 120, fine: 24 } as const;

/** Heights in metres, one float per sample: exactly `quantum × step`, the values `Heightfield.height` interpolates. */
export function sampleHeights(field: Heightfield): Float32Array {
  const heights = new Float32Array(field.quanta.length), step = field.step, quanta = field.quanta;
  for (let i = 0; i < heights.length; i++) heights[i] = quanta[i] * step;
  return heights;
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** IEEE half float bits of `value`, rounded to nearest (no NaN handling: terrain data is finite). */
export function halfBits(value: number): number {
  f32[0] = value;
  const bits = u32[0], sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 0xff) - 112;
  let mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  // A carry out of the mantissa rounds into the exponent, which is the correct next half.
  return sign | ((exponent << 10) + ((mantissa + 0x1000) >>> 13));
}

/** The surface gradient (∂h/∂x, ∂h/∂z) at every sample by central differences, as half floats in pairs: smooth
 * normals over the bilinear surface, whose own normals jump at every cell edge. One-sided at the border. */
export function gradientHalves(field: Heightfield, heights: Float32Array): Uint16Array {
  const { columns: w, rows: h, cell } = field, out = new Uint16Array(w * h * 2);
  for (let j = 0; j < h; j++) {
    const up = (j > 0 ? j - 1 : j) * w, down = (j < h - 1 ? j + 1 : j) * w, spanZ = ((j < h - 1 ? j + 1 : j) - (j > 0 ? j - 1 : j)) * cell;
    for (let i = 0; i < w; i++) {
      const left = i > 0 ? i - 1 : i, right = i < w - 1 ? i + 1 : i, row = j * w;
      out[(row + i) * 2] = halfBits((heights[row + right] - heights[row + left]) / ((right - left) * cell));
      out[(row + i) * 2 + 1] = halfBits((heights[down + i] - heights[up + i]) / spanZ);
    }
  }
  return out;
}

/** Mean over the part of a (2r + 1)² window that lies inside the grid: two separable passes of prefix sums. */
export function boxMean(values: Float32Array, columns: number, rows: number, radius: number): Float32Array {
  const across = new Float32Array(values.length), out = new Float32Array(values.length);
  const prefix = new Float64Array(Math.max(columns, rows) + 1);
  for (let j = 0; j < rows; j++) {
    const row = j * columns;
    for (let i = 0; i < columns; i++) prefix[i + 1] = prefix[i] + values[row + i];
    for (let i = 0; i < columns; i++) {
      const low = i > radius ? i - radius : 0, high = i + radius < columns ? i + radius + 1 : columns;
      across[row + i] = (prefix[high] - prefix[low]) / (high - low);
    }
  }
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) prefix[j + 1] = prefix[j] + across[j * columns + i];
    for (let j = 0; j < rows; j++) {
      const low = j > radius ? j - radius : 0, high = j + radius < rows ? j + radius + 1 : rows;
      out[j * columns + i] = (prefix[high] - prefix[low]) / (high - low);
    }
  }
  return out;
}

/** Every `factor`-th sample of the field's heights (the samples at multiples of `factor` along both axes),
 * for attributes that vary over hundreds of metres. */
export function coarseGrid(field: Heightfield, heights: Float32Array, factor: number): { columns: number; rows: number; cell: number; heights: Float32Array } {
  const columns = Math.floor((field.columns - 1) / factor) + 1, rows = Math.floor((field.rows - 1) / factor) + 1;
  const out = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) out[j * columns + i] = heights[j * factor * field.columns + i * factor];
  return { columns, rows, cell: field.cell * factor, heights: out };
}

/** Signed distance in metres to the coastline: positive on land (height > 0), negative at sea, from a two-pass
 * chamfer transform with diagonal steps of √2 cells (within 8% of the Euclidean distance), capped at `cap`. */
export function coastDistance(grid: Grid, heights: Float32Array, cap = COAST_RANGE_M): Float32Array {
  const { columns: w, rows: h, cell } = grid, n = w * h, diagonal = cell * Math.SQRT2;
  const toSea = new Float32Array(n), toLand = new Float32Array(n);
  for (let i = 0; i < n; i++) { const land = heights[i] > 0; toSea[i] = land ? cap : 0; toLand[i] = land ? 0 : cap; }
  chamfer(toSea, w, h, cell, diagonal);
  chamfer(toLand, w, h, cell, diagonal);
  // The coastline lies half a cell from the samples either side of it.
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = heights[i] > 0 ? toSea[i] - cell / 2 : -(toLand[i] - cell / 2);
  return out;
}

/** Two passes of a 3 × 3 chamfer distance transform, in place: each sample takes the least of its own distance and
 * its neighbours' plus the step to them, first from the top left, then from the bottom right. */
function chamfer(d: Float32Array, w: number, h: number, cell: number, diagonal: number): void {
  for (let j = 0; j < h; j++) {
    const row = j * w;
    for (let i = 0; i < w; i++) {
      const at = row + i;
      let best = d[at], next: number;
      if (i > 0 && (next = d[at - 1] + cell) < best) best = next;
      if (j > 0) {
        if ((next = d[at - w] + cell) < best) best = next;
        if (i > 0 && (next = d[at - w - 1] + diagonal) < best) best = next;
        if (i < w - 1 && (next = d[at - w + 1] + diagonal) < best) best = next;
      }
      d[at] = best;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    const row = j * w;
    for (let i = w - 1; i >= 0; i--) {
      const at = row + i;
      let best = d[at], next: number;
      if (i < w - 1 && (next = d[at + 1] + cell) < best) best = next;
      if (j < h - 1) {
        if ((next = d[at + w] + cell) < best) best = next;
        if (i < w - 1 && (next = d[at + w + 1] + diagonal) < best) best = next;
        if (i > 0 && (next = d[at + w - 1] + diagonal) < best) best = next;
      }
      d[at] = best;
    }
  }
}

const byte = (value: number) => (value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255));

/** Area draining through each sample, in samples (itself included), by D8 flow routing: every land sample passes all
 * it has gathered to its steepest downhill neighbour, highest samples first (a counting sort on 0.25 m buckets).
 * Streams, gullies and valley floors gather thousands; ridges and spurs one. Sea samples gather but pass nothing. */
export function flowAccumulation(grid: Grid, heights: Float32Array): Float32Array {
  const { columns: w, rows: h } = grid, n = w * h;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < n; i++) { if (heights[i] < low) low = heights[i]; if (heights[i] > high) high = heights[i]; }
  const buckets = Math.max(1, Math.ceil((high - low) * 4) + 1), counts = new Uint32Array(buckets + 1);
  const bucket = (value: number) => Math.min(buckets - 1, Math.floor((value - low) * 4));
  for (let i = 0; i < n; i++) counts[buckets - bucket(heights[i])]++;
  for (let b = 1; b <= buckets; b++) counts[b] += counts[b - 1];
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[counts[buckets - 1 - bucket(heights[i])]++] = i;
  const area = new Float32Array(n).fill(1), diagonal = Math.SQRT1_2;
  for (let k = 0; k < n; k++) {
    const at = order[k], here = heights[at];
    if (here <= 0) continue;
    const i = at % w, j = (at - i) / w;
    let best = -1, drop = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      if ((di === 0 && dj === 0) || x < 0 || y < 0 || x >= w || y >= h) continue;
      const to = y * w + x, fall = (here - heights[to]) * (di !== 0 && dj !== 0 ? diagonal : 1);
      if (fall > drop) { drop = fall; best = to; }
    }
    if (best >= 0) area[best] += area[at];
  }
  return area;
}

/** Half-widths in metres of the windows the topographic positions average over. */
export const ATTRIBUTE_WINDOWS_M = { fine: 240, broad: 960 } as const;
/** Drainage area stored as log2(samples) over this many octaves: 1 at 65,536 samples of the attribute grid. */
export const FLOW_OCTAVES = 16;

/** Per-sample surface attributes, four bytes each:
 * - R: drainage, log2 of the samples draining through this one (`flowAccumulation`) over `FLOW_OCTAVES`: 0 on
 *   ridges, about 0.4 where streams begin, toward 1 on the floors of big valleys. Wet ground, gully forest, snow
 *   lying in gullies.
 * - G: broad topographic position, the height above the mean within 960 m, ±`RELIEF_RANGE_M.broad` about 0.5:
 *   ridges and spurs above, valleys and basins below.
 * - B: signed coast distance (land positive), stored by `coastByte`.
 * - A: fine topographic position, the height above the mean within 240 m, ±`RELIEF_RANGE_M.fine` about 0.5: crests
 *   and gullies within a slope. */
export function surfaceAttributes(grid: Grid, heights: Float32Array): Uint8Array {
  const { columns: w, rows: h, cell } = grid, n = w * h, cells = (metres: number) => Math.max(1, Math.round(metres / cell));
  const fine = boxMean(heights, w, h, cells(ATTRIBUTE_WINDOWS_M.fine)), broad = boxMean(heights, w, h, cells(ATTRIBUTE_WINDOWS_M.broad));
  const coast = coastDistance(grid, heights), flow = flowAccumulation(grid, heights);
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const height = heights[i];
    out[i * 4] = byte(Math.log2(flow[i]) / FLOW_OCTAVES);
    out[i * 4 + 1] = byte(.5 + (height - broad[i]) / (2 * RELIEF_RANGE_M.broad));
    out[i * 4 + 2] = byte(coastByte(coast[i]));
    out[i * 4 + 3] = byte(.5 + (height - fine[i]) / (2 * RELIEF_RANGE_M.fine));
  }
  return out;
}

/** Lowest and highest sample over square blocks of `2^level × base` cells, per level up to one block over the
 * whole field. A block's bounds include its border samples, so they bound the bilinear surface over it. */
export interface HeightBounds { readonly base: number; readonly levels: readonly { readonly size: number; readonly min: Float32Array; readonly max: Float32Array }[] }

export function heightBounds(field: Heightfield, heights: Float32Array, base: number): HeightBounds {
  const { columns: w, rows: h } = field, cells = Math.max(w, h) - 1;
  const levels: { size: number; min: Float32Array; max: Float32Array }[] = [];
  let size = Math.ceil(cells / base);
  const min = new Float32Array(size * size).fill(Infinity), max = new Float32Array(size * size).fill(-Infinity);
  for (let bj = 0; bj < size; bj++) for (let bi = 0; bi < size; bi++) {
    let low = Infinity, high = -Infinity;
    for (let j = bj * base; j <= Math.min((bj + 1) * base, h - 1); j++) for (let i = bi * base; i <= Math.min((bi + 1) * base, w - 1); i++) {
      const value = heights[j * w + i];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    min[bj * size + bi] = low; max[bj * size + bi] = high;
  }
  levels.push({ size, min, max });
  while (size > 1) {
    const previous = levels[levels.length - 1], next = Math.ceil(size / 2);
    const nextMin = new Float32Array(next * next).fill(Infinity), nextMax = new Float32Array(next * next).fill(-Infinity);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const at = (j >> 1) * next + (i >> 1);
      nextMin[at] = Math.min(nextMin[at], previous.min[j * size + i]);
      nextMax[at] = Math.max(nextMax[at], previous.max[j * size + i]);
    }
    levels.push({ size: next, min: nextMin, max: nextMax });
    size = next;
  }
  return { base, levels };
}

/** Share of the sun's disc each sample sees past the land toward `direction` (unit, toward the light), 0–255.
 *
 * A line sweep from the sun's side carries the shadow surface along the light: at each sample it is the higher of
 * the ground and the surface one step sunward, lowered by the light's slope over that step (interpolated between
 * the two samples the step lands between). A sample is lit where the ground stands above it. The sweep runs twice,
 * for the sun `penumbra` degrees higher and lower, and a sample between the two surfaces sees that share of the
 * disc: the edge softens with the distance to the ridge that casts it, as a real penumbra does. `penumbra` is wider
 * than the sun's 0.27° radius to stand for the atmosphere's softening and the 40 m samples. Below the horizon every
 * sample is dark; overhead every one is lit. */
export function sunVisibility(field: Grid, heights: Float32Array, direction: readonly [number, number, number], penumbra = 1.2,
  out: Uint8Array<ArrayBuffer> = new Uint8Array(field.columns * field.rows)): Uint8Array<ArrayBuffer> {
  const { columns: w, rows: h, cell } = field;
  const [dx, dy, dz] = direction, across = Math.hypot(dx, dz);
  const elevation = Math.atan2(dy, across) * 180 / Math.PI;
  if (elevation + penumbra <= 0) return out.fill(0);
  if (across < 1e-6 || elevation - penumbra >= 89) return out.fill(255);
  // March along the dominant axis toward the sun, one sample per step; the other axis moves by `slope` samples.
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const major = alongX ? dx : dz, minor = alongX ? dz : dx;
  const stepMajor = major > 0 ? 1 : -1, slope = minor / Math.abs(major);
  const run = cell * Math.hypot(1, slope);
  const rad = Math.PI / 180;
  const dropHigh = run * Math.tan(Math.max(elevation - penumbra, 0.01) * rad), dropLow = run * Math.tan(Math.min(elevation + penumbra, 89.9) * rad);
  const lines = alongX ? h : w, length = alongX ? w : h;
  // Array strides between neighbouring lines and between steps along a line.
  const lineStride = alongX ? w : 1, stepStride = alongX ? 1 : w;
  // Shadow surfaces for the low and the high sun, two rows each: the previous step (one sample sunward) and this one.
  const surfaceHigh = new Float32Array(2 * lines), surfaceLow = new Float32Array(2 * lines);
  // One step sunward the minor coordinate is `slope` samples further, the same offset for every line.
  const offset = Math.floor(slope), t = slope - offset, u = 1 - t;
  const first = stepMajor > 0 ? length - 1 : 0;
  for (let line = 0, at = first * stepStride; line < lines; line++, at += lineStride) {
    surfaceHigh[line] = surfaceLow[line] = heights[at]; out[at] = 255;
  }
  const floor = -1e9;
  for (let step = 1; step < length; step++) {
    const previous = ((step - 1) & 1) * lines, current = (step & 1) * lines;
    const k = first - step * stepMajor;
    for (let line = 0, at = k * stepStride; line < lines; line++, at += lineStride) {
      const ground = heights[at], lo = line + offset;
      let high = floor, low = floor;
      // Beyond the field lies open sea, which casts no shadow.
      if (lo >= 0 && lo + 1 < lines) {
        high = surfaceHigh[previous + lo] * u + surfaceHigh[previous + lo + 1] * t - dropHigh;
        low = surfaceLow[previous + lo] * u + surfaceLow[previous + lo + 1] * t - dropLow;
      } else if (lo === lines - 1 && t === 0) {
        high = surfaceHigh[previous + lo] - dropHigh; low = surfaceLow[previous + lo] - dropLow;
      }
      surfaceHigh[current + line] = ground > high ? ground : high;
      surfaceLow[current + line] = ground > low ? ground : low;
      // Lit fully above the surface the lowest part of the disc casts, dark below the one its top casts.
      out[at] = high <= ground ? 255 : low >= ground ? 0 : ((ground - low) / (high - low) * 255 + .5) | 0;
    }
  }
  return out;
}
